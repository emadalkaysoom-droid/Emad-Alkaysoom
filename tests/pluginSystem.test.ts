import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmpPluginDb = path.join(os.tmpdir(), `omnix-plugin-test-${Date.now()}.db`);
process.env.OMNIX_DB_PATH = tmpPluginDb;

import { closeDb, getDb } from '../server/db/schema';
import { authorizePluginExecution, validatePluginManifest } from '../shared/pluginContract';
import {
  discoverAndSyncPlugins,
  executePluginAction,
  registerCustomPluginManifest,
  updatePluginSecurity,
} from '../server/plugins/pluginManager';
import type { AuthUser } from '../server/core/security';

const adminUser: AuthUser = {
  id: 'user-admin',
  email: 'architect@omnix.local',
  name: 'System Architect',
  role: 'admin',
  preferred_language: 'en',
};

const viewerUser: AuthUser = {
  id: 'user-viewer',
  email: 'viewer@omnix.local',
  name: 'Read Only Viewer',
  role: 'viewer',
  preferred_language: 'en',
};

test.after(() => {
  closeDb();
  if (fs.existsSync(tmpPluginDb)) fs.unlinkSync(tmpPluginDb);
});

test('validates plugin manifests and rejects unsafe SSRF domains', () => {
  const valid = validatePluginManifest({
    id: 'plugin-demo-valid',
    name: 'Demo Connector',
    version: '1.0.0',
    author: 'OMNIX',
    category: 'project_management',
    description: 'Validates schema cleanly.',
    permissions: ['projects:read'],
    allowedDomains: ['api.example.com'],
    entryType: 'manifest_webhook',
    actions: [
      {
        id: 'ping_board',
        name: 'Ping Board',
        description: 'Reads board state',
        requiredPermission: 'projects:read',
        inputSchema: {},
      },
    ],
  });
  assert.equal(valid.valid, true);

  const ssrf = validatePluginManifest({
    id: 'plugin-ssrf',
    name: 'Unsafe SSRF Plugin',
    version: 'bad-ver',
    author: 'Test',
    category: 'custom',
    description: 'Attempts localhost metadata call',
    permissions: ['network:outbound'],
    allowedDomains: ['169.254.169.254'],
    actions: [
      {
        id: 'fetch_meta',
        name: 'Fetch Meta',
        description: 'Bad',
        requiredPermission: 'network:outbound',
        inputSchema: {},
      },
    ],
  });
  assert.equal(ssrf.valid, false);
});

test('authorizePluginExecution enforces RBAC role, manifest declarations, and granted scopes', () => {
  const deniedViewer = authorizePluginExecution({
    enabled: true,
    userRole: 'viewer',
    manifestPermissions: ['projects:read', 'projects:write'],
    grantedPermissions: ['projects:read', 'projects:write'],
    requiredPermission: 'projects:write',
  });
  assert.equal(deniedViewer.allowed, false);

  const deniedRevoked = authorizePluginExecution({
    enabled: true,
    userRole: 'admin',
    manifestPermissions: ['projects:read', 'projects:write'],
    grantedPermissions: ['projects:read'],
    requiredPermission: 'projects:write',
  });
  assert.equal(deniedRevoked.allowed, false);

  const ok = authorizePluginExecution({
    enabled: true,
    userRole: 'engineer',
    manifestPermissions: ['projects:read', 'projects:write'],
    grantedPermissions: ['projects:read', 'projects:write'],
    requiredPermission: 'projects:write',
  });
  assert.equal(ok.allowed, true);
});

test('discovers built-in and manifest plugins, executes TaskFlow & NebulaVault, and enforces security gates', async () => {
  getDb();
  const discovery = discoverAndSyncPlugins();
  assert.ok(discovery.discoveredCount >= 4);
  assert.ok(discovery.plugins.some((p) => p.id === 'plugin-taskflow-pm'));
  assert.ok(discovery.plugins.some((p) => p.id === 'plugin-nebula-vault'));
  assert.ok(discovery.plugins.some((p) => p.id === 'plugin-telemetry-notifier'));

  // Create & list TaskFlow issue
  const created = await executePluginAction({
    pluginId: 'plugin-taskflow-pm',
    actionId: 'create_issue',
    input: { title: 'Verify bearing lubrication curve', priority: 'high' },
    workspaceId: 'ws-primary',
    user: adminUser,
  });
  assert.equal(created.status, 'completed');
  assert.ok(created.result?.summary.includes('Verify bearing lubrication curve'));

  // Mirror sample file into NebulaVault
  const mirrored = await executePluginAction({
    pluginId: 'plugin-nebula-vault',
    actionId: 'put_object',
    input: { fileId: 'file-sample-telemetry' },
    workspaceId: 'ws-primary',
    user: adminUser,
  });
  assert.equal(mirrored.status, 'completed');
  assert.ok(mirrored.result?.summary.includes('turbine_telemetry_sample.csv'));

  // Approval gate on destructive TaskFlow action
  const gated = await executePluginAction({
    pluginId: 'plugin-taskflow-pm',
    actionId: 'purge_board_archive',
    input: {},
    workspaceId: 'ws-primary',
    user: adminUser,
  });
  assert.equal(gated.status, 'awaiting_approval');
  assert.ok(gated.approvalId);

  // Viewer cannot execute write action
  await assert.rejects(() =>
    executePluginAction({
      pluginId: 'plugin-taskflow-pm',
      actionId: 'create_issue',
      input: { title: 'Blocked viewer mutation' },
      workspaceId: 'ws-primary',
      user: viewerUser,
    })
  );

  // Admin revoking projects:write immediately blocks create_issue even for admin
  updatePluginSecurity({
    pluginId: 'plugin-taskflow-pm',
    user: adminUser,
    workspaceId: 'ws-primary',
    grantedPermissions: ['projects:read'],
  });
  await assert.rejects(() =>
    executePluginAction({
      pluginId: 'plugin-taskflow-pm',
      actionId: 'create_issue',
      input: { title: 'Blocked by revoked grant' },
      workspaceId: 'ws-primary',
      user: adminUser,
    })
  );

  // Custom manifest registration uses least-privilege defaults (read-only granted initially)
  const custom = registerCustomPluginManifest(
    {
      id: 'plugin-custom-ci',
      name: 'Custom CI Notifier',
      version: '1.0.0',
      author: 'QA',
      category: 'custom',
      description: 'Test custom registration',
      permissions: ['workspace:read', 'projects:write'],
      allowedDomains: ['ci.example.com'],
      entryType: 'manifest_webhook',
      actions: [
        {
          id: 'check_status',
          name: 'Check Status',
          description: 'Read status',
          requiredPermission: 'workspace:read',
          inputSchema: {},
        },
      ],
    },
    adminUser
  );
  assert.deepEqual(custom.plugin.grantedPermissions, ['workspace:read']);
});
