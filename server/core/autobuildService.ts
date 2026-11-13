import crypto from 'node:crypto';
import {
  applyLiveEditToBlueprint,
  buildApplicationBlueprint,
  buildZipArchive,
  type AutoBuildBlueprint,
} from '../../shared/autobuildEngine.ts';
import { getDb } from '../db/schema.ts';
import { logAuditEvent } from './security.ts';

export function createAutoBuildProject(params: {
  workspaceId: string;
  userId: string;
  prompt: string;
}): { projectId: string; revision: number; blueprint: AutoBuildBlueprint } {
  const db = getDb();
  const blueprint = buildApplicationBlueprint(params.prompt);
  const projectId = `ab-${crypto.randomUUID().slice(0, 8)}`;

  db.prepare(
    `INSERT INTO autobuild_projects (id, workspace_id, user_id, name, prompt, category, blueprint_json, revision, qc_passed)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`
  ).run(
    projectId,
    params.workspaceId,
    params.userId,
    blueprint.appName,
    params.prompt,
    blueprint.category,
    JSON.stringify(blueprint),
    blueprint.qcReport.passed ? 1 : 0
  );

  // Record Multi-Agent Team execution trace in agent_tasks so OMNI AGENTS & OMNI BRAIN stay unified
  const taskId = `task-${crypto.randomUUID().slice(0, 8)}`;
  db.prepare(
    `INSERT INTO agent_tasks (id, workspace_id, agent_id, title, description, status) VALUES (?, ?, 'agent-engineering', ?, ?, 'completed')`
  ).run(taskId, params.workspaceId, `AutoBuild: ${blueprint.appName}`, params.prompt);

  logAuditEvent({
    workspaceId: params.workspaceId,
    userId: params.userId,
    action: 'autobuild_create',
    resourceType: 'autobuild_project',
    resourceId: projectId,
    status: 'allowed',
    details: { category: blueprint.category, qcPassed: blueprint.qcReport.passed },
  });

  return { projectId, revision: 1, blueprint };
}

export function applyAutoBuildLiveEdit(params: {
  projectId: string;
  userId: string;
  instruction: string;
}): { projectId: string; revision: number; appliedChanges: string[]; blueprint: AutoBuildBlueprint } {
  const db = getDb();
  const row = db
    .prepare(`SELECT * FROM autobuild_projects WHERE id = ? AND user_id = ?`)
    .get(params.projectId, params.userId) as
    | { id: string; blueprint_json: string; revision: number }
    | undefined;
  if (!row) throw new Error('AutoBuild project not found or access denied.');

  const current = JSON.parse(row.blueprint_json) as AutoBuildBlueprint;
  const { blueprint, appliedChanges } = applyLiveEditToBlueprint(current, params.instruction);
  const nextRevision = (row.revision || 1) + 1;

  db.prepare(
    `UPDATE autobuild_projects SET name = ?, blueprint_json = ?, revision = ?, qc_passed = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(blueprint.appName, JSON.stringify(blueprint), nextRevision, blueprint.qcReport.passed ? 1 : 0, row.id);

  return {
    projectId: row.id,
    revision: nextRevision,
    appliedChanges,
    blueprint,
  };
}

export function exportAutoBuildZip(projectId: string, userId: string): { fileName: string; buffer: Buffer } {
  const db = getDb();
  const row = db
    .prepare(`SELECT name, blueprint_json FROM autobuild_projects WHERE id = ? AND user_id = ?`)
    .get(projectId, userId) as { name: string; blueprint_json: string } | undefined;
  if (!row) throw new Error('AutoBuild project not found or access denied.');

  const bp = JSON.parse(row.blueprint_json) as AutoBuildBlueprint;
  const buffer = buildZipArchive(bp.files);
  const safeSlug = row.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'omnix-app';
  return { fileName: `${safeSlug}-project.zip`, buffer };
}
