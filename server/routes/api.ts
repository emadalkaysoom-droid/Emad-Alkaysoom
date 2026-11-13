import { Router } from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getDb, createDatabaseBackup } from '../db/schema.ts';
import {
  authenticateCredentials,
  checkPermission,
  createApprovalRequest,
  getActiveUserFromRequest,
  logAuditEvent,
  rateLimitMiddleware,
  validateSafeFilename,
} from '../core/security.ts';
import { invokeModelGateway, isGeminiConfigured } from '../core/modelGateway.ts';
import {
  compileReportArtifact,
  executeSandboxedJavaScript,
  parseFileRows,
} from '../core/executionEngine.ts';
import { orchestrateDirective } from '../core/omniBrain.ts';
import { runLiveSystemHealthChecks } from '../core/health.ts';
import {
  discoverAndSyncPlugins,
  executePluginAction,
  listLoadedPlugins,
  registerCustomPluginManifest,
  updatePluginSecurity,
} from '../plugins/pluginManager.ts';
import type { PluginPermissionScope } from '../../shared/pluginContract.ts';
import {
  analyzeDataset,
  interpretNaturalLanguageDataQuery,
  type DataRow,
} from '../../shared/dataEngine.ts';
import { evaluateMathExpression } from '../../shared/mathSandbox.ts';
import {
  synthesize3DBlueprint,
  synthesizeWorldBlueprint,
} from '../core/designSynthesizer.ts';
import { getUserSubscriptionSummary } from '../core/billingEngine.ts';
import { createExpansionRouter } from './expansionRoutes.ts';

const execFileAsync = promisify(execFile);

export function createApiRouter(): Router {
  const router = Router();
  router.use(rateLimitMiddleware(300, 60_000));

  // --- AUTH & WORKSPACE ---
  router.get('/auth/session', (req, res) => {
    const user = getActiveUserFromRequest(req);
    const db = getDb();
    const workspaces = db.prepare(`SELECT * FROM workspaces ORDER BY created_at ASC`).all();
    const subscription = getUserSubscriptionSummary(user.id);
    res.json({ user, workspaces, subscription, geminiConfigured: isGeminiConfigured() });
  });

  router.post('/auth/login', (req, res) => {
    const { email, password } = req.body as { email?: string; password?: string };
    if (!email || !password) {
      res.status(400).json({ error: 'Email and password are required.' });
      return;
    }
    const auth = authenticateCredentials(email, password);
    if (!auth) {
      logAuditEvent({
        action: 'auth_login_failed',
        resourceType: 'user',
        resourceId: email,
        status: 'denied',
      });
      res.status(401).json({ error: 'Invalid credentials.' });
      return;
    }
    logAuditEvent({
      userId: auth.user.id,
      action: 'auth_login',
      resourceType: 'user',
      resourceId: auth.user.id,
      status: 'allowed',
    });
    res.json(auth);
  });

  router.post('/auth/role-switch', (req, res) => {
    const user = getActiveUserFromRequest(req);
    const { role } = req.body as { role?: 'admin' | 'engineer' | 'analyst' | 'viewer' };
    if (!role || !['admin', 'engineer', 'analyst', 'viewer'].includes(role)) {
      res.status(400).json({ error: 'Invalid role' });
      return;
    }
    const db = getDb();
    db.prepare(`UPDATE users SET role = ? WHERE id = ?`).run(role, user.id);
    logAuditEvent({
      userId: user.id,
      action: 'role_switch',
      resourceType: 'user',
      resourceId: user.id,
      status: 'allowed',
      details: { newRole: role },
    });
    res.json({ ...user, role });
  });

  // --- DASHBOARD ---
  router.get('/dashboard', (req, res) => {
    const workspaceId = String(req.query.workspaceId || 'ws-primary');
    const db = getDb();

    const projects = db
      .prepare(`SELECT * FROM projects WHERE workspace_id = ? ORDER BY updated_at DESC`)
      .all(workspaceId);
    const recentTasks = db
      .prepare(
        `SELECT t.*, a.name as agent_name FROM agent_tasks t
         JOIN agents a ON t.agent_id = a.id
         WHERE t.workspace_id = ? ORDER BY t.created_at DESC LIMIT 12`
      )
      .all(workspaceId);
    const files = db
      .prepare(`SELECT id, name, mime_type, size_bytes, created_at FROM files WHERE workspace_id = ?`)
      .all(workspaceId) as Array<{ size_bytes: number }>;
    const storageBytes = files.reduce((sum, f) => sum + (f.size_bytes || 0), 0);
    const usage = db
      .prepare(
        `SELECT COUNT(*) as calls, COALESCE(SUM(tokens_in + tokens_out), 0) as total_tokens,
         COALESCE(AVG(latency_ms), 0) as avg_latency_ms
         FROM usage_metrics WHERE workspace_id = ?`
      )
      .get(workspaceId) as { calls: number; total_tokens: number; avg_latency_ms: number };
    const notifications = db
      .prepare(`SELECT * FROM notifications WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 15`)
      .all(workspaceId);
    const pendingApprovals = (
      db
        .prepare(`SELECT COUNT(*) as c FROM pending_approvals WHERE workspace_id = ? AND status = 'pending'`)
        .get(workspaceId) as { c: number }
    ).c;

    const health = runLiveSystemHealthChecks();

    res.json({
      projects,
      recentTasks,
      storageBytes,
      fileCount: files.length,
      usage: {
        calls: usage.calls,
        totalTokens: usage.total_tokens,
        avgLatencyMs: Math.round(usage.avg_latency_ms),
      },
      notifications,
      pendingApprovals,
      health,
    });
  });

  // --- GLOBAL SEARCH ---
  router.get('/search', (req, res) => {
    const workspaceId = String(req.query.workspaceId || 'ws-primary');
    const q = `%${String(req.query.q || '').trim()}%`;
    const db = getDb();
    const projects = db
      .prepare(`SELECT id, name, category FROM projects WHERE workspace_id = ? AND (name LIKE ? OR description LIKE ?) LIMIT 5`)
      .all(workspaceId, q, q);
    const memories = db
      .prepare(`SELECT id, title, scope FROM memory_entries WHERE workspace_id = ? AND (title LIKE ? OR content LIKE ?) LIMIT 5`)
      .all(workspaceId, q, q);
    const files = db
      .prepare(`SELECT id, name, mime_type FROM files WHERE workspace_id = ? AND name LIKE ? LIMIT 5`)
      .all(workspaceId, q);
    res.json({ projects, memories, files });
  });

  // --- PROJECTS & FILES (OMNI WORKSPACE) ---
  router.get('/projects', (req, res) => {
    const workspaceId = String(req.query.workspaceId || 'ws-primary');
    const db = getDb();
    const projects = db
      .prepare(`SELECT * FROM projects WHERE workspace_id = ? ORDER BY updated_at DESC`)
      .all(workspaceId);
    res.json({ projects });
  });

  router.post('/projects', (req, res) => {
    const user = getActiveUserFromRequest(req);
    if (!checkPermission(user.role, 'projects', 'write')) {
      res.status(403).json({ error: 'Insufficient role permissions to create projects.' });
      return;
    }
    const { workspaceId = 'ws-primary', name, description = '', category = 'general' } = req.body as {
      workspaceId?: string;
      name?: string;
      description?: string;
      category?: string;
    };
    if (!name || !name.trim()) {
      res.status(400).json({ error: 'Project name is required.' });
      return;
    }
    const db = getDb();
    const id = `proj-${crypto.randomUUID().slice(0, 8)}`;
    db.prepare(
      `INSERT INTO projects (id, workspace_id, name, description, category, created_by) VALUES (?, ?, ?, ?, ?, ?)`
    ).run(id, workspaceId, name.trim(), description.trim(), category, user.id);

    // Link in Knowledge Graph
    db.prepare(
      `INSERT INTO knowledge_nodes (id, workspace_id, project_id, node_type, label) VALUES (?, ?, ?, 'project', ?)`
    ).run(`node-${id}`, workspaceId, id, name.trim());

    logAuditEvent({
      workspaceId,
      userId: user.id,
      action: 'project_create',
      resourceType: 'project',
      resourceId: id,
      status: 'allowed',
    });

    const project = db.prepare(`SELECT * FROM projects WHERE id = ?`).get(id);
    res.status(201).json({ project });
  });

  router.get('/projects/:id', (req, res) => {
    const db = getDb();
    const project = db.prepare(`SELECT * FROM projects WHERE id = ?`).get(req.params.id);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    const files = db.prepare(`SELECT id, name, mime_type, size_bytes, created_at FROM files WHERE project_id = ?`).all(req.params.id);
    const tasks = db
      .prepare(`SELECT t.*, a.name as agent_name FROM agent_tasks t JOIN agents a ON t.agent_id = a.id WHERE t.project_id = ? ORDER BY t.created_at DESC`)
      .all(req.params.id);
    const reports = db.prepare(`SELECT id, title, format, summary, created_at FROM reports WHERE project_id = ? ORDER BY created_at DESC`).all(req.params.id);
    const assets3d = db.prepare(`SELECT id, name, prompt, created_at FROM three_d_assets WHERE project_id = ? ORDER BY created_at DESC`).all(req.params.id);
    const conversations = db.prepare(`SELECT * FROM conversations WHERE project_id = ? ORDER BY updated_at DESC`).all(req.params.id);
    res.json({ project, files, tasks, reports, assets3d, conversations });
  });

  router.delete('/projects/:id', (req, res) => {
    const user = getActiveUserFromRequest(req);
    const workspaceId = String(req.query.workspaceId || 'ws-primary');
    const approvedId = req.query.approvalId ? String(req.query.approvalId) : null;
    const db = getDb();

    if (!approvedId) {
      const approval = createApprovalRequest({
        workspaceId,
        requestedBy: user.name,
        actionType: 'delete_project',
        targetResource: req.params.id,
        payload: { projectId: req.params.id },
        reason: 'Deleting a project removes associated workspace references.',
      });
      res.status(202).json({
        approvalRequired: true,
        approvalId: approval.id,
        message: 'Deletion queued for explicit authorization in OMNI SECURITY.',
      });
      return;
    }

    db.prepare(`DELETE FROM projects WHERE id = ?`).run(req.params.id);
    logAuditEvent({
      workspaceId,
      userId: user.id,
      action: 'project_delete',
      resourceType: 'project',
      resourceId: req.params.id,
      status: 'approved',
    });
    res.json({ deleted: true });
  });

  router.get('/files', (req, res) => {
    const workspaceId = String(req.query.workspaceId || 'ws-primary');
    const db = getDb();
    const files = db
      .prepare(`SELECT id, workspace_id, project_id, name, mime_type, size_bytes, created_at FROM files WHERE workspace_id = ? ORDER BY created_at DESC`)
      .all(workspaceId);
    res.json({ files });
  });

  router.post('/files', (req, res) => {
    const user = getActiveUserFromRequest(req);
    const {
      workspaceId = 'ws-primary',
      projectId = null,
      name,
      mimeType = 'text/plain',
      contentText = '',
    } = req.body as {
      workspaceId?: string;
      projectId?: string | null;
      name?: string;
      mimeType?: string;
      contentText?: string;
    };

    if (!name) {
      res.status(400).json({ error: 'File name is required.' });
      return;
    }
    const safeName = validateSafeFilename(name);
    const sizeBytes = Buffer.byteLength(contentText, 'utf8');
    if (sizeBytes > 5 * 1024 * 1024) {
      res.status(413).json({ error: 'File exceeds 5MB text upload limit.' });
      return;
    }

    const db = getDb();
    const id = `file-${crypto.randomUUID().slice(0, 8)}`;
    db.prepare(
      `INSERT INTO files (id, workspace_id, project_id, name, mime_type, size_bytes, content_text, uploaded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, workspaceId, projectId, safeName, mimeType, sizeBytes, contentText, user.id);

    logAuditEvent({
      workspaceId,
      userId: user.id,
      action: 'file_upload',
      resourceType: 'file',
      resourceId: id,
      status: 'allowed',
      details: { safeName, sizeBytes },
    });

    res.status(201).json({
      file: { id, workspace_id: workspaceId, project_id: projectId, name: safeName, mime_type: mimeType, size_bytes: sizeBytes },
    });
  });

  router.get('/files/:id', (req, res) => {
    const db = getDb();
    const file = db.prepare(`SELECT * FROM files WHERE id = ?`).get(req.params.id);
    if (!file) {
      res.status(404).json({ error: 'File not found' });
      return;
    }
    res.json({ file });
  });

  // --- OMNI BRAIN & CONVERSATIONS (User-Scoped Isolation) ---
  router.get('/conversations', (req, res) => {
    const user = getActiveUserFromRequest(req);
    const workspaceId = String(req.query.workspaceId || 'ws-primary');
    const db = getDb();
    const conversations = db
      .prepare(`SELECT * FROM conversations WHERE workspace_id = ? AND user_id = ? ORDER BY updated_at DESC`)
      .all(workspaceId, user.id);
    res.json({ conversations });
  });

  router.get('/conversations/:id/messages', (req, res) => {
    const user = getActiveUserFromRequest(req);
    const db = getDb();
    const conv = db
      .prepare(`SELECT id, user_id FROM conversations WHERE id = ?`)
      .get(req.params.id) as { id: string; user_id: string } | undefined;
    if (!conv || conv.user_id !== user.id) {
      res.status(403).json({ error: 'Conversation access denied.' });
      return;
    }
    const messages = db
      .prepare(`SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC`)
      .all(req.params.id);
    res.json({ messages });
  });

  router.post('/brain/orchestrate', async (req, res) => {
    try {
      const user = getActiveUserFromRequest(req);
      const {
        workspaceId = 'ws-primary',
        projectId = null,
        conversationId = null,
        prompt,
        fileId,
        preferredModel,
        thinkingLevel,
        imageBase64,
      } = req.body as {
        workspaceId?: string;
        projectId?: string | null;
        conversationId?: string | null;
        prompt?: string;
        fileId?: string;
        preferredModel?: string;
        thinkingLevel?: 'LOW' | 'MEDIUM' | 'HIGH';
        imageBase64?: { mimeType: string; data: string };
      };

      if (!prompt || !prompt.trim()) {
        res.status(400).json({ error: 'Prompt is required.' });
        return;
      }

      const result = await orchestrateDirective({
        workspaceId,
        projectId,
        conversationId,
        userId: user.id,
        prompt: prompt.trim(),
        fileId,
        preferredModel,
        thinkingLevel,
        imageBase64,
      });

      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Orchestration failed' });
    }
  });

  // --- AGENTS & WORKFLOW TASKS ---
  router.get('/agents', (req, res) => {
    const workspaceId = String(req.query.workspaceId || 'ws-primary');
    const db = getDb();
    const agents = db.prepare(`SELECT * FROM agents`).all();
    const tasks = db
      .prepare(
        `SELECT t.*, a.name as agent_name FROM agent_tasks t
         JOIN agents a ON t.agent_id = a.id
         WHERE t.workspace_id = ? ORDER BY t.created_at DESC LIMIT 40`
      )
      .all(workspaceId);
    const executions = db
      .prepare(`SELECT * FROM task_executions ORDER BY executed_at DESC LIMIT 40`)
      .all();
    res.json({ agents, tasks, executions });
  });

  router.post('/tasks/schedule', (req, res) => {
    const user = getActiveUserFromRequest(req);
    const {
      workspaceId = 'ws-primary',
      projectId = null,
      agentId = 'agent-planning',
      title,
      description = '',
      scheduledFor = null,
      priority = 2,
    } = req.body as {
      workspaceId?: string;
      projectId?: string | null;
      agentId?: string;
      title?: string;
      description?: string;
      scheduledFor?: string | null;
      priority?: number;
    };
    if (!title || !title.trim()) {
      res.status(400).json({ error: 'Task title is required.' });
      return;
    }
    const db = getDb();
    const id = `task-${crypto.randomUUID().slice(0, 8)}`;
    db.prepare(
      `INSERT INTO agent_tasks (id, workspace_id, project_id, agent_id, title, description, status, priority, scheduled_for)
       VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?)`
    ).run(id, workspaceId, projectId, agentId, title.trim(), description, priority, scheduledFor);

    logAuditEvent({
      workspaceId,
      userId: user.id,
      action: 'task_scheduled',
      resourceType: 'agent_task',
      resourceId: id,
      status: 'allowed',
    });

    res.status(201).json({ taskId: id });
  });

  router.post('/tasks/:id/execute', (req, res) => {
    const db = getDb();
    const task = db.prepare(`SELECT * FROM agent_tasks WHERE id = ?`).get(req.params.id) as
      | { id: string; workspace_id: string; agent_id: string; title: string; description: string }
      | undefined;
    if (!task) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }
    const t0 = performance.now();
    let output: Record<string, unknown> = {};
    if (task.agent_id === 'agent-math' && task.description) {
      output = { ...evaluateMathExpression(task.description) };
    } else if (task.agent_id === 'agent-coding' && task.description) {
      output = executeSandboxedJavaScript(task.description);
    } else {
      output = { executed: true, title: task.title, timestamp: new Date().toISOString() };
    }
    const durationMs = Math.round(performance.now() - t0);
    db.prepare(`UPDATE agent_tasks SET status = 'completed', updated_at = datetime('now') WHERE id = ?`).run(task.id);
    db.prepare(`UPDATE agents SET tasks_completed = tasks_completed + 1 WHERE id = ?`).run(task.agent_id);
    db.prepare(
      `INSERT INTO task_executions (id, task_id, agent_id, input_json, output_json, duration_ms, verified_by_qa)
       VALUES (?, ?, ?, '{}', ?, ?, 1)`
    ).run(`exec-${crypto.randomUUID().slice(0, 8)}`, task.id, task.agent_id, JSON.stringify(output), durationMs);

    res.json({ status: 'completed', output, durationMs });
  });

  // --- MEMORY & KNOWLEDGE GRAPH ---
  router.get('/memory', (req, res) => {
    const workspaceId = String(req.query.workspaceId || 'ws-primary');
    const q = String(req.query.q || '').trim();
    const db = getDb();
    const entries = q
      ? db
          .prepare(
            `SELECT * FROM memory_entries WHERE workspace_id = ? AND (title LIKE ? OR content LIKE ?) ORDER BY created_at DESC`
          )
          .all(workspaceId, `%${q}%`, `%${q}%`)
      : db
          .prepare(`SELECT * FROM memory_entries WHERE workspace_id = ? ORDER BY created_at DESC`)
          .all(workspaceId);
    const nodes = db
      .prepare(`SELECT * FROM knowledge_nodes WHERE workspace_id = ?`)
      .all(workspaceId);
    const relations = db
      .prepare(`SELECT * FROM knowledge_relations WHERE workspace_id = ?`)
      .all(workspaceId);
    res.json({ entries, nodes, relations });
  });

  router.post('/memory', (req, res) => {
    const user = getActiveUserFromRequest(req);
    const {
      workspaceId = 'ws-primary',
      projectId = null,
      scope = 'long_term',
      title,
      content,
      tags = [],
    } = req.body as {
      workspaceId?: string;
      projectId?: string | null;
      scope?: 'short_term' | 'long_term';
      title?: string;
      content?: string;
      tags?: string[];
    };
    if (!title?.trim() || !content?.trim()) {
      res.status(400).json({ error: 'Memory title and content are required.' });
      return;
    }
    const db = getDb();
    const id = `mem-${crypto.randomUUID().slice(0, 8)}`;
    db.prepare(
      `INSERT INTO memory_entries (id, workspace_id, project_id, scope, title, content, source, tags_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, workspaceId, projectId, scope, title.trim(), content.trim(), user.name, JSON.stringify(tags));

    // Also add Knowledge Graph node
    db.prepare(
      `INSERT INTO knowledge_nodes (id, workspace_id, project_id, node_type, label) VALUES (?, ?, ?, 'idea', ?)`
    ).run(`node-${id}`, workspaceId, projectId, title.trim());

    res.status(201).json({ id, title: title.trim(), scope });
  });

  router.post('/knowledge-graph/link', (req, res) => {
    const { workspaceId = 'ws-primary', sourceNodeId, targetNodeId, relationType } = req.body as {
      workspaceId?: string;
      sourceNodeId?: string;
      targetNodeId?: string;
      relationType?: string;
    };
    if (!sourceNodeId || !targetNodeId || !relationType) {
      res.status(400).json({ error: 'sourceNodeId, targetNodeId, and relationType are required.' });
      return;
    }
    const db = getDb();
    const id = `rel-${crypto.randomUUID().slice(0, 8)}`;
    db.prepare(
      `INSERT INTO knowledge_relations (id, workspace_id, source_node_id, target_node_id, relation_type)
       VALUES (?, ?, ?, ?, ?)`
    ).run(id, workspaceId, sourceNodeId, targetNodeId, relationType);
    res.status(201).json({ id });
  });

  router.delete('/memory/:id', (req, res) => {
    const user = getActiveUserFromRequest(req);
    const workspaceId = String(req.query.workspaceId || 'ws-primary');
    const approvedId = req.query.approvalId ? String(req.query.approvalId) : null;
    if (!approvedId) {
      const approval = createApprovalRequest({
        workspaceId,
        requestedBy: user.name,
        actionType: 'delete_memory',
        targetResource: req.params.id,
        payload: { memoryId: req.params.id },
        reason: 'Deleting long-term memory requires explicit authorization.',
      });
      res.status(202).json({
        approvalRequired: true,
        approvalId: approval.id,
        message: 'Memory deletion queued for approval in OMNI SECURITY.',
      });
      return;
    }
    const db = getDb();
    db.prepare(`DELETE FROM memory_entries WHERE id = ?`).run(req.params.id);
    logAuditEvent({
      workspaceId,
      userId: user.id,
      action: 'memory_delete',
      resourceType: 'memory',
      resourceId: req.params.id,
      status: 'approved',
    });
    res.json({ deleted: true });
  });

  // --- OMNI VISION ---
  router.post('/vision/analyze', async (req, res) => {
    try {
      const {
        workspaceId = 'ws-primary',
        question = 'Describe the objects, visible text, and structural components in this image.',
        mode = 'vqa',
        imageBase64,
        mimeType = 'image/png',
        imageMeta,
      } = req.body as {
        workspaceId?: string;
        question?: string;
        mode?: 'vqa' | 'ocr' | 'diff';
        imageBase64?: string;
        mimeType?: string;
        imageMeta?: { width?: number; height?: number; sizeBytes?: number; meanLuminance?: number; edgeDensity?: number };
      };

      if (!imageBase64) {
        res.status(400).json({ error: 'Image base64 payload is required.' });
        return;
      }

      const cleanBase64 = imageBase64.replace(/^data:[^;]+;base64,/, '');
      const result = await invokeModelGateway({
        workspaceId,
        imageBase64: { mimeType, data: cleanBase64 },
        systemInstruction:
          mode === 'ocr'
            ? 'Extract all visible text verbatim and list confidence and illegible areas.'
            : 'Analyze the visual scene, identify objects/components, state confidence levels, and explicitly note any visual limitations or occlusions.',
        prompt: question,
        localFallbackHandler: () => {
          const w = imageMeta?.width ?? 'unknown';
          const h = imageMeta?.height ?? 'unknown';
          const lum = imageMeta?.meanLuminance !== undefined ? `${imageMeta.meanLuminance}/255` : 'not measured';
          const edges = imageMeta?.edgeDensity !== undefined ? `${(imageMeta.edgeDensity * 100).toFixed(1)}%` : 'not measured';
          return [
            `Local Vision Signal Inspection (${mode.toUpperCase()}):`,
            `• Dimensions: ${w}x${h} px · MIME: ${mimeType}`,
            `• Measured Mean Luminance: ${lum} · High-Contrast Edge Density: ${edges}`,
            `• Limitation Notice: Cloud Vision model (GEMINI_API_KEY) is not configured in this environment, so semantic object classification and neural OCR cannot be fabricated locally. Client-side pixel telemetry and change-detection diffing remain fully functional.`,
          ].join('\n');
        },
      });

      res.json({
        analysis: result.text,
        confidenceNote:
          result.provider === 'cloud-gemini'
            ? 'Multimodal inference executed via Gemini Vision (gemini-4-hydrogen).'
            : 'Signal-level inspection only (Cloud Vision API key not configured).',
        gateway: result,
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Vision analysis failed' });
    }
  });

  // --- OMNI VOICE (Audio Summarization & Command Routing) ---
  router.post('/voice/command', async (req, res) => {
    const user = getActiveUserFromRequest(req);
    const { workspaceId = 'ws-primary', transcript, language = 'en' } = req.body as {
      workspaceId?: string;
      transcript?: string;
      language?: string;
    };
    if (!transcript?.trim()) {
      res.status(400).json({ error: 'Transcript is required.' });
      return;
    }
    const result = await orchestrateDirective({
      workspaceId,
      userId: user.id,
      prompt: transcript.trim(),
    });
    res.json({ ...result, detectedLanguage: /[\u0600-\u06FF]/.test(transcript) ? 'ar' : language });
  });

  // --- OMNI DATA & REPORTING ---
  router.post('/data/parse-and-analyze', (req, res) => {
    try {
      const { fileName = 'dataset.csv', mimeType = 'text/csv', contentText, base64Buffer, fileId } = req.body as {
        fileName?: string;
        mimeType?: string;
        contentText?: string;
        base64Buffer?: string;
        fileId?: string;
      };

      let rows: DataRow[] = [];
      let resolvedName = fileName;

      if (fileId) {
        const db = getDb();
        const file = db.prepare(`SELECT name, mime_type, content_text FROM files WHERE id = ?`).get(fileId) as
          | { name: string; mime_type: string; content_text: string }
          | undefined;
        if (!file) {
          res.status(404).json({ error: 'File not found' });
          return;
        }
        resolvedName = file.name;
        rows = parseFileRows({ fileName: file.name, mimeType: file.mime_type, contentText: file.content_text });
      } else {
        rows = parseFileRows({ fileName, mimeType, contentText, base64Buffer });
      }

      const analysis = analyzeDataset(rows);
      res.json({ fileName: resolvedName, rows: rows.slice(0, 200), totalRows: rows.length, analysis });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to parse dataset' });
    }
  });

  router.post('/data/nl-query', (req, res) => {
    try {
      const { query, rows } = req.body as { query?: string; rows?: DataRow[] };
      if (!query || !Array.isArray(rows)) {
        res.status(400).json({ error: 'Query and rows array are required.' });
        return;
      }
      const analysis = analyzeDataset(rows);
      const result = interpretNaturalLanguageDataQuery(query, rows, analysis);
      res.json({ result, analysis });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'NL query failed' });
    }
  });

  router.post('/reports/generate', async (req, res) => {
    try {
      const {
        workspaceId = 'ws-primary',
        projectId = null,
        title = 'OMNIX Intelligence Report',
        format = 'pdf',
        summary = '',
        sections = [],
        tableRows = [],
      } = req.body as {
        workspaceId?: string;
        projectId?: string | null;
        title?: string;
        format?: 'pdf' | 'docx' | 'xlsx' | 'csv' | 'html';
        summary?: string;
        sections?: Array<{ heading: string; body: string }>;
        tableRows?: DataRow[];
      };

      const compiled = await compileReportArtifact({
        workspaceId,
        projectId,
        title,
        format,
        summary,
        sections,
        tableRows,
      });

      res.setHeader('Content-Type', compiled.mimeType);
      res.setHeader('Content-Disposition', `attachment; filename="${compiled.fileName}"`);
      res.setHeader('X-Report-Id', compiled.reportId);
      res.send(compiled.buffer);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Report compilation failed' });
    }
  });

  // --- OMNI 3D & OMNI WORLD & OMNI SIM ---
  router.get('/3d/assets', (req, res) => {
    const workspaceId = String(req.query.workspaceId || 'ws-primary');
    const db = getDb();
    const assets = db
      .prepare(`SELECT * FROM three_d_assets WHERE workspace_id = ? ORDER BY created_at DESC`)
      .all(workspaceId);
    res.json({ assets });
  });

  router.post('/3d/generate', async (req, res) => {
    try {
      const {
        workspaceId = 'ws-primary',
        projectId = null,
        prompt = 'robotic arm',
        preferredModel,
        currentSceneContext,
      } = req.body as {
        workspaceId?: string;
        projectId?: string | null;
        prompt?: string;
        preferredModel?: string;
        currentSceneContext?: { title: string; partCount: number; partNames: string[] };
      };
      const synthesized = await synthesize3DBlueprint({
        prompt,
        workspaceId,
        preferredModel,
        currentSceneContext,
      });
      const blueprint = synthesized.blueprint;
      const db = getDb();
      const id = `3d-${crypto.randomUUID().slice(0, 8)}`;
      db.prepare(
        `INSERT INTO three_d_assets (id, workspace_id, project_id, name, prompt, format, blueprint_json)
         VALUES (?, ?, ?, ?, ?, 'parametric-json', ?)`
      ).run(id, workspaceId, projectId, blueprint.title, prompt, JSON.stringify(blueprint));
      res.status(201).json({
        id,
        blueprint,
        intentAcknowledgment: synthesized.intentAcknowledgment,
        provider: synthesized.provider,
        model: synthesized.model,
        isFallback: synthesized.isFallback,
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : '3D generation failed' });
    }
  });

  router.post('/world/generate', async (req, res) => {
    try {
      const {
        workspaceId = 'ws-primary',
        projectId = null,
        prompt = 'digital twin campus',
        preferredModel,
      } = req.body as {
        workspaceId?: string;
        projectId?: string | null;
        prompt?: string;
        preferredModel?: string;
      };
      const synthesized = await synthesizeWorldBlueprint({ prompt, workspaceId, preferredModel });
      const world = synthesized.world;
      const db = getDb();
      const id = `sim-${crypto.randomUUID().slice(0, 8)}`;
      db.prepare(
        `INSERT INTO simulation_projects (id, workspace_id, project_id, name, sim_type, config_json, results_json)
         VALUES (?, ?, ?, ?, 'digital_world', ?, ?)`
      ).run(id, workspaceId, projectId, world.title, JSON.stringify(world), JSON.stringify({ generatedAt: new Date().toISOString() }));
      res.status(201).json({
        id,
        world,
        provider: synthesized.provider,
        model: synthesized.model,
        isFallback: synthesized.isFallback,
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'World generation failed' });
    }
  });

  router.post('/simulations/save', (req, res) => {
    const { workspaceId = 'ws-primary', name = 'Rigid Body Run', simType = 'rigid_body', config, results } = req.body as {
      workspaceId?: string;
      name?: string;
      simType?: 'rigid_body' | 'particle' | 'digital_world';
      config?: Record<string, unknown>;
      results?: Record<string, unknown>;
    };
    const db = getDb();
    const id = `sim-${crypto.randomUUID().slice(0, 8)}`;
    db.prepare(
      `INSERT INTO simulation_projects (id, workspace_id, name, sim_type, config_json, results_json)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(id, workspaceId, name, simType, JSON.stringify(config ?? {}), JSON.stringify(results ?? {}));
    res.status(201).json({ id });
  });

  // --- OMNI CONNECT (INTEGRATIONS & PLUGINS) ---
  router.get('/integrations', (req, res) => {
    const workspaceId = String(req.query.workspaceId || 'ws-primary');
    const db = getDb();
    const integrations = db
      .prepare(`SELECT * FROM integrations WHERE workspace_id = ?`)
      .all(workspaceId);
    const plugins = listLoadedPlugins();
    res.json({ integrations, plugins });
  });

  router.get('/plugins', (_req, res) => {
    res.json({ plugins: listLoadedPlugins() });
  });

  router.post('/plugins/discover', (req, res) => {
    const user = getActiveUserFromRequest(req);
    const result = discoverAndSyncPlugins();
    logAuditEvent({
      userId: user.id,
      action: 'plugins_discover',
      resourceType: 'plugin_registry',
      status: 'allowed',
      details: { discoveredCount: result.discoveredCount },
    });
    res.json(result);
  });

  router.post('/plugins/register', (req, res) => {
    try {
      const user = getActiveUserFromRequest(req);
      const { workspaceId = 'ws-primary', manifest } = req.body as {
        workspaceId?: string;
        manifest?: unknown;
      };
      const installed = registerCustomPluginManifest(manifest, user, workspaceId);
      res.status(201).json(installed);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Registration failed';
      res.status(msg.startsWith('Forbidden') ? 403 : 400).json({ error: msg });
    }
  });

  router.patch('/plugins/:id/security', (req, res) => {
    try {
      const user = getActiveUserFromRequest(req);
      const { workspaceId = 'ws-primary', enabled, grantedPermissions } = req.body as {
        workspaceId?: string;
        enabled?: boolean;
        grantedPermissions?: PluginPermissionScope[];
      };
      const updated = updatePluginSecurity({
        pluginId: req.params.id,
        user,
        workspaceId,
        enabled,
        grantedPermissions,
      });
      res.json({ plugin: updated });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Security update failed';
      const status = msg.startsWith('Forbidden') ? 403 : msg.includes('not found') ? 404 : 400;
      res.status(status).json({ error: msg });
    }
  });

  router.post('/plugins/:id/execute', async (req, res) => {
    try {
      const user = getActiveUserFromRequest(req);
      const { workspaceId = 'ws-primary', projectId = null, actionId, input = {}, approvalId } = req.body as {
        workspaceId?: string;
        projectId?: string | null;
        actionId?: string;
        input?: Record<string, unknown>;
        approvalId?: string;
      };
      if (!actionId) {
        res.status(400).json({ error: 'actionId is required.' });
        return;
      }
      const outcome = await executePluginAction({
        pluginId: req.params.id,
        actionId,
        input,
        workspaceId,
        projectId,
        user,
        approvalId,
      });
      if (outcome.status === 'awaiting_approval') {
        res.status(202).json(outcome);
        return;
      }
      res.json(outcome);
    } catch (err) {
      const e = err as Error & { statusCode?: number };
      res.status(e.statusCode || 400).json({ error: e.message || 'Plugin execution failed' });
    }
  });

  router.post('/integrations', (req, res) => {
    const { workspaceId = 'ws-primary', name, connectorType = 'rest_api', endpointUrl, authType = 'none' } = req.body as {
      workspaceId?: string;
      name?: string;
      connectorType?: 'rest_api' | 'websocket' | 'oauth2' | 'webhook' | 'file_connector';
      endpointUrl?: string;
      authType?: string;
    };
    if (!name?.trim() || !endpointUrl?.trim()) {
      res.status(400).json({ error: 'Connector name and endpoint URL are required.' });
      return;
    }
    const db = getDb();
    const id = `int-${crypto.randomUUID().slice(0, 8)}`;
    db.prepare(
      `INSERT INTO integrations (id, workspace_id, name, connector_type, endpoint_url, auth_type, status)
       VALUES (?, ?, ?, ?, ?, ?, 'not_configured')`
    ).run(id, workspaceId, name.trim(), connectorType, endpointUrl.trim(), authType);
    res.status(201).json({ id });
  });

  router.post('/integrations/:id/test', async (req, res) => {
    const db = getDb();
    const conn = db.prepare(`SELECT * FROM integrations WHERE id = ?`).get(req.params.id) as
      | { id: string; endpoint_url: string; connector_type: string }
      | undefined;
    if (!conn) {
      res.status(404).json({ error: 'Connector not found' });
      return;
    }
    const t0 = performance.now();
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3500);
      const resp = await fetch(conn.endpoint_url, { method: 'GET', signal: controller.signal });
      clearTimeout(timeout);
      const latencyMs = Math.round(performance.now() - t0);
      const status = resp.ok ? 'connected' : 'error';
      db.prepare(`UPDATE integrations SET status = ?, last_checked_at = datetime('now') WHERE id = ?`).run(status, conn.id);
      res.json({ status, httpStatus: resp.status, latencyMs });
    } catch (err) {
      const latencyMs = Math.round(performance.now() - t0);
      db.prepare(`UPDATE integrations SET status = 'error', last_checked_at = datetime('now') WHERE id = ?`).run(conn.id);
      res.json({ status: 'error', error: err instanceof Error ? err.message : 'Unreachable', latencyMs });
    }
  });

  // --- OMNI SECURITY & BACKUP ---
  router.get('/security', (req, res) => {
    const workspaceId = String(req.query.workspaceId || 'ws-primary');
    const db = getDb();
    const approvals = db
      .prepare(`SELECT * FROM pending_approvals WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 30`)
      .all(workspaceId);
    const auditLogs = db
      .prepare(`SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 50`)
      .all();
    const permissions = db.prepare(`SELECT * FROM permissions`).all();
    res.json({ approvals, auditLogs, permissions });
  });

  router.post('/security/approvals/:id/decide', async (req, res) => {
    const user = getActiveUserFromRequest(req);
    const { decision } = req.body as { decision?: 'approved' | 'rejected' };
    if (decision !== 'approved' && decision !== 'rejected') {
      res.status(400).json({ error: 'Decision must be approved or rejected.' });
      return;
    }
    const db = getDb();
    const row = db.prepare(`SELECT * FROM pending_approvals WHERE id = ?`).get(req.params.id) as
      | { id: string; workspace_id: string; action_type: string; target_resource: string; payload_json: string; status: string }
      | undefined;
    if (!row) {
      res.status(404).json({ error: 'Approval ticket not found' });
      return;
    }

    db.prepare(
      `UPDATE pending_approvals SET status = ?, decided_by = ?, decided_at = datetime('now') WHERE id = ?`
    ).run(decision, user.id, row.id);

    // Execute approved action if applicable
    if (decision === 'approved') {
      const payload = JSON.parse(row.payload_json || '{}') as {
        projectId?: string;
        memoryId?: string;
        taskId?: string;
        pluginId?: string;
        actionId?: string;
        input?: Record<string, unknown>;
      };
      if (row.action_type === 'delete_project' && payload.projectId) {
        db.prepare(`DELETE FROM projects WHERE id = ?`).run(payload.projectId);
      } else if (row.action_type === 'delete_memory' && payload.memoryId) {
        db.prepare(`DELETE FROM memory_entries WHERE id = ?`).run(payload.memoryId);
      } else if (payload.pluginId && payload.actionId) {
        await executePluginAction({
          pluginId: payload.pluginId,
          actionId: payload.actionId,
          input: payload.input || {},
          workspaceId: row.workspace_id,
          user,
          approvalId: row.id,
        }).catch(() => {});
      } else if (payload.taskId) {
        db.prepare(`UPDATE agent_tasks SET status = 'completed', updated_at = datetime('now') WHERE id = ?`).run(payload.taskId);
      }
    }

    logAuditEvent({
      workspaceId: row.workspace_id,
      userId: user.id,
      action: `approval_${decision}`,
      resourceType: row.action_type,
      resourceId: row.target_resource,
      status: decision,
    });

    res.json({ id: row.id, status: decision });
  });

  router.post('/security/backup', async (req, res) => {
    try {
      const user = getActiveUserFromRequest(req);
      const info = await createDatabaseBackup();
      logAuditEvent({
        userId: user.id,
        action: 'database_backup',
        resourceType: 'sqlite_db',
        resourceId: info.fileName,
        status: 'allowed',
        details: { bytes: info.bytes },
      });
      res.json(info);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Backup failed' });
    }
  });

  // --- SETTINGS & MODEL GATEWAY ---
  router.get('/settings', (_req, res) => {
    const db = getDb();
    const rows = db.prepare(`SELECT key, value_json FROM system_settings`).all() as Array<{
      key: string;
      value_json: string;
    }>;
    const settings: Record<string, unknown> = {};
    for (const r of rows) settings[r.key] = JSON.parse(r.value_json);
    const models = db.prepare(`SELECT * FROM ai_models`).all();
    res.json({ settings, models, geminiConfigured: isGeminiConfigured() });
  });

  router.put('/settings', (req, res) => {
    const updates = req.body as Record<string, unknown>;
    const db = getDb();
    const stmt = db.prepare(
      `INSERT INTO system_settings (key, value_json, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = datetime('now')`
    );
    for (const [k, v] of Object.entries(updates)) {
      stmt.run(k, JSON.stringify(v));
    }
    res.json({ updated: true });
  });

  // --- SYSTEM HEALTH, LIVE TEST SUITE & STATUS DOC ---
  router.get('/health', (_req, res) => {
    res.json(runLiveSystemHealthChecks());
  });

  router.post('/tests/run', async (_req, res) => {
    try {
      const { stdout, stderr } = await execFileAsync(
        'npx',
        ['--yes', 'tsx', '--test', 'tests/dataEngine.test.ts', 'tests/mathSandbox.test.ts', 'tests/physicsEngine.test.ts', 'tests/procedural3d.test.ts', 'tests/onboardingGuide.test.ts'],
        { cwd: process.cwd(), timeout: 15000 }
      );
      res.json({ passed: true, output: stdout, stderr });
    } catch (err: unknown) {
      const e = err as { stdout?: string; stderr?: string; message?: string };
      res.json({ passed: false, output: e.stdout || '', stderr: e.stderr || e.message || 'Test run failed' });
    }
  });

  router.get('/status-doc', (_req, res) => {
    const docPath = path.resolve(process.cwd(), 'OMNIX_IMPLEMENTATION_STATUS.md');
    if (fs.existsSync(docPath)) {
      res.json({ content: fs.readFileSync(docPath, 'utf8') });
    } else {
      res.json({ content: 'OMNIX_IMPLEMENTATION_STATUS.md not yet generated.' });
    }
  });

  router.use('/', createExpansionRouter());

  return router;
}
