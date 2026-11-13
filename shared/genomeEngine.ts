import type { ProjectAnalysisReport } from './codexEngine';

export type GenomeNodeKind = 'file' | 'module' | 'db_table' | 'api_route' | 'task' | 'version';

export interface GenomeNode {
  id: string;
  kind: GenomeNodeKind;
  label: string;
  group: string;
  loc?: number;
  complexity?: number;
  inDegree: number;
  outDegree: number;
  x: number;
  y: number;
}

export interface GenomeEdge {
  id: string;
  source: string;
  target: string;
  relation: 'imports' | 'exposes' | 'queries' | 'tracks' | 'depends_on';
}

export interface GenomeHealthMetrics {
  overall: number;
  architecture: number;
  codeQuality: number;
  dependencyHealth: number;
  security: number;
  performance: number;
  testCoverage: number;
  technicalDebtHours: number;
}

export interface GenomeRiskPrediction {
  id: string;
  nodeId: string;
  label: string;
  riskLevel: 'high' | 'medium' | 'low';
  reason: string;
  mitigation: string;
}

export interface ProjectDigitalDNA {
  generatedAt: string;
  nodes: GenomeNode[];
  edges: GenomeEdge[];
  health: GenomeHealthMetrics;
  risks: GenomeRiskPrediction[];
  summary: {
    files: number;
    dbTables: number;
    apiRoutes: number;
    tasks: number;
    versions: number;
  };
}

export interface ChangeImpactResult {
  targetNodeId: string;
  targetLabel: string;
  directAffected: GenomeNode[];
  transitiveAffected: GenomeNode[];
  affectedApiRoutes: string[];
  affectedDbTables: string[];
  affectedUiComponents: string[];
  recommendedTests: string[];
  estimatedBlastRadiusPct: number;
}

export function buildProjectDigitalDNA(params: {
  analysis: ProjectAnalysisReport;
  dbTables: string[];
  apiRoutes: Array<{ method: string; path: string }>;
  tasks: Array<{ id: string; title: string; status: string }>;
  versions: Array<{ id: string; label: string; created_at: string }>;
  fileContents?: Record<string, string>;
}): ProjectDigitalDNA {
  const nodesMap = new Map<string, GenomeNode>();
  const edges: GenomeEdge[] = [];
  const edgeKeys = new Set<string>();

  const addEdge = (source: string, target: string, relation: GenomeEdge['relation']) => {
    const key = `${source}->${target}:${relation}`;
    if (edgeKeys.has(key) || source === target) return;
    edgeKeys.add(key);
    edges.push({ id: `ge-${edges.length + 1}`, source, target, relation });
  };

  // 1. Code Files
  for (const fm of params.analysis.fileMetrics.slice(0, 48)) {
    const group = fm.path.startsWith('server/')
      ? 'backend'
      : fm.path.startsWith('shared/')
        ? 'shared'
        : fm.path.startsWith('src/components/views')
          ? 'ui_views'
          : fm.path.startsWith('src/')
            ? 'frontend'
            : fm.path.startsWith('tests/')
              ? 'tests'
              : 'root';
    nodesMap.set(`file:${fm.path}`, {
      id: `file:${fm.path}`,
      kind: 'file',
      label: fm.path,
      group,
      loc: fm.loc,
      complexity: fm.cyclomaticComplexity,
      inDegree: 0,
      outDegree: 0,
      x: 0,
      y: 0,
    });
  }

  for (const dep of params.analysis.dependencyEdges) {
    const src = `file:${dep.from}`;
    const tgt = `file:${dep.to}`;
    if (nodesMap.has(src) && nodesMap.has(tgt)) {
      addEdge(src, tgt, 'imports');
    }
  }

  // 2. DB Tables
  for (const table of params.dbTables.slice(0, 28)) {
    const id = `db:${table}`;
    nodesMap.set(id, {
      id,
      kind: 'db_table',
      label: table,
      group: 'database',
      inDegree: 0,
      outDegree: 0,
      x: 0,
      y: 0,
    });
  }

  // 3. API Routes
  for (const r of params.apiRoutes.slice(0, 28)) {
    const label = `${r.method} ${r.path}`;
    const id = `api:${label}`;
    nodesMap.set(id, {
      id,
      kind: 'api_route',
      label,
      group: 'api',
      inDegree: 0,
      outDegree: 0,
      x: 0,
      y: 0,
    });
  }

  // 4. Tasks & Versions
  for (const t of params.tasks.slice(0, 12)) {
    nodesMap.set(`task:${t.id}`, {
      id: `task:${t.id}`,
      kind: 'task',
      label: t.title.slice(0, 42),
      group: 'tasks',
      inDegree: 0,
      outDegree: 0,
      x: 0,
      y: 0,
    });
  }
  for (const v of params.versions.slice(0, 8)) {
    nodesMap.set(`ver:${v.id}`, {
      id: `ver:${v.id}`,
      kind: 'version',
      label: v.label,
      group: 'versions',
      inDegree: 0,
      outDegree: 0,
      x: 0,
      y: 0,
    });
  }

  // Infer file -> DB table and API -> file links from source content if supplied
  if (params.fileContents) {
    for (const [filePath, content] of Object.entries(params.fileContents)) {
      const fNodeId = `file:${filePath}`;
      if (!nodesMap.has(fNodeId)) continue;
      for (const table of params.dbTables) {
        const tableRe = new RegExp(`\\b(?:FROM|INTO|UPDATE|TABLE(?:\\s+IF\\s+NOT\\s+EXISTS)?)\\s+${table}\\b`, 'i');
        if (tableRe.test(content)) {
          addEdge(fNodeId, `db:${table}`, 'queries');
        }
      }
      for (const r of params.apiRoutes) {
        const cleanPath = r.path.replace(/:[^/]+/g, '');
        if (cleanPath.length > 3 && content.includes(cleanPath)) {
          const apiId = `api:${r.method} ${r.path}`;
          if (filePath.startsWith('server/')) addEdge(fNodeId, apiId, 'exposes');
          else addEdge(fNodeId, apiId, 'depends_on');
        }
      }
    }
  }

  // Degree counts & layered deterministic coordinates
  for (const e of edges) {
    const s = nodesMap.get(e.source);
    const t = nodesMap.get(e.target);
    if (s) s.outDegree++;
    if (t) t.inDegree++;
  }

  const columns: Record<GenomeNodeKind, GenomeNode[]> = {
    file: [],
    api_route: [],
    db_table: [],
    module: [],
    task: [],
    version: [],
  };
  for (const n of nodesMap.values()) columns[n.kind].push(n);

  const kindX: Record<GenomeNodeKind, number> = {
    file: 240,
    api_route: 540,
    db_table: 820,
    module: 400,
    task: 60,
    version: 1020,
  };

  for (const [kind, list] of Object.entries(columns) as Array<[GenomeNodeKind, GenomeNode[]]>) {
    const stepY = Math.max(44, Math.min(72, 620 / Math.max(1, list.length)));
    list.forEach((n, idx) => {
      const subOffset = kind === 'file' && n.group === 'frontend' ? -130 : kind === 'file' && n.group === 'backend' ? 110 : 0;
      n.x = kindX[kind] + subOffset;
      n.y = 60 + idx * stepY;
    });
  }

  const nodes = Array.from(nodesMap.values());
  const testFiles = params.analysis.fileMetrics.filter((f) => f.path.includes('test')).length;
  const codeFiles = Math.max(1, params.analysis.fileMetrics.filter((f) => !f.path.includes('test')).length);
  const testCoverage = Math.min(100, Math.round((testFiles / Math.max(1, codeFiles * 0.35)) * 100));
  const depIssues = params.analysis.layerSummary.Dependency || 0;
  const dependencyHealth = Math.max(25, Math.min(100, 100 - depIssues * 8));
  const perfIssues = params.analysis.layerSummary.Performance || 0;
  const performance = Math.max(25, Math.min(100, 100 - perfIssues * 7));

  const health: GenomeHealthMetrics = {
    architecture: params.analysis.architectureScore,
    codeQuality: params.analysis.qualityScore,
    dependencyHealth,
    security: params.analysis.securityScore,
    performance,
    testCoverage,
    technicalDebtHours: Number(
      (
        params.analysis.severitySummary.critical * 4 +
        params.analysis.severitySummary.high * 2 +
        params.analysis.severitySummary.medium * 0.75 +
        params.analysis.severitySummary.low * 0.25
      ).toFixed(1)
    ),
    overall: Math.round(
      (params.analysis.architectureScore +
        params.analysis.qualityScore +
        dependencyHealth +
        params.analysis.securityScore +
        performance +
        testCoverage) /
        6
    ),
  };

  // Predictive Risk Analysis
  const risks: GenomeRiskPrediction[] = [];
  for (const n of nodes) {
    if (n.inDegree >= 4) {
      risks.push({
        id: `risk-hub-${n.id}`,
        nodeId: n.id,
        label: n.label,
        riskLevel: n.inDegree >= 7 ? 'high' : 'medium',
        reason: `High coupling hub referenced by ${n.inDegree} downstream components.`,
        mitigation: 'Freeze public interface contracts and enforce regression test coverage before editing.',
      });
    } else if ((n.complexity || 0) >= 35) {
      risks.push({
        id: `risk-cx-${n.id}`,
        nodeId: n.id,
        label: n.label,
        riskLevel: (n.complexity || 0) >= 60 ? 'high' : 'medium',
        reason: `Elevated cyclomatic complexity (${n.complexity} branches).`,
        mitigation: 'Decompose branching logic into pure unit-tested subfunctions.',
      });
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    nodes,
    edges,
    health,
    risks: risks.slice(0, 12),
    summary: {
      files: columns.file.length,
      dbTables: columns.db_table.length,
      apiRoutes: columns.api_route.length,
      tasks: columns.task.length,
      versions: columns.version.length,
    },
  };
}

export function analyzeChangeImpact(dna: ProjectDigitalDNA, targetNodeId: string): ChangeImpactResult {
  const targetNode = dna.nodes.find((n) => n.id === targetNodeId);
  if (!targetNode) {
    throw new Error(`Genome node '${targetNodeId}' not found`);
  }

  // Traverse both dependents (who points to target) and downstream (what target calls/queries)
  const reverseAdj = new Map<string, string[]>();
  const forwardAdj = new Map<string, string[]>();
  for (const e of dna.edges) {
    if (!reverseAdj.has(e.target)) reverseAdj.set(e.target, []);
    reverseAdj.get(e.target)!.push(e.source);
    if (!forwardAdj.has(e.source)) forwardAdj.set(e.source, []);
    forwardAdj.get(e.source)!.push(e.target);
  }

  const directIds = new Set<string>([
    ...(reverseAdj.get(targetNodeId) || []),
    ...(forwardAdj.get(targetNodeId) || []),
  ]);

  const visited = new Set<string>([targetNodeId, ...directIds]);
  const queue = Array.from(directIds);
  const transitiveIds = new Set<string>();

  while (queue.length > 0) {
    const curr = queue.shift()!;
    const neighbors = [...(reverseAdj.get(curr) || []), ...(forwardAdj.get(curr) || [])];
    for (const nb of neighbors) {
      if (!visited.has(nb)) {
        visited.add(nb);
        transitiveIds.add(nb);
        queue.push(nb);
      }
    }
  }

  const nodeLookup = new Map(dna.nodes.map((n) => [n.id, n]));
  const directAffected = Array.from(directIds)
    .map((id) => nodeLookup.get(id)!)
    .filter(Boolean);
  const transitiveAffected = Array.from(transitiveIds)
    .map((id) => nodeLookup.get(id)!)
    .filter(Boolean);

  const allAffected = [...directAffected, ...transitiveAffected];
  const affectedApiRoutes = allAffected.filter((n) => n.kind === 'api_route').map((n) => n.label);
  const affectedDbTables = allAffected.filter((n) => n.kind === 'db_table').map((n) => n.label);
  const affectedUiComponents = allAffected
    .filter((n) => n.kind === 'file' && n.label.startsWith('src/'))
    .map((n) => n.label);
  const recommendedTests = allAffected
    .filter((n) => n.kind === 'file' && n.label.includes('test'))
    .map((n) => n.label);

  if (recommendedTests.length === 0) {
    recommendedTests.push('tests/serverIntegration.test.ts');
  }

  const estimatedBlastRadiusPct = Math.round(
    (allAffected.length / Math.max(1, dna.nodes.length - 1)) * 100
  );

  return {
    targetNodeId,
    targetLabel: targetNode.label,
    directAffected,
    transitiveAffected,
    affectedApiRoutes,
    affectedDbTables,
    affectedUiComponents,
    recommendedTests,
    estimatedBlastRadiusPct,
  };
}
