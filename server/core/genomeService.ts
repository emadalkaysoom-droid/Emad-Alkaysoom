import crypto from 'node:crypto';
import { analyzeProjectFiles } from '../../shared/codexEngine.ts';
import {
  analyzeChangeImpact,
  buildProjectDigitalDNA,
  type ChangeImpactResult,
  type ProjectDigitalDNA,
} from '../../shared/genomeEngine.ts';
import { scanWorkspaceSourceFiles } from './codexService.ts';
import { getDb } from '../db/schema.ts';

function extractApiRoutesFromCode(files: Array<{ path: string; content: string }>): Array<{ method: string; path: string }> {
  const routes: Array<{ method: string; path: string }> = [];
  const seen = new Set<string>();
  for (const f of files) {
    if (!f.path.startsWith('server/')) continue;
    const re = /\brouter\.(get|post|put|patch|delete)\(\s*['"]([^'"]+)['"]/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(f.content)) !== null) {
      const method = m[1].toUpperCase();
      const routePath = `/api${m[2]}`;
      const key = `${method} ${routePath}`;
      if (!seen.has(key)) {
        seen.add(key);
        routes.push({ method, path: routePath });
      }
    }
  }
  return routes;
}

export function generateCurrentWorkspaceDNA(workspaceId: string, userId: string): ProjectDigitalDNA {
  const db = getDb();
  const files = scanWorkspaceSourceFiles(85);
  const analysis = analyzeProjectFiles(files);

  const dbTables = (
    db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name ASC`).all() as Array<{
      name: string;
    }>
  ).map((t) => t.name);

  const apiRoutes = extractApiRoutesFromCode(files);
  const tasks = db
    .prepare(`SELECT id, title, status FROM agent_tasks WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 12`)
    .all(workspaceId) as Array<{ id: string; title: string; status: string }>;
  const versions = db
    .prepare(`SELECT id, label, created_at FROM genome_snapshots WHERE workspace_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT 8`)
    .all(workspaceId, userId) as Array<{ id: string; label: string; created_at: string }>;

  const fileContents: Record<string, string> = {};
  for (const f of files) fileContents[f.path] = f.content;

  return buildProjectDigitalDNA({
    analysis,
    dbTables,
    apiRoutes,
    tasks,
    versions,
    fileContents,
  });
}

export function createGenomeSnapshot(params: {
  workspaceId: string;
  userId: string;
  label: string;
}): { snapshotId: string; dna: ProjectDigitalDNA } {
  const db = getDb();
  const dna = generateCurrentWorkspaceDNA(params.workspaceId, params.userId);
  const snapshotId = `gnm-${crypto.randomUUID().slice(0, 8)}`;
  db.prepare(
    `INSERT INTO genome_snapshots (id, workspace_id, user_id, label, dna_json, health_json) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(snapshotId, params.workspaceId, params.userId, params.label.trim() || `Snapshot ${new Date().toISOString().slice(0, 16)}`, JSON.stringify(dna), JSON.stringify(dna.health));

  return { snapshotId, dna };
}

export function computeWorkspaceImpact(workspaceId: string, userId: string, targetNodeId: string): ChangeImpactResult {
  const dna = generateCurrentWorkspaceDNA(workspaceId, userId);
  return analyzeChangeImpact(dna, targetNodeId);
}
