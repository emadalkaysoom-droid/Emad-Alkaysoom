import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Isolate SQLite test DB in OS temp directory
const tmpDbPath = path.join(os.tmpdir(), `omnix-test-${Date.now()}.db`);
process.env.OMNIX_DB_PATH = tmpDbPath;

import { getDb, closeDb } from '../server/db/schema';
import { authenticateCredentials, checkPermission } from '../server/core/security';
import { compileReportArtifact, executeSandboxedJavaScript } from '../server/core/executionEngine';
import { orchestrateDirective } from '../server/core/omniBrain';
import { runLiveSystemHealthChecks } from '../server/core/health';

test.after(() => {
  closeDb();
  if (fs.existsSync(tmpDbPath)) fs.unlinkSync(tmpDbPath);
});

test('initializes unified SQLite relational schema with foreign keys and seed data', () => {
  const db = getDb();
  const tables = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`)
    .all() as Array<{ name: string }>;
  const names = new Set(tables.map((t) => t.name));

  for (const required of [
    'users',
    'organizations',
    'workspaces',
    'projects',
    'conversations',
    'messages',
    'memory_entries',
    'knowledge_nodes',
    'knowledge_relations',
    'agents',
    'agent_tasks',
    'task_executions',
    'files',
    'ai_models',
    'integrations',
    'audit_logs',
    'pending_approvals',
    'reports',
    'system_settings',
  ]) {
    assert.ok(names.has(required), `Missing required table: ${required}`);
  }

  const agents = db.prepare(`SELECT COUNT(*) as c FROM agents`).get() as { c: number };
  assert.equal(agents.c, 12);
});

test('authenticates credentials and enforces RBAC permissions', () => {
  const auth = authenticateCredentials('architect@omnix.local', 'OmnixSecure2026!');
  assert.ok(auth !== null);
  assert.equal(auth.user.role, 'admin');

  const bad = authenticateCredentials('architect@omnix.local', 'wrong-password');
  assert.equal(bad, null);

  assert.equal(checkPermission('viewer', 'projects', 'delete'), false);
  assert.equal(checkPermission('admin', 'projects', 'delete'), true);
});

test('executes isolated VM JavaScript sandbox safely', () => {
  const res = executeSandboxedJavaScript('return [10, 20, 30].reduce((a, b) => a + b, 0);');
  assert.equal(res.result, 60);
  assert.throws(() => executeSandboxedJavaScript('return typeof process === "undefined" ? (() => { throw new Error("no-process"); })() : 1;'));
});

test('orchestrates multi-step OMNI BRAIN directive and gates destructive actions', async () => {
  const res = await orchestrateDirective({
    workspaceId: 'ws-primary',
    projectId: 'proj-telemetry',
    userId: 'user-admin',
    prompt: 'Analyze sample file, calculate sqrt(81) + 4, and save findings to memory',
  });
  assert.ok(res.steps.length >= 3);
  assert.ok(res.steps.every((s) => s.status === 'completed' && s.verifiedByQa));

  const gated = await orchestrateDirective({
    workspaceId: 'ws-primary',
    userId: 'user-admin',
    prompt: 'Delete project telemetry immediately',
  });
  assert.ok(gated.steps.some((s) => s.status === 'awaiting_approval'));
});

test('compiles real downloadable PDF, DOCX, XLSX, CSV, and HTML reports', async () => {
  for (const format of ['pdf', 'docx', 'xlsx', 'csv', 'html'] as const) {
    const artifact = await compileReportArtifact({
      workspaceId: 'ws-primary',
      title: `Audit ${format.toUpperCase()}`,
      format,
      summary: 'Integration test summary',
      sections: [{ heading: 'Findings', body: 'Nominal metrics.' }],
      tableRows: [{ metric: 'rpm', value: 1500 }],
    });
    assert.ok(artifact.buffer.byteLength > 20, `Empty buffer for ${format}`);
  }
});

test('system health probes return authentic diagnostics', () => {
  const health = runLiveSystemHealthChecks();
  assert.ok(health.checks.length >= 5);
  assert.equal(health.checks.find((c) => c.id === 'database')?.status, 'ONLINE');
});
