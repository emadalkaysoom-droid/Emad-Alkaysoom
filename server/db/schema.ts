import { DatabaseSync, backup } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';

let dbInstance: DatabaseSync | null = null;
let currentDbPath = '';

export function getDefaultDbPath(): string {
  return process.env.OMNIX_DB_PATH || path.resolve(process.cwd(), 'data', 'omnix.db');
}

export function getDb(customPath?: string): DatabaseSync {
  const targetPath = customPath || getDefaultDbPath();
  if (dbInstance && currentDbPath === targetPath) {
    return dbInstance;
  }

  if (targetPath !== ':memory:') {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  }

  const db = new DatabaseSync(targetPath);
  db.exec('PRAGMA foreign_keys = ON;');
  if (targetPath !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL;');
  }
  runMigrations(db);
  seedStarterData(db);
  ensureExpansionSeeds(db);

  dbInstance = db;
  currentDbPath = targetPath;
  return db;
}

export function closeDb(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
    currentDbPath = '';
  }
}

export async function createDatabaseBackup(destDir?: string): Promise<{ fileName: string; filePath: string; bytes: number }> {
  const db = getDb();
  const dir = destDir || path.resolve(process.cwd(), 'data', 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fileName = `omnix-backup-${stamp}.db`;
  const filePath = path.join(dir, fileName);
  await backup(db, filePath);
  const stat = fs.statSync(filePath);
  return { fileName, filePath, bytes: stat.size };
}

function runMigrations(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const applied = new Set<number>(
    (db.prepare('SELECT version FROM schema_migrations').all() as Array<{ version: number }>).map(
      (r) => r.version
    )
  );

  if (!applied.has(1)) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'engineer' CHECK (role IN ('admin', 'engineer', 'analyst', 'viewer')),
        preferred_language TEXT NOT NULL DEFAULT 'en' CHECK (preferred_language IN ('en', 'ar')),
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS organizations (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        plan TEXT NOT NULL DEFAULT 'enterprise',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS workspaces (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived', 'paused')),
        category TEXT NOT NULL DEFAULT 'general',
        created_by TEXT NOT NULL REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
        content TEXT NOT NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS memory_entries (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
        scope TEXT NOT NULL DEFAULT 'long_term' CHECK (scope IN ('short_term', 'long_term')),
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'user',
        tags_json TEXT NOT NULL DEFAULT '[]',
        confidence REAL NOT NULL DEFAULT 1.0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS knowledge_nodes (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
        node_type TEXT NOT NULL CHECK (node_type IN ('person', 'project', 'file', 'idea', 'task', 'concept')),
        label TEXT NOT NULL,
        properties_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS knowledge_relations (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        source_node_id TEXT NOT NULL REFERENCES knowledge_nodes(id) ON DELETE CASCADE,
        target_node_id TEXT NOT NULL REFERENCES knowledge_nodes(id) ON DELETE CASCADE,
        relation_type TEXT NOT NULL,
        weight REAL NOT NULL DEFAULT 1.0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        role_title TEXT NOT NULL,
        specialty TEXT NOT NULL,
        allowed_tools_json TEXT NOT NULL DEFAULT '[]',
        permission_level TEXT NOT NULL DEFAULT 'standard' CHECK (permission_level IN ('restricted', 'standard', 'elevated')),
        status TEXT NOT NULL DEFAULT 'idle' CHECK (status IN ('idle', 'busy', 'disabled')),
        success_rate REAL NOT NULL DEFAULT 100.0,
        tasks_completed INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS agent_tasks (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
        conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
        agent_id TEXT NOT NULL REFERENCES agents(id),
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed', 'failed', 'awaiting_approval', 'cancelled')),
        priority INTEGER NOT NULL DEFAULT 2,
        requires_approval INTEGER NOT NULL DEFAULT 0,
        scheduled_for TEXT,
        retry_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS task_executions (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES agent_tasks(id) ON DELETE CASCADE,
        agent_id TEXT NOT NULL REFERENCES agents(id),
        input_json TEXT NOT NULL DEFAULT '{}',
        output_json TEXT NOT NULL DEFAULT '{}',
        error_message TEXT,
        duration_ms INTEGER NOT NULL DEFAULT 0,
        verified_by_qa INTEGER NOT NULL DEFAULT 0,
        executed_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS files (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
        name TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        size_bytes INTEGER NOT NULL DEFAULT 0,
        content_text TEXT NOT NULL DEFAULT '',
        uploaded_by TEXT NOT NULL REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS file_metadata (
        id TEXT PRIMARY KEY,
        file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
        meta_key TEXT NOT NULL,
        meta_value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS ai_models (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        provider TEXT NOT NULL CHECK (provider IN ('cloud-gemini', 'local-deterministic', 'external-adapter')),
        modality TEXT NOT NULL CHECK (modality IN ('multimodal', 'text', 'vision', 'speech', 'embedding', '3d-parametric')),
        is_local INTEGER NOT NULL DEFAULT 0,
        requires_api_key INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'available'
      );

      CREATE TABLE IF NOT EXISTS model_configurations (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        model_id TEXT NOT NULL REFERENCES ai_models(id) ON DELETE CASCADE,
        is_default INTEGER NOT NULL DEFAULT 0,
        thinking_level TEXT NOT NULL DEFAULT 'MEDIUM',
        fallback_model_id TEXT,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS plugins (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        version TEXT NOT NULL,
        description TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        capabilities_json TEXT NOT NULL DEFAULT '[]'
      );

      CREATE TABLE IF NOT EXISTS integrations (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        connector_type TEXT NOT NULL CHECK (connector_type IN ('rest_api', 'websocket', 'oauth2', 'webhook', 'file_connector')),
        endpoint_url TEXT NOT NULL,
        auth_type TEXT NOT NULL DEFAULT 'none',
        status TEXT NOT NULL DEFAULT 'not_configured' CHECK (status IN ('connected', 'not_configured', 'error')),
        last_checked_at TEXT,
        config_json TEXT NOT NULL DEFAULT '{}'
      );

      CREATE TABLE IF NOT EXISTS permissions (
        id TEXT PRIMARY KEY,
        role TEXT NOT NULL,
        resource TEXT NOT NULL,
        action TEXT NOT NULL,
        allowed INTEGER NOT NULL DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS audit_logs (
        id TEXT PRIMARY KEY,
        workspace_id TEXT,
        user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        action TEXT NOT NULL,
        resource_type TEXT NOT NULL,
        resource_id TEXT,
        status TEXT NOT NULL CHECK (status IN ('allowed', 'denied', 'approved', 'rejected', 'error')),
        details_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS pending_approvals (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        requested_by TEXT NOT NULL,
        action_type TEXT NOT NULL,
        target_resource TEXT NOT NULL,
        payload_json TEXT NOT NULL DEFAULT '{}',
        reason TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
        decided_by TEXT,
        decided_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS notifications (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        severity TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'warning', 'error', 'success')),
        is_read INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS usage_metrics (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        model_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        tokens_in INTEGER NOT NULL DEFAULT 0,
        tokens_out INTEGER NOT NULL DEFAULT 0,
        latency_ms INTEGER NOT NULL DEFAULT 0,
        estimated_cost_usd REAL NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS subscriptions (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        plan_name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        monthly_token_quota INTEGER NOT NULL DEFAULT 1000000,
        storage_quota_mb INTEGER NOT NULL DEFAULT 2048,
        renews_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS simulation_projects (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
        name TEXT NOT NULL,
        sim_type TEXT NOT NULL CHECK (sim_type IN ('rigid_body', 'particle', 'digital_world')),
        config_json TEXT NOT NULL DEFAULT '{}',
        results_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS three_d_assets (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
        name TEXT NOT NULL,
        prompt TEXT NOT NULL DEFAULT '',
        format TEXT NOT NULL DEFAULT 'parametric-json',
        blueprint_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS reports (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
        title TEXT NOT NULL,
        format TEXT NOT NULL CHECK (format IN ('pdf', 'docx', 'xlsx', 'csv', 'html')),
        summary TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS system_settings (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_projects_workspace ON projects(workspace_id);
      CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
      CREATE INDEX IF NOT EXISTS idx_memory_workspace_scope ON memory_entries(workspace_id, scope);
      CREATE INDEX IF NOT EXISTS idx_tasks_workspace_status ON agent_tasks(workspace_id, status);
      CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_usage_workspace ON usage_metrics(workspace_id, created_at DESC);
    `);

    db.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)').run(
      1,
      'initial_omnix_unified_schema'
    );
  }

  if (!applied.has(2)) {
    const pluginCols = db.prepare(`PRAGMA table_info(plugins)`).all() as Array<{ name: string }>;
    const existingCols = new Set(pluginCols.map((c) => c.name));

    const alterColumns: Array<[string, string]> = [
      ['author', `TEXT NOT NULL DEFAULT 'OMNIX'`],
      ['category', `TEXT NOT NULL DEFAULT 'custom'`],
      ['manifest_json', `TEXT NOT NULL DEFAULT '{}'`],
      ['granted_permissions_json', `TEXT NOT NULL DEFAULT '[]'`],
      ['config_json', `TEXT NOT NULL DEFAULT '{}'`],
      ['source', `TEXT NOT NULL DEFAULT 'builtin'`],
      ['discovered_at', `TEXT NOT NULL DEFAULT ''`],
    ];

    for (const [col, def] of alterColumns) {
      if (!existingCols.has(col)) {
        db.exec(`ALTER TABLE plugins ADD COLUMN ${col} ${def};`);
      }
    }

    db.exec(`
      CREATE TABLE IF NOT EXISTS plugin_storage (
        plugin_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        record_key TEXT NOT NULL,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (plugin_id, workspace_id, record_key)
      );
    `);

    db.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)').run(
      2,
      'omni_connect_plugin_architecture'
    );
  }

  if (!applied.has(3)) {
    const userCols = new Set(
      (db.prepare(`PRAGMA table_info(users)`).all() as Array<{ name: string }>).map((c) => c.name)
    );
    const userAlterCols: Array<[string, string]> = [
      ['username', `TEXT`],
      ['full_name', `TEXT NOT NULL DEFAULT ''`],
      ['country', `TEXT NOT NULL DEFAULT 'US'`],
      ['avatar_url', `TEXT NOT NULL DEFAULT ''`],
      ['email_verified', `INTEGER NOT NULL DEFAULT 1`],
      ['verification_token', `TEXT`],
      ['reset_token', `TEXT`],
      ['reset_expires_at', `TEXT`],
      ['two_factor_enabled', `INTEGER NOT NULL DEFAULT 0`],
      ['two_factor_secret', `TEXT NOT NULL DEFAULT ''`],
      ['account_role', `TEXT NOT NULL DEFAULT 'FREE_USER'`],
      ['failed_login_attempts', `INTEGER NOT NULL DEFAULT 0`],
      ['locked_until', `TEXT`],
      ['last_login_at', `TEXT`],
      ['terms_accepted_at', `TEXT`],
    ];
    for (const [col, def] of userAlterCols) {
      if (!userCols.has(col)) {
        db.exec(`ALTER TABLE users ADD COLUMN ${col} ${def};`);
      }
    }
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username) WHERE username IS NOT NULL;`);

    const sessionCols = new Set(
      (db.prepare(`PRAGMA table_info(sessions)`).all() as Array<{ name: string }>).map((c) => c.name)
    );
    const sessionAlterCols: Array<[string, string]> = [
      ['device_label', `TEXT NOT NULL DEFAULT 'Web Browser'`],
      ['ip_address', `TEXT NOT NULL DEFAULT '127.0.0.1'`],
      ['user_agent', `TEXT NOT NULL DEFAULT ''`],
      ['csrf_token', `TEXT NOT NULL DEFAULT ''`],
      ['revoked_at', `TEXT`],
    ];
    for (const [col, def] of sessionAlterCols) {
      if (!sessionCols.has(col)) {
        db.exec(`ALTER TABLE sessions ADD COLUMN ${col} ${def};`);
      }
    }

    // Rename legacy org subscriptions table cleanly if it has organization_id
    const subCols = (db.prepare(`PRAGMA table_info(subscriptions)`).all() as Array<{ name: string }>).map((c) => c.name);
    if (subCols.includes('organization_id')) {
      db.exec(`ALTER TABLE subscriptions RENAME TO org_subscriptions;`);
    }

    db.exec(`
      CREATE TABLE IF NOT EXISTS SubscriptionPlans (
        id TEXT PRIMARY KEY,
        code TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        price_usd REAL NOT NULL DEFAULT 0,
        currency TEXT NOT NULL DEFAULT 'USD',
        billing_interval_days INTEGER NOT NULL DEFAULT 90,
        features_json TEXT NOT NULL DEFAULT '[]',
        limits_json TEXT NOT NULL DEFAULT '{}',
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS Subscriptions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        plan_id TEXT NOT NULL REFERENCES SubscriptionPlans(id),
        status TEXT NOT NULL DEFAULT 'FREE' CHECK (status IN ('FREE', 'ACTIVE', 'PAST_DUE', 'CANCELLED', 'EXPIRED', 'PAYMENT_PENDING', 'SUSPENDED')),
        provider TEXT NOT NULL DEFAULT 'local-sandbox',
        provider_subscription_id TEXT,
        start_date TEXT NOT NULL DEFAULT (datetime('now')),
        expiration_date TEXT,
        renewal_date TEXT,
        cancellation_date TEXT,
        auto_renew INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS Payments (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        subscription_id TEXT REFERENCES Subscriptions(id) ON DELETE SET NULL,
        amount_usd REAL NOT NULL,
        currency TEXT NOT NULL DEFAULT 'USD',
        status TEXT NOT NULL CHECK (status IN ('pending', 'succeeded', 'failed', 'refunded')),
        provider TEXT NOT NULL DEFAULT 'local-sandbox',
        provider_payment_id TEXT,
        payment_method_summary TEXT NOT NULL DEFAULT 'Sandbox Verified Token',
        failure_reason TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS Invoices (
        id TEXT PRIMARY KEY,
        invoice_number TEXT NOT NULL UNIQUE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        payment_id TEXT REFERENCES Payments(id) ON DELETE SET NULL,
        subscription_id TEXT REFERENCES Subscriptions(id) ON DELETE SET NULL,
        amount_usd REAL NOT NULL,
        currency TEXT NOT NULL DEFAULT 'USD',
        status TEXT NOT NULL CHECK (status IN ('paid', 'open', 'refunded', 'void')),
        period_start TEXT NOT NULL,
        period_end TEXT NOT NULL,
        line_items_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS PaymentEvents (
        id TEXT PRIMARY KEY,
        event_id TEXT NOT NULL UNIQUE,
        event_type TEXT NOT NULL,
        provider TEXT NOT NULL,
        signature_valid INTEGER NOT NULL DEFAULT 0,
        processed INTEGER NOT NULL DEFAULT 0,
        payload_hash TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS SubscriptionHistory (
        id TEXT PRIMARY KEY,
        subscription_id TEXT NOT NULL REFERENCES Subscriptions(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        from_status TEXT NOT NULL,
        to_status TEXT NOT NULL,
        reason TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS PremiumEntitlements (
        id TEXT PRIMARY KEY,
        feature_key TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        title_ar TEXT NOT NULL,
        description TEXT NOT NULL,
        description_ar TEXT NOT NULL,
        required_plan TEXT NOT NULL DEFAULT 'PREMIUM',
        category TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS PaymentWebhookLogs (
        id TEXT PRIMARY KEY,
        event_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        http_status INTEGER NOT NULL,
        signature_verified INTEGER NOT NULL DEFAULT 0,
        idempotent_duplicate INTEGER NOT NULL DEFAULT 0,
        detail TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- 1. OMNI CODEX tables
      CREATE TABLE IF NOT EXISTS codex_analyses (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        target_name TEXT NOT NULL,
        summary_json TEXT NOT NULL,
        findings_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS codex_patches (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        file_path TEXT NOT NULL,
        finding_id TEXT NOT NULL,
        unified_diff TEXT NOT NULL,
        original_content TEXT NOT NULL,
        patched_content TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'previewed' CHECK (status IN ('previewed', 'applied', 'rolled_back')),
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS codex_sandbox_runs (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        language TEXT NOT NULL,
        code TEXT NOT NULL,
        status TEXT NOT NULL,
        stdout TEXT NOT NULL DEFAULT '',
        stderr TEXT NOT NULL DEFAULT '',
        duration_ms INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- 2. OMNI GENOME tables
      CREATE TABLE IF NOT EXISTS genome_snapshots (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        label TEXT NOT NULL,
        dna_json TEXT NOT NULL,
        health_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- 3. OMNI LAB tables
      CREATE TABLE IF NOT EXISTS lab_experiments (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        domain TEXT NOT NULL CHECK (domain IN ('numerical', 'physics', 'materials', 'engineering')),
        title TEXT NOT NULL,
        engine_version TEXT NOT NULL DEFAULT 'omnix-lab-v3.0',
        variables_json TEXT NOT NULL,
        equations_json TEXT NOT NULL,
        results_json TEXT NOT NULL,
        notes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- 4. OMNI RADAR tables
      CREATE TABLE IF NOT EXISTS radar_monitors (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        monitor_type TEXT NOT NULL CHECK (monitor_type IN ('topic', 'competitor', 'source')),
        keywords_json TEXT NOT NULL DEFAULT '[]',
        source_url TEXT NOT NULL DEFAULT '',
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS radar_signals (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        category TEXT NOT NULL,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        source_name TEXT NOT NULL,
        source_url TEXT NOT NULL,
        published_at TEXT NOT NULL,
        collected_at TEXT NOT NULL DEFAULT (datetime('now')),
        signal_kind TEXT NOT NULL CHECK (signal_kind IN ('fact', 'trend', 'opportunity', 'competitor_update')),
        confidence REAL NOT NULL DEFAULT 0.85,
        tags_json TEXT NOT NULL DEFAULT '[]'
      );

      CREATE TABLE IF NOT EXISTS radar_reports (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        facts_json TEXT NOT NULL,
        analysis TEXT NOT NULL,
        predictions_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- 5. OMNI TRANSLATOR tables
      CREATE TABLE IF NOT EXISTS translator_glossaries (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        domain TEXT NOT NULL,
        source_lang TEXT NOT NULL,
        target_lang TEXT NOT NULL,
        source_term TEXT NOT NULL,
        target_term TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS translator_memory (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        source_lang TEXT NOT NULL,
        target_lang TEXT NOT NULL,
        domain TEXT NOT NULL,
        source_text TEXT NOT NULL,
        target_text TEXT NOT NULL,
        usage_count INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS translator_jobs (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        job_type TEXT NOT NULL CHECK (job_type IN ('text', 'document', 'voice', 'subtitle')),
        source_lang TEXT NOT NULL,
        target_lang TEXT NOT NULL,
        tone TEXT NOT NULL,
        domain TEXT NOT NULL,
        source_preview TEXT NOT NULL,
        translated_output TEXT NOT NULL,
        qa_json TEXT NOT NULL DEFAULT '{}',
        reviewed_status TEXT NOT NULL DEFAULT 'auto' CHECK (reviewed_status IN ('auto', 'approved', 'needs_review')),
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- 6. OMNI AUTOBUILD tables
      CREATE TABLE IF NOT EXISTS autobuild_projects (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        prompt TEXT NOT NULL,
        category TEXT NOT NULL,
        blueprint_json TEXT NOT NULL,
        revision INTEGER NOT NULL DEFAULT 1,
        qc_passed INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- 7. OMNI MEMORY VAULT & OMNI AUTOMATION PRO tables
      CREATE TABLE IF NOT EXISTS memory_rules (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        rule_title TEXT NOT NULL,
        rule_content TEXT NOT NULL,
        linked_file_id TEXT REFERENCES files(id) ON DELETE SET NULL,
        linked_conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS automation_workflows (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        trigger_type TEXT NOT NULL CHECK (trigger_type IN ('manual', 'schedule', 'webhook', 'event')),
        trigger_config TEXT NOT NULL DEFAULT '',
        steps_json TEXT NOT NULL DEFAULT '[]',
        enabled INTEGER NOT NULL DEFAULT 1,
        last_run_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS automation_runs (
        id TEXT PRIMARY KEY,
        workflow_id TEXT NOT NULL REFERENCES automation_workflows(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        status TEXT NOT NULL CHECK (status IN ('completed', 'failed')),
        logs_json TEXT NOT NULL DEFAULT '[]',
        duration_ms INTEGER NOT NULL DEFAULT 0,
        executed_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_subs_user ON Subscriptions(user_id, status);
      CREATE INDEX IF NOT EXISTS idx_payments_user ON Payments(user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_codex_user ON codex_analyses(user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_lab_user ON lab_experiments(user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_autobuild_user ON autobuild_projects(user_id, updated_at DESC);
    `);

    db.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)').run(
      3,
      'omnix_ultimate_intelligence_expansion'
    );
  }
}

function seedStarterData(db: DatabaseSync): void {
  const userCount = (db.prepare('SELECT COUNT(*) as c FROM users').get() as { c: number }).c;
  if (userCount > 0) return;

  const passwordHash = bcrypt.hashSync('OmnixSecure2026!', 10);

  db.prepare(
    `INSERT INTO users (id, email, username, full_name, name, password_hash, role, account_role, preferred_language, email_verified) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
  ).run('user-admin', 'architect@omnix.local', 'architect', 'System Architect', 'System Architect', passwordHash, 'admin', 'SUPER_ADMIN', 'en');

  db.prepare(`INSERT INTO organizations (id, name, slug, plan) VALUES (?, ?, ?, ?)`).run(
    'org-core',
    'OMNIX Core Research',
    'omnix-core',
    'enterprise'
  );

  db.prepare(
    `INSERT INTO org_subscriptions (id, organization_id, plan_name, status, monthly_token_quota, storage_quota_mb, renews_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run('sub-core', 'org-core', 'Local + Hybrid Enterprise', 'active', 5000000, 10240, '2027-01-01T00:00:00Z');

  db.prepare(
    `INSERT INTO workspaces (id, organization_id, owner_id, name, description) VALUES (?, ?, ?, ?, ?)`
  ).run(
    'ws-primary',
    'org-core',
    'user-admin',
    'Primary Engineering Workspace',
    'Unified multimodal engineering, simulation, and data intelligence environment.'
  );

  db.prepare(
    `INSERT INTO workspaces (id, organization_id, owner_id, name, description) VALUES (?, ?, ?, ?, ?)`
  ).run(
    'ws-robotics',
    'org-core',
    'user-admin',
    'Autonomous Robotics Lab',
    '3D kinematics, sensor telemetry, and spatial simulation projects.'
  );

  db.prepare(
    `INSERT INTO projects (id, workspace_id, name, description, status, category, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    'proj-telemetry',
    'ws-primary',
    'Turbine Sensor Telemetry & Anomaly Audit',
    'Sample engineering project analyzing turbine RPM, thermal telemetry, and maintenance reports.',
    'active',
    'data-intelligence',
    'user-admin'
  );

  db.prepare(
    `INSERT INTO projects (id, workspace_id, name, description, status, category, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    'proj-manipulator',
    'ws-primary',
    '6-DOF Manipulator Digital Twin',
    'Parametric 3D assembly and rigid-body collision testbed.',
    'active',
    '3d-simulation',
    'user-admin'
  );

  // Seed 12 Specialized Agents
  const agents = [
    ['agent-research', 'Research Agent', 'Information Synthesis', 'Cross-references knowledge graphs, project files, and structured queries.', ['memory_search', 'file_read', 'knowledge_link'], 'standard'],
    ['agent-coding', 'Coding Agent', 'Isolated Execution & Scripting', 'Executes verified JavaScript snippets inside an isolated VM sandbox.', ['sandbox_js', 'code_lint'], 'elevated'],
    ['agent-data', 'Data Analysis Agent', 'Statistical & Anomaly Intelligence', 'Parses CSV/XLSX/JSON/XML, computes statistics, Z-score anomalies, and forecasts.', ['analyze_data', 'parse_file', 'nl_data_query'], 'standard'],
    ['agent-vision', 'Vision Agent', 'Visual Question Answering & OCR', 'Processes uploaded images, scene descriptors, and two-image change comparisons.', ['vision_analyze', 'ocr_extract'], 'standard'],
    ['agent-document', 'Document Agent', 'Report & Document Compilation', 'Generates downloadable PDF, DOCX, XLSX, CSV, and HTML engineering reports.', ['generate_report', 'file_read'], 'standard'],
    ['agent-math', 'Mathematics Agent', 'Symbolic & Numerical Evaluation', 'Evaluates exact mathematical formulas and numerical checks via safe parser.', ['math_eval'], 'standard'],
    ['agent-3d', '3D Modeling Agent', 'Parametric Spatial Geometry', 'Synthesizes composite 3-12 part 3D assemblies and exports OBJ/STL.', ['create_3d_blueprint', 'export_3d'], 'standard'],
    ['agent-sim', 'Simulation Agent', 'Kinematics & Physics Runner', 'Configures and steps rigid-body gravity, friction, and collision simulations.', ['run_physics_step', 'create_world_blueprint'], 'standard'],
    ['agent-planning', 'Planning Agent', 'Task Decomposition & Scheduling', 'Breaks complex multi-step user directives into ordered agent workflows.', ['decompose_plan', 'schedule_task'], 'standard'],
    ['agent-security', 'Security Agent', 'Policy Enforcement & Approvals', 'Audits sensitive actions (delete/external calls) and enforces approval gates.', ['audit_log', 'request_approval'], 'elevated'],
    ['agent-engineering', 'Engineering Agent', 'Systems Architecture & Integration', 'Coordinates cross-module pipelines across Data, 3D, and Connectors.', ['connector_test', 'project_create'], 'elevated'],
    ['agent-qa', 'Quality Assurance Agent', 'Result Verification & Conflict Resolution', 'Validates agent outputs, detects contradictions, and marks verified executions.', ['verify_output', 'run_diagnostics'], 'standard'],
  ] as const;

  const insertAgent = db.prepare(
    `INSERT INTO agents (id, name, role_title, specialty, allowed_tools_json, permission_level) VALUES (?, ?, ?, ?, ?, ?)`
  );
  for (const [id, name, role, spec, tools, perm] of agents) {
    insertAgent.run(id, name, role, spec, JSON.stringify(tools), perm);
  }

  // Seed AI Models in Gateway
  const models = [
    ['gemini-4-hydrogen', 'Gemini 4 Hydrogen (Cloud Multimodal)', 'cloud-gemini', 'multimodal', 0, 1, 'available'],
    ['gemini-embedding-2', 'Gemini Embedding 2 (Semantic Vector)', 'cloud-gemini', 'embedding', 0, 1, 'available'],
    ['omnix-local-core', 'OMNIX Deterministic Hybrid Engine (Local)', 'local-deterministic', 'text', 1, 0, 'available'],
    ['omnix-local-parametric-3d', 'OMNIX Parametric 3D & World Synthesizer (Local)', 'local-deterministic', '3d-parametric', 1, 0, 'available'],
  ] as const;

  const insertModel = db.prepare(
    `INSERT INTO ai_models (id, name, provider, modality, is_local, requires_api_key, status) VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  for (const m of models) insertModel.run(...m);

  db.prepare(
    `INSERT INTO model_configurations (id, workspace_id, model_id, is_default, thinking_level, fallback_model_id) VALUES (?, ?, ?, ?, ?, ?)`
  ).run('cfg-primary', 'ws-primary', 'gemini-4-hydrogen', 1, 'MEDIUM', 'omnix-local-core');

  // Seed Sample CSV File in Project
  const sampleCsv = [
    'timestamp,unit_id,rpm,temp_c,vibration_mm_s,power_kw',
    '2026-11-01T08:00Z,Turbine-01,1480,62.4,1.12,410',
    '2026-11-01T09:00Z,Turbine-01,1495,63.1,1.18,418',
    '2026-11-01T10:00Z,Turbine-01,1502,63.8,1.15,422',
    '2026-11-01T11:00Z,Turbine-01,1510,64.5,1.21,426',
    '2026-11-01T12:00Z,Turbine-01,1525,65.2,1.25,431',
    '2026-11-01T13:00Z,Turbine-01,1890,94.6,4.85,540',
    '2026-11-01T14:00Z,Turbine-01,1518,65.8,1.28,429',
    '2026-11-01T15:00Z,Turbine-01,1520,66.0,1.24,433',
    '2026-11-01T16:00Z,Turbine-01,1532,66.4,1.29,438',
    '2026-11-01T17:00Z,Turbine-01,1540,66.9,1.31,442',
  ].join('\n');

  db.prepare(
    `INSERT INTO files (id, workspace_id, project_id, name, mime_type, size_bytes, content_text, uploaded_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    'file-sample-telemetry',
    'ws-primary',
    'proj-telemetry',
    'turbine_telemetry_sample.csv',
    'text/csv',
    Buffer.byteLength(sampleCsv, 'utf8'),
    sampleCsv,
    'user-admin'
  );

  // Seed Starter Memory & Knowledge Graph Nodes
  db.prepare(
    `INSERT INTO memory_entries (id, workspace_id, project_id, scope, title, content, source, tags_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    'mem-1',
    'ws-primary',
    'proj-telemetry',
    'long_term',
    'Turbine-01 Thermal Threshold',
    'Nominal operating bearing temperature is 60-70 C; spikes above 85 C indicate lubrication or load anomalies.',
    'system-seed',
    JSON.stringify(['telemetry', 'thermal', 'threshold'])
  );

  db.prepare(
    `INSERT INTO memory_entries (id, workspace_id, project_id, scope, title, content, source, tags_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    'mem-2',
    'ws-primary',
    'proj-manipulator',
    'short_term',
    'Active CAD Kinematics Check',
    'Current manipulator prototype uses 6-DOF joints with aluminum boom roughness 0.32.',
    'session-context',
    JSON.stringify(['3d', 'robotics'])
  );

  const nodes = [
    ['node-arch', 'ws-primary', 'proj-telemetry', 'person', 'System Architect'],
    ['node-proj1', 'ws-primary', 'proj-telemetry', 'project', 'Turbine Telemetry Audit'],
    ['node-file1', 'ws-primary', 'proj-telemetry', 'file', 'turbine_telemetry_sample.csv'],
    ['node-idea1', 'ws-primary', 'proj-telemetry', 'concept', 'Z-Score Anomaly Detection'],
    ['node-proj2', 'ws-primary', 'proj-manipulator', 'project', '6-DOF Manipulator Twin'],
  ] as const;

  const insertNode = db.prepare(
    `INSERT INTO knowledge_nodes (id, workspace_id, project_id, node_type, label) VALUES (?, ?, ?, ?, ?)`
  );
  for (const n of nodes) insertNode.run(...n);

  const rels = [
    ['rel-1', 'ws-primary', 'node-arch', 'node-proj1', 'leads'],
    ['rel-2', 'ws-primary', 'node-proj1', 'node-file1', 'analyzes'],
    ['rel-3', 'ws-primary', 'node-file1', 'node-idea1', 'validated_by'],
    ['rel-4', 'ws-primary', 'node-arch', 'node-proj2', 'owns'],
  ] as const;

  const insertRel = db.prepare(
    `INSERT INTO knowledge_relations (id, workspace_id, source_node_id, target_node_id, relation_type) VALUES (?, ?, ?, ?, ?)`
  );
  for (const r of rels) insertRel.run(...r);

  // Seed RBAC permissions
  const perms = [
    ['perm-1', 'admin', '*', '*', 1],
    ['perm-2', 'engineer', 'projects', 'write', 1],
    ['perm-3', 'engineer', 'agents', 'execute', 1],
    ['perm-4', 'analyst', 'data', 'analyze', 1],
    ['perm-5', 'viewer', 'projects', 'read', 1],
    ['perm-6', 'viewer', 'projects', 'delete', 0],
  ] as const;
  const insertPerm = db.prepare(
    `INSERT INTO permissions (id, role, resource, action, allowed) VALUES (?, ?, ?, ?, ?)`
  );
  for (const p of perms) insertPerm.run(...p);

  // Seed Plugins & Connectors
  db.prepare(
    `INSERT INTO plugins (id, name, version, description, enabled, capabilities_json) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    'plugin-report-compiler',
    'Multi-Format Report Compiler',
    '1.0.0',
    'Compiles analysis outputs into PDF, DOCX, XLSX, CSV, and HTML deliverables.',
    1,
    JSON.stringify(['pdf', 'docx', 'xlsx', 'csv', 'html'])
  );

  db.prepare(
    `INSERT INTO integrations (id, workspace_id, name, connector_type, endpoint_url, auth_type, status) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    'int-local-webhook',
    'ws-primary',
    'OMNIX Internal Loopback Probe',
    'rest_api',
    'http://localhost:3000/api/health',
    'none',
    'connected'
  );

  // Seed Default System Settings
  const defaultSettings: Record<string, unknown> = {
    language: 'en',
    adaptiveLearningEnabled: true,
    preferredModelId: 'gemini-4-hydrogen',
    localFallbackEnabled: true,
    voiceRate: 1.0,
    voiceLang: 'en-US',
    renderQuality: 'balanced',
    requireApprovalForDeletes: true,
    onboardingCompleted: false,
  };
  const insertSetting = db.prepare(
    `INSERT INTO system_settings (key, value_json) VALUES (?, ?)`
  );
  for (const [k, v] of Object.entries(defaultSettings)) {
    insertSetting.run(k, JSON.stringify(v));
  }
}

function ensureExpansionSeeds(db: DatabaseSync): void {
  // Ensure admin account has updated OMNIX ID fields if migrated from older DB
  db.prepare(
    `UPDATE users SET username = COALESCE(username, 'architect'), full_name = CASE WHEN full_name = '' THEN name ELSE full_name END, account_role = CASE WHEN role = 'admin' THEN 'SUPER_ADMIN' ELSE account_role END WHERE id = 'user-admin'`
  ).run();

  const planCount = (db.prepare(`SELECT COUNT(*) as c FROM SubscriptionPlans`).get() as { c: number }).c;
  if (planCount === 0) {
    db.prepare(
      `INSERT INTO SubscriptionPlans (id, code, name, price_usd, currency, billing_interval_days, features_json, limits_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      'plan-free',
      'FREE',
      'OMNIX Free Tier',
      0,
      'USD',
      30,
      JSON.stringify(['OMNI BRAIN Core', 'OMNI VISION & VOICE', '3D & Simulation Basics', 'Basic Codex Scan']),
      JSON.stringify({ projects: 5, codexRunsPerDay: 10, labExperiments: 10, autobuildApps: 1 })
    );

    db.prepare(
      `INSERT INTO SubscriptionPlans (id, code, name, price_usd, currency, billing_interval_days, features_json, limits_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      'plan-premium',
      'PREMIUM',
      'OMNIX PREMIUM (3-Month Pass)',
      5.0,
      'USD',
      90,
      JSON.stringify([
        'ADVANCED_CODEX_INTELLIGENCE',
        'PROJECT_DIGITAL_DNA_PRO',
        'OMNI_LAB_PROFESSIONAL',
        'GLOBAL_RADAR_INTELLIGENCE',
        'OMNI_TRANSLATOR_PRO',
        'OMNI_AUTOBUILD_FACTORY',
        'OMNI_MULTI_AGENT_SWARM_PRO',
        'OMNI_MEMORY_VAULT',
        'OMNI_AUTOMATION_PRO',
        'PRIORITY_COMPUTE_PRO',
      ]),
      JSON.stringify({ projects: 250, codexRunsPerDay: 500, labExperiments: 1000, autobuildApps: 100 })
    );
  }

  const entCount = (db.prepare(`SELECT COUNT(*) as c FROM PremiumEntitlements`).get() as { c: number }).c;
  if (entCount === 0) {
    const entitlements = [
      ['ent-01', 'ADVANCED_CODEX_INTELLIGENCE', 'Advanced Codex Intelligence', 'ذكاء CODEX الهندسي المتقدم', 'Deep multi-file dependency analysis, multi-patch repair, automatic refactoring, and expanded unit test synthesis.', 'تحليل عميق للاعتماديات، إصلاحات متعددة الملفات، إعادة هيكلة تلقائية، وتوليد اختبارات موسعة.', 'Codex'],
      ['ent-02', 'PROJECT_DIGITAL_DNA_PRO', 'Project Digital DNA Pro', 'البصمة الرقمية للمشروع Pro', 'Full cross-layer change impact prediction, hidden dependency mapping, and predictive risk forecasting.', 'التنبؤ الكامل بتأثير التغييرات، كشف الاعتماديات الخفية، وتوقع المخاطر الهندسية.', 'Genome'],
      ['ent-03', 'OMNI_LAB_PROFESSIONAL', 'Omni Lab Professional', 'المختبر العلمي المتقدم Pro', 'Multi-variable ODE & physics sweeps, scenario comparison, custom materials failure curves, and reproducible exports.', 'محاكاة معادلات تفاضلية ومقارنة سيناريوهات ومواد مخصصة وتقارير علمية قابلة للتكرار.', 'Lab'],
      ['ent-04', 'GLOBAL_RADAR_INTELLIGENCE', 'Global Radar Intelligence', 'رادار الاستخبارات العالمي Pro', 'Unlimited topic & competitor monitors, anomaly alerts, and automated Fact/Analysis/Prediction briefings.', 'مراقبة مفتوحة للتقنيات والمنافسين وتنبيهات شذوذ فورية وتقارير حقائق وتوقعات.', 'Radar'],
      ['ent-05', 'OMNI_TRANSLATOR_PRO', 'Omni Translator Pro', 'المترجم الشامل الاحترافي Pro', 'Document & .srt/.vtt subtitle translation, custom domain glossaries, persistent Translation Memory, and back-translation QA.', 'ترجمة المستندات والترجمة الزمنية للفيديو، قواميس التخصصات، ذاكرة ترجمة دائمة، وضبط الجودة.', 'Translator'],
      ['ent-06', 'OMNI_AUTOBUILD_FACTORY', 'Omni AutoBuild Factory', 'مصنع بناء التطبيقات المستقل', '10-agent full-stack app synthesis, live interactive multi-viewport preview, contextual live edits, and full ZIP export.', 'توليد تطبيقات متكاملة بفريق 10 وكلاء مع معاينة حية وتعديل فوري وتصدير ZIP كامل.', 'AutoBuild'],
      ['ent-07', 'OMNI_MULTI_AGENT_SWARM_PRO', 'Omni Multi-Agent Swarm Pro', 'أسراب الوكلاء المتعاونين Pro', 'Parallel multi-agent execution pipelines, cross-agent peer review, and swarm trace telemetry.', 'تشغيل عدة وكلاء بالتوازي مع مراجعة متبادلة وتقارير تنفيذ متقدمة.', 'Agents'],
      ['ent-08', 'OMNI_MEMORY_VAULT', 'Omni Memory Vault', 'خزنة الذاكرة الشخصية الذكية', 'Custom persistent assistant rules, file-conversation cross-linking, and prioritized semantic recall.', 'قواعد تعلم شخصية، ربط المحادثات بالملفات، واسترجاع دلالي مخصص.', 'Memory'],
      ['ent-09', 'OMNI_AUTOMATION_PRO', 'Omni Automation Pro', 'محرك الأتمتة والتدفقات الذكية', 'Multi-step automated workflows triggered by schedules, events, or webhooks with persistent run logs.', 'بناء تدفقات عمل آلية متعددة المراحل مع جدولة وتنفيذ تلقائي وسجلات تشغيل.', 'Automation'],
      ['ent-10', 'PRIORITY_COMPUTE_PRO', 'Priority Compute & Quotas', 'أولوية التنفيذ والحصص الموسعة', 'Expanded workspace project quotas, priority orchestration queue, and full billing/invoice analytics.', 'حصص مشاريع وتشغيل موسعة وأولوية في طابور المعالجة ولوحة تحكم مالية كاملة.', 'Platform'],
    ] as const;
    const stmt = db.prepare(
      `INSERT INTO PremiumEntitlements (id, feature_key, title, title_ar, description, description_ar, category) VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    for (const e of entitlements) stmt.run(...e);
  }

  // Ensure default admin has an ACTIVE Premium subscription record
  const adminSub = db.prepare(`SELECT id FROM Subscriptions WHERE user_id = 'user-admin'`).get();
  if (!adminSub) {
    const start = new Date().toISOString();
    const end = new Date(Date.now() + 90 * 24 * 3600 * 1000).toISOString();
    db.prepare(
      `INSERT INTO Subscriptions (id, user_id, plan_id, status, provider, start_date, expiration_date, renewal_date)
       VALUES (?, 'user-admin', 'plan-premium', 'ACTIVE', 'system-operator', ?, ?, ?)`
    ).run('sub-admin-core', start, end, end);
  }

  // Seed initial starter glossaries & lab baseline if empty
  const glCount = (db.prepare(`SELECT COUNT(*) as c FROM translator_glossaries`).get() as { c: number }).c;
  if (glCount === 0) {
    const ins = db.prepare(
      `INSERT INTO translator_glossaries (id, workspace_id, user_id, domain, source_lang, target_lang, source_term, target_term) VALUES (?, 'ws-primary', 'user-admin', ?, 'en', 'ar', ?, ?)`
    );
    ins.run('gl-1', 'Software Engineering', 'Dependency Graph', 'مخطط الاعتماديات');
    ins.run('gl-2', 'Physics & Science', 'Elastic Modulus', 'معامل المرونة');
    ins.run('gl-3', 'Law', 'Indemnification', 'التعويض القانوني');
  }
}
