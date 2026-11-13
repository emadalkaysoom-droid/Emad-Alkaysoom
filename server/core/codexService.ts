import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  analyzeProjectFiles,
  applyPatchToSource,
  generateCodeArtifact,
  type CodexFinding,
  type FileInput,
  type ProjectAnalysisReport,
  type SupportedCodexLanguage,
} from '../../shared/codexEngine.ts';
import { executeSandboxedJavaScript } from './executionEngine.ts';
import { invokeModelGateway } from './modelGateway.ts';
import { getDb } from '../db/schema.ts';

const execFileAsync = promisify(execFile);

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'data', '.next', 'coverage']);
const SCAN_EXTS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.java', '.c', '.h',
  '.cpp', '.hpp', '.cs', '.go', '.rs', '.php', '.html', '.css', '.sql', '.swift', '.kt', '.json',
]);

export function resolveSafeWorkspacePath(relPath: string): string {
  const root = process.cwd();
  const normalized = path.normalize(relPath).replace(/^(\.\.(\/|\\|$))+/, '');
  const full = path.resolve(root, normalized);
  if (!full.startsWith(root + path.sep) && full !== root) {
    throw new Error('Access denied: path escapes workspace root.');
  }
  return full;
}

export function scanWorkspaceSourceFiles(maxFiles = 90): FileInput[] {
  const root = process.cwd();
  const results: FileInput[] = [];

  function walk(dir: string) {
    if (results.length >= maxFiles) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const ent of entries) {
      if (results.length >= maxFiles) break;
      if (SKIP_DIRS.has(ent.name) || ent.name.startsWith('.')) continue;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        walk(full);
      } else {
        const ext = path.extname(ent.name).toLowerCase();
        if (!SCAN_EXTS.has(ext)) continue;
        const stat = fs.statSync(full);
        if (stat.size > 200_000) continue;
        const rel = path.relative(root, full).replace(/\\/g, '/');
        results.push({ path: rel, content: fs.readFileSync(full, 'utf8') });
      }
    }
  }

  walk(root);
  return results;
}

export function runCodexProjectScan(params: {
  workspaceId: string;
  userId: string;
  customFiles?: FileInput[];
  targetName?: string;
}): { analysisId: string; report: ProjectAnalysisReport; files: Array<{ path: string; language: string; loc: number }> } {
  const db = getDb();
  const files = params.customFiles && params.customFiles.length > 0 ? params.customFiles : scanWorkspaceSourceFiles();
  const report = analyzeProjectFiles(files);
  const analysisId = `cdx-${crypto.randomUUID().slice(0, 8)}`;

  db.prepare(
    `INSERT INTO codex_analyses (id, workspace_id, user_id, target_name, summary_json, findings_json)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    analysisId,
    params.workspaceId,
    params.userId,
    params.targetName || (params.customFiles ? 'Uploaded Project Bundle' : 'OMNIX Unified Workspace'),
    JSON.stringify({
      fileCount: report.fileCount,
      totalLoc: report.totalLoc,
      languages: report.languages,
      entryPoints: report.entryPoints,
      unusedFiles: report.unusedFiles,
      layerSummary: report.layerSummary,
      severitySummary: report.severitySummary,
      qualityScore: report.qualityScore,
      securityScore: report.securityScore,
      architectureScore: report.architectureScore,
    }),
    JSON.stringify(report.findings)
  );

  return {
    analysisId,
    report,
    files: report.fileMetrics.map((m) => ({ path: m.path, language: m.language, loc: m.loc })),
  };
}

export function previewOrApplyCodexPatch(params: {
  workspaceId: string;
  userId: string;
  finding: CodexFinding;
  applyToCustomSource?: string;
  persistToDisk?: boolean;
}): {
  patchId: string;
  unifiedDiff: string;
  patchedContent: string;
  status: 'previewed' | 'applied';
  note: string;
} {
  const db = getDb();
  let originalContent = params.applyToCustomSource ?? '';
  let resolvedPath: string | null = null;
  if (!originalContent) {
    resolvedPath = resolveSafeWorkspacePath(params.finding.file);
    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`Source file '${params.finding.file}' not found in workspace.`);
    }
    originalContent = fs.readFileSync(resolvedPath, 'utf8');
  }

  const { patched, unifiedDiff } = applyPatchToSource(originalContent, params.finding);
  const patchId = `pat-${crypto.randomUUID().slice(0, 8)}`;
  let status: 'previewed' | 'applied' = 'previewed';
  let note = 'Patch preview generated with rollback snapshot stored in SQLite.';

  if (params.persistToDisk && resolvedPath) {
    fs.writeFileSync(resolvedPath, patched, 'utf8');
    status = 'applied';
    note = `Applied patch cleanly to ${params.finding.file}; original content retained for one-click rollback.`;
  }

  db.prepare(
    `INSERT INTO codex_patches (id, workspace_id, user_id, file_path, finding_id, unified_diff, original_content, patched_content, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    patchId,
    params.workspaceId,
    params.userId,
    params.finding.file,
    params.finding.id,
    unifiedDiff,
    originalContent,
    patched,
    status
  );

  return { patchId, unifiedDiff, patchedContent: patched, status, note };
}

export function rollbackCodexPatch(patchId: string, userId: string): { restored: boolean; filePath: string } {
  const db = getDb();
  const row = db
    .prepare(`SELECT * FROM codex_patches WHERE id = ? AND user_id = ?`)
    .get(patchId, userId) as
    | { id: string; file_path: string; original_content: string; status: string }
    | undefined;
  if (!row) throw new Error('Patch snapshot not found.');

  if (row.status === 'applied') {
    const safePath = resolveSafeWorkspacePath(row.file_path);
    if (fs.existsSync(safePath)) {
      fs.writeFileSync(safePath, row.original_content, 'utf8');
    }
  }
  db.prepare(`UPDATE codex_patches SET status = 'rolled_back' WHERE id = ?`).run(patchId);
  return { restored: true, filePath: row.file_path };
}

export function runCodexSandbox(params: {
  workspaceId: string;
  userId: string;
  language: string;
  code: string;
}): {
  runId: string;
  status: 'completed' | 'sandbox_limited' | 'error';
  stdout: string;
  stderr: string;
  result?: unknown;
  durationMs: number;
  sandboxNotice: string;
} {
  const db = getDb();
  const runId = `sbx-${crypto.randomUUID().slice(0, 8)}`;
  const t0 = performance.now();

  if (params.language === 'JavaScript' || params.language === 'TypeScript') {
    try {
      // Strip light TS type annotations when running JS expressions in isolated node:vm
      const jsCode = params.code.replace(/:\s*(string|number|boolean|unknown|any)\b/g, '');
      const exec = executeSandboxedJavaScript(jsCode);
      const stdout = exec.logs.join('\n') || (exec.result !== undefined ? JSON.stringify(exec.result, null, 2) : '(no output)');
      db.prepare(
        `INSERT INTO codex_sandbox_runs (id, workspace_id, user_id, language, code, status, stdout, duration_ms)
         VALUES (?, ?, ?, ?, ?, 'completed', ?, ?)`
      ).run(runId, params.workspaceId, params.userId, params.language, params.code, stdout, exec.durationMs);

      return {
        runId,
        status: 'completed',
        stdout,
        stderr: '',
        result: exec.result,
        durationMs: exec.durationMs,
        sandboxNotice: 'Executed inside isolated node:vm sandbox (500ms CPU timeout, no filesystem/network/process access).',
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Execution error';
      const durationMs = Math.round(performance.now() - t0);
      db.prepare(
        `INSERT INTO codex_sandbox_runs (id, workspace_id, user_id, language, code, status, stderr, duration_ms)
         VALUES (?, ?, ?, ?, ?, 'error', ?, ?)`
      ).run(runId, params.workspaceId, params.userId, params.language, params.code, msg, durationMs);
      return {
        runId,
        status: 'error',
        stdout: '',
        stderr: msg,
        durationMs,
        sandboxNotice: 'Isolated node:vm terminated execution cleanly.',
      };
    }
  }

  // Non-JS languages: verify static syntax & explicitly report container runtime availability
  const report = analyzeProjectFiles([{ path: `snippet.${params.language.toLowerCase()}`, content: params.code }]);
  const durationMs = Math.round(performance.now() - t0);
  const syntaxErrors = report.findings.filter((f) => f.layer === 'Syntax');
  const status = syntaxErrors.length > 0 ? 'error' : 'sandbox_limited';
  const stderr = syntaxErrors.map((e) => `Line ${e.line}: ${e.title}`).join('\n');
  const stdout =
    syntaxErrors.length === 0
      ? `Static & security pre-flight passed (${report.totalLoc} lines, ${report.findings.length} static notices).`
      : '';

  db.prepare(
    `INSERT INTO codex_sandbox_runs (id, workspace_id, user_id, language, code, status, stdout, stderr, duration_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(runId, params.workspaceId, params.userId, params.language, params.code, status, stdout, stderr, durationMs);

  return {
    runId,
    status,
    stdout,
    stderr,
    durationMs,
    sandboxNotice: `Docker/native compiler container for ${params.language} is not attached in this runtime; executed deterministic pre-flight syntax & security audit instead.`,
  };
}

export async function generateCodexCode(params: {
  workspaceId: string;
  prompt: string;
  language: SupportedCodexLanguage;
  artifactType: 'api' | 'model' | 'class' | 'test' | 'config' | 'docs';
}): Promise<{ fileName: string; code: string; notes: string; provider: string }> {
  const baseline = generateCodeArtifact(params);
  const gw = await invokeModelGateway({
    workspaceId: params.workspaceId,
    prompt: `Generate clean production ${params.language} code (${params.artifactType}) for: ${params.prompt}. Return ONLY valid code without markdown fences.`,
    systemInstruction: 'You are OMNI CODEX. Output clean, secure, parameterized production code only.',
    localFallbackHandler: () => baseline.code,
  });

  const cleanCode = gw.text.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '').trim() || baseline.code;
  return {
    fileName: baseline.fileName,
    code: cleanCode,
    notes: baseline.notes,
    provider: gw.provider,
  };
}

export async function getGitWorkspaceSummary(): Promise<{
  available: boolean;
  branch: string;
  statusLines: string[];
  commits: Array<{ hash: string; author: string; date: string; message: string }>;
  diffPreview: string;
  notice?: string;
}> {
  try {
    const cwd = process.cwd();
    const { stdout: branchOut } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd, timeout: 4000 });
    const { stdout: statusOut } = await execFileAsync('git', ['status', '--short'], { cwd, timeout: 4000 });
    const { stdout: logOut } = await execFileAsync(
      'git',
      ['log', '-n', '10', '--pretty=format:%h|%an|%ad|%s', '--date=short'],
      { cwd, timeout: 4000 }
    );
    const { stdout: diffOut } = await execFileAsync('git', ['diff', '--stat'], { cwd, timeout: 4000 });

    const commits = logOut
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const [hash, author, date, ...msgParts] = line.split('|');
        return { hash, author, date, message: msgParts.join('|') };
      });

    return {
      available: true,
      branch: branchOut.trim() || 'HEAD',
      statusLines: statusOut.split(/\r?\n/).filter(Boolean).slice(0, 30),
      commits,
      diffPreview: diffOut.trim() || 'Working tree clean relative to HEAD.',
    };
  } catch (err) {
    return {
      available: false,
      branch: 'unavailable',
      statusLines: [],
      commits: [],
      diffPreview: '',
      notice: err instanceof Error ? err.message : 'Git repository metadata not initialized in workspace.',
    };
  }
}
