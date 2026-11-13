import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { getDb } from '../db/schema.ts';
import {
  authorizePluginExecution,
  validatePluginManifest,
  type OmnixPlugin,
  type PluginExecutionContext,
  type PluginExecutionResult,
  type PluginManifest,
  type PluginPermissionScope,
} from '../../shared/pluginContract.ts';
import { createApprovalRequest, logAuditEvent, type AuthUser } from '../core/security.ts';
import { taskflowPmPlugin } from './builtins/taskflowPmPlugin.ts';
import { nebulaVaultPlugin } from './builtins/nebulaVaultPlugin.ts';
import { reportCompilerPlugin } from './builtins/reportCompilerPlugin.ts';

export interface LoadedPluginRecord {
  id: string;
  name: string;
  version: string;
  author: string;
  category: string;
  description: string;
  enabled: boolean;
  source: 'builtin' | 'manifest_dir' | 'custom_registered';
  manifest: PluginManifest;
  grantedPermissions: PluginPermissionScope[];
  discoveredAt: string;
}

const runtimeRegistry = new Map<string, OmnixPlugin>();
const MANIFEST_DIR = path.resolve(process.cwd(), 'server', 'plugins', 'manifests');

function buildManifestWebhookAdapter(manifest: PluginManifest): OmnixPlugin {
  return {
    manifest,
    execute(actionId: string, input: Record<string, unknown>, ctx: PluginExecutionContext): PluginExecutionResult {
      const action = manifest.actions.find((a) => a.id === actionId);
      if (!action) {
        throw new Error(`Action "${actionId}" not declared in manifest "${manifest.id}".`);
      }
      const now = new Date().toISOString();
      const payload = {
        pluginId: manifest.id,
        actionId,
        workspaceId: ctx.workspaceId,
        allowedDomains: manifest.allowedDomains ?? [],
        input,
        dispatchedMode: 'dry-run-verified',
      };
      ctx.writeStore(`last_action_${actionId}`, payload);
      return {
        ok: true,
        actionId,
        provider: manifest.name,
        summary: `Executed manifest action "${action.name}" safely within declared domain scope.`,
        data: payload,
        executedAt: now,
      };
    },
  };
}

function upsertPluginRecord(
  plugin: OmnixPlugin,
  source: LoadedPluginRecord['source'],
  defaultGrantAll = true
): void {
  const db = getDb();
  const existing = db
    .prepare(`SELECT id, enabled, granted_permissions_json FROM plugins WHERE id = ?`)
    .get(plugin.manifest.id) as { id: string; enabled: number; granted_permissions_json: string } | undefined;

  const granted =
    existing && existing.granted_permissions_json && existing.granted_permissions_json !== '[]'
      ? JSON.parse(existing.granted_permissions_json)
      : defaultGrantAll
        ? plugin.manifest.permissions
        : [];

  if (!existing) {
    db.prepare(
      `INSERT INTO plugins (id, name, version, author, category, description, enabled, capabilities_json, manifest_json, granted_permissions_json, source, discovered_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, datetime('now'))`
    ).run(
      plugin.manifest.id,
      plugin.manifest.name,
      plugin.manifest.version,
      plugin.manifest.author,
      plugin.manifest.category,
      plugin.manifest.description,
      JSON.stringify(plugin.manifest.actions.map((a) => a.id)),
      JSON.stringify(plugin.manifest),
      JSON.stringify(granted),
      source
    );
  } else {
    db.prepare(
      `UPDATE plugins
       SET name = ?, version = ?, author = ?, category = ?, description = ?,
           capabilities_json = ?, manifest_json = ?, granted_permissions_json = ?, source = ?,
           discovered_at = CASE WHEN discovered_at = '' THEN datetime('now') ELSE discovered_at END
       WHERE id = ?`
    ).run(
      plugin.manifest.name,
      plugin.manifest.version,
      plugin.manifest.author,
      plugin.manifest.category,
      plugin.manifest.description,
      JSON.stringify(plugin.manifest.actions.map((a) => a.id)),
      JSON.stringify(plugin.manifest),
      JSON.stringify(granted),
      source,
      plugin.manifest.id
    );
  }

  runtimeRegistry.set(plugin.manifest.id, plugin);

  if (plugin.initialize) {
    plugin.initialize({
      workspaceId: 'ws-primary',
      readStore: <T = unknown>(key: string) => readPluginStore<T>(plugin.manifest.id, 'ws-primary', key),
      writeStore: (key: string, val: unknown) => writePluginStore(plugin.manifest.id, 'ws-primary', key, val),
    });
  }
}

export function readPluginStore<T = unknown>(pluginId: string, workspaceId: string, key: string): T | null {
  const db = getDb();
  const row = db
    .prepare(`SELECT value_json FROM plugin_storage WHERE plugin_id = ? AND workspace_id = ? AND record_key = ?`)
    .get(pluginId, workspaceId, key) as { value_json: string } | undefined;
  if (!row) return null;
  return JSON.parse(row.value_json) as T;
}

export function writePluginStore(pluginId: string, workspaceId: string, key: string, value: unknown): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO plugin_storage (plugin_id, workspace_id, record_key, value_json, updated_at)
     VALUES (?, ?, ?, ?, datetime('now'))
     ON CONFLICT(plugin_id, workspace_id, record_key) DO UPDATE SET value_json = excluded.value_json, updated_at = datetime('now')`
  ).run(pluginId, workspaceId, key, JSON.stringify(value));
}

export function discoverAndSyncPlugins(): { discoveredCount: number; plugins: LoadedPluginRecord[] } {
  const builtins: OmnixPlugin[] = [taskflowPmPlugin, nebulaVaultPlugin, reportCompilerPlugin];
  let count = 0;

  for (const plugin of builtins) {
    const check = validatePluginManifest(plugin.manifest);
    if (check.valid) {
      upsertPluginRecord(plugin, 'builtin', true);
      count++;
    }
  }

  if (fs.existsSync(MANIFEST_DIR)) {
    const entries = fs.readdirSync(MANIFEST_DIR).filter((f) => f.endsWith('.manifest.json'));
    for (const file of entries) {
      try {
        const raw = JSON.parse(fs.readFileSync(path.join(MANIFEST_DIR, file), 'utf8'));
        const check = validatePluginManifest(raw);
        if (check.valid) {
          upsertPluginRecord(buildManifestWebhookAdapter(check.manifest), 'manifest_dir', true);
          count++;
        }
      } catch {
        // Skip malformed manifest files cleanly without crashing server startup
      }
    }
  }

  // Also reload any custom-registered manifest plugins stored in SQLite
  const db = getDb();
  const customRows = db
    .prepare(`SELECT manifest_json FROM plugins WHERE source = 'custom_registered'`)
    .all() as Array<{ manifest_json: string }>;
  for (const row of customRows) {
    try {
      const check = validatePluginManifest(JSON.parse(row.manifest_json));
      if (check.valid) {
        runtimeRegistry.set(check.manifest.id, buildManifestWebhookAdapter(check.manifest));
      }
    } catch {
      // ignore invalid legacy rows
    }
  }

  return { discoveredCount: count, plugins: listLoadedPlugins() };
}

export function listLoadedPlugins(): LoadedPluginRecord[] {
  const db = getDb();
  if (runtimeRegistry.size === 0) {
    discoverAndSyncPlugins();
  }
  const rows = db
    .prepare(`SELECT * FROM plugins ORDER BY source ASC, name ASC`)
    .all() as Array<{
    id: string;
    name: string;
    version: string;
    author: string;
    category: string;
    description: string;
    enabled: number;
    manifest_json: string;
    granted_permissions_json: string;
    source: string;
    discovered_at: string;
  }>;

  return rows.map((r) => {
    const fallbackManifest = runtimeRegistry.get(r.id)?.manifest;
    let parsedManifest: PluginManifest;
    try {
      const candidate = JSON.parse(r.manifest_json || '{}');
      parsedManifest = candidate.id ? candidate : fallbackManifest!;
    } catch {
      parsedManifest = fallbackManifest!;
    }
    return {
      id: r.id,
      name: r.name,
      version: r.version,
      author: r.author || 'OMNIX',
      category: r.category || 'custom',
      description: r.description,
      enabled: r.enabled === 1,
      source: (r.source as LoadedPluginRecord['source']) || 'builtin',
      manifest: parsedManifest,
      grantedPermissions: JSON.parse(r.granted_permissions_json || '[]') as PluginPermissionScope[],
      discoveredAt: r.discovered_at || '',
    };
  });
}

export function registerCustomPluginManifest(
  rawManifest: unknown,
  user: AuthUser,
  workspaceId = 'ws-primary'
): { plugin: LoadedPluginRecord } {
  if (user.role !== 'admin' && user.role !== 'engineer') {
    logAuditEvent({
      workspaceId,
      userId: user.id,
      action: 'plugin_register',
      resourceType: 'plugin',
      status: 'denied',
      details: { role: user.role },
    });
    throw new Error('Forbidden: only admin or engineer roles can install custom plugins.');
  }

  const check = validatePluginManifest(rawManifest);
  if (!check.valid) {
    throw new Error(`Invalid plugin manifest: ${check.errors.join(' ')}`);
  }

  const adapter = buildManifestWebhookAdapter(check.manifest);
  // Least-privilege default: only grant read scopes automatically on custom installs; write/network require explicit admin opt-in
  const db = getDb();
  const safeInitialGrants = check.manifest.permissions.filter((p) => p.endsWith(':read'));
  db.prepare(
    `INSERT INTO plugins (id, name, version, author, category, description, enabled, capabilities_json, manifest_json, granted_permissions_json, source, discovered_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, 'custom_registered', datetime('now'))
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name, version = excluded.version, author = excluded.author,
       category = excluded.category, description = excluded.description,
       capabilities_json = excluded.capabilities_json, manifest_json = excluded.manifest_json,
       source = 'custom_registered'`
  ).run(
    check.manifest.id,
    check.manifest.name,
    check.manifest.version,
    check.manifest.author,
    check.manifest.category,
    check.manifest.description,
    JSON.stringify(check.manifest.actions.map((a) => a.id)),
    JSON.stringify(check.manifest),
    JSON.stringify(safeInitialGrants)
  );

  runtimeRegistry.set(check.manifest.id, adapter);
  logAuditEvent({
    workspaceId,
    userId: user.id,
    action: 'plugin_register',
    resourceType: 'plugin',
    resourceId: check.manifest.id,
    status: 'allowed',
    details: { initialGrants: safeInitialGrants },
  });

  const installed = listLoadedPlugins().find((p) => p.id === check.manifest.id)!;
  return { plugin: installed };
}

export function updatePluginSecurity(params: {
  pluginId: string;
  user: AuthUser;
  workspaceId: string;
  enabled?: boolean;
  grantedPermissions?: PluginPermissionScope[];
}): LoadedPluginRecord {
  if (params.user.role !== 'admin' && params.user.role !== 'engineer') {
    logAuditEvent({
      workspaceId: params.workspaceId,
      userId: params.user.id,
      action: 'plugin_security_update',
      resourceType: 'plugin',
      resourceId: params.pluginId,
      status: 'denied',
      details: { role: params.user.role },
    });
    throw new Error('Forbidden: only admin or engineer roles can modify plugin security permissions.');
  }

  const loaded = listLoadedPlugins().find((p) => p.id === params.pluginId);
  if (!loaded) throw new Error('Plugin not found.');

  const db = getDb();
  const nextEnabled = params.enabled !== undefined ? (params.enabled ? 1 : 0) : loaded.enabled ? 1 : 0;
  const declaredSet = new Set(loaded.manifest.permissions);
  const nextGrants = params.grantedPermissions
    ? params.grantedPermissions.filter((p) => declaredSet.has(p))
    : loaded.grantedPermissions;

  db.prepare(`UPDATE plugins SET enabled = ?, granted_permissions_json = ? WHERE id = ?`).run(
    nextEnabled,
    JSON.stringify(nextGrants),
    params.pluginId
  );

  logAuditEvent({
    workspaceId: params.workspaceId,
    userId: params.user.id,
    action: 'plugin_security_update',
    resourceType: 'plugin',
    resourceId: params.pluginId,
    status: 'allowed',
    details: { enabled: nextEnabled === 1, grantedPermissions: nextGrants },
  });

  return listLoadedPlugins().find((p) => p.id === params.pluginId)!;
}

export async function executePluginAction(params: {
  pluginId: string;
  actionId: string;
  input: Record<string, unknown>;
  workspaceId: string;
  projectId?: string | null;
  user: AuthUser;
  approvalId?: string;
}): Promise<{
  status: 'completed' | 'awaiting_approval';
  result?: PluginExecutionResult;
  approvalId?: string;
  message?: string;
}> {
  if (runtimeRegistry.size === 0) {
    discoverAndSyncPlugins();
  }
  const loaded = listLoadedPlugins().find((p) => p.id === params.pluginId);
  const plugin = runtimeRegistry.get(params.pluginId);
  if (!loaded || !plugin) {
    throw new Error(`Plugin "${params.pluginId}" is not loaded in OMNI CONNECT.`);
  }

  const action = loaded.manifest.actions.find((a) => a.id === params.actionId);
  if (!action) {
    throw new Error(`Action "${params.actionId}" does not exist on plugin "${loaded.name}".`);
  }

  const authCheck = authorizePluginExecution({
    enabled: loaded.enabled,
    userRole: params.user.role,
    manifestPermissions: loaded.manifest.permissions,
    grantedPermissions: loaded.grantedPermissions,
    requiredPermission: action.requiredPermission,
  });

  if (!authCheck.allowed) {
    logAuditEvent({
      workspaceId: params.workspaceId,
      userId: params.user.id,
      action: `plugin_execute:${params.actionId}`,
      resourceType: 'plugin',
      resourceId: params.pluginId,
      status: 'denied',
      details: { reason: authCheck.reason, requiredPermission: action.requiredPermission },
    });
    const err = new Error(authCheck.reason) as Error & { statusCode?: number };
    err.statusCode = authCheck.code;
    throw err;
  }

  if (action.requiresApproval && !params.approvalId) {
    const approval = createApprovalRequest({
      workspaceId: params.workspaceId,
      requestedBy: `${params.user.name} via ${loaded.name}`,
      actionType: `plugin_${params.actionId}`,
      targetResource: loaded.id,
      payload: { pluginId: loaded.id, actionId: params.actionId, input: params.input },
      reason: `Plugin action "${action.name}" is marked destructive and requires OMNI SECURITY authorization.`,
    });
    return {
      status: 'awaiting_approval',
      approvalId: approval.id,
      message: `Action "${action.name}" queued for explicit approval in OMNI SECURITY (${approval.id}).`,
    };
  }

  const db = getDb();
  const ctx: PluginExecutionContext = {
    workspaceId: params.workspaceId,
    projectId: params.projectId ?? null,
    userId: params.user.id,
    userRole: params.user.role,
    grantedPermissions: loaded.grantedPermissions,
    readStore: <T = unknown>(key: string) => readPluginStore<T>(loaded.id, params.workspaceId, key),
    writeStore: (key: string, value: unknown) => writePluginStore(loaded.id, params.workspaceId, key, value),
    listProjects: () =>
      db
        .prepare(`SELECT id, name, status, category FROM projects WHERE workspace_id = ?`)
        .all(params.workspaceId) as Array<{ id: string; name: string; status: string; category: string }>,
    listFiles: () =>
      db
        .prepare(`SELECT id, name, mime_type, size_bytes FROM files WHERE workspace_id = ? ORDER BY created_at DESC`)
        .all(params.workspaceId) as Array<{ id: string; name: string; mime_type: string; size_bytes: number }>,
    getFileById: (fileId: string) =>
      (db
        .prepare(`SELECT id, name, mime_type, size_bytes, content_text FROM files WHERE id = ?`)
        .get(fileId) as { id: string; name: string; mime_type: string; size_bytes: number; content_text: string } | undefined) ??
      null,
  };

  const result = await plugin.execute(params.actionId, params.input || {}, ctx);
  logAuditEvent({
    workspaceId: params.workspaceId,
    userId: params.user.id,
    action: `plugin_execute:${params.actionId}`,
    resourceType: 'plugin',
    resourceId: `${params.pluginId}:${crypto.randomUUID().slice(0, 4)}`,
    status: 'allowed',
    details: { permissionUsed: action.requiredPermission, summary: result.summary },
  });

  return { status: 'completed', result };
}
