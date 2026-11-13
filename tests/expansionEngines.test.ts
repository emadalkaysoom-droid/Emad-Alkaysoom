import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SUPPORTED_LANGUAGES,
  detectLanguage,
  analyzeProjectFiles,
  applyPatchToSource,
  generateCodeArtifact,
} from '../shared/codexEngine.ts';
import {
  buildProjectDigitalDNA,
  analyzeChangeImpact,
} from '../shared/genomeEngine.ts';
import {
  solveLinearSystem,
  matrixDeterminant,
  multiplyMatrices,
  computeStatisticsAndRegression,
  solveOdeModel,
  runPhysicsExperiment,
  REFERENCE_MATERIALS,
  analyzeMaterialStress,
  runEngineeringAnalysis,
} from '../shared/labEngine.ts';
import {
  parseSubtitles,
  serializeSubtitles,
  applyGlossaryHints,
  verifyTranslationQuality,
  deterministicTranslateFallback,
} from '../shared/translatorEngine.ts';
import {
  buildApplicationBlueprint,
  applyLiveEditToBlueprint,
  runAutoBuildQualityChecks,
  buildZipArchive,
} from '../shared/autobuildEngine.ts';

// ---------------------------------------------------------------------------
// 1. OMNI CODEX ENGINE TESTS
// ---------------------------------------------------------------------------
test('OMNI CODEX detects all 15 supported programming languages accurately', () => {
  assert.equal(SUPPORTED_LANGUAGES.length, 15);
  assert.equal(detectLanguage('app/main.py', ''), 'Python');
  assert.equal(detectLanguage('src/index.ts', ''), 'TypeScript');
  assert.equal(detectLanguage('cmd/server.go', ''), 'Go');
  assert.equal(detectLanguage('src/lib.rs', ''), 'Rust');
  assert.equal(detectLanguage('schema.sql', ''), 'SQL');
  assert.equal(detectLanguage('App.swift', ''), 'Swift');
  assert.equal(detectLanguage('Main.kt', ''), 'Kotlin');
  assert.equal(detectLanguage('noext', 'def compute(x):\n  return x * 2'), 'Python');
});

test('OMNI CODEX performs 10-layer inspection and generates reversible unified diff patches', () => {
  const sampleFiles = [
    {
      path: 'src/index.ts',
      content: [
        "import { runQuery, unusedHelper } from './db';",
        'export function handleReq(input: any) {',
        '  console.log(input);',
        "  const val = eval('1 + 1');",
        '  return val;',
        '  const dead = 42;',
        '}',
      ].join('\n'),
    },
    {
      path: 'src/db.ts',
      content: [
        'export function runQuery(id: string) {',
        '  const sql = `SELECT * FROM users WHERE id = ${id}`;',
        '  return sql;',
        '}',
        'export function unusedHelper() { return true; }',
      ].join('\n'),
    },
    {
      path: 'src/orphan.ts',
      content: 'export const ORPHAN_VAL = 99;\n',
    },
  ];

  const report = analyzeProjectFiles(sampleFiles);
  assert.equal(report.fileCount, 3);
  assert.ok(report.entryPoints.includes('src/index.ts'));
  assert.ok(report.unusedFiles.includes('src/orphan.ts'));
  assert.ok(report.dependencyEdges.some((e) => e.from === 'src/index.ts' && e.to === 'src/db.ts'));

  const layersHit = new Set(report.findings.map((f) => f.layer));
  assert.ok(layersHit.has('Security'));
  assert.ok(layersHit.has('Semantic'));
  assert.ok(layersHit.has('Static'));
  assert.ok(layersHit.has('Quality'));
  assert.ok(layersHit.has('DeadCode'));
  assert.ok(layersHit.has('Performance'));

  const anyFinding = report.findings.find((f) => f.type === 'typescript-any-escape');
  assert.ok(anyFinding, 'Expected TypeScript explicit any finding');
  const patch = applyPatchToSource(sampleFiles[0].content, anyFinding!);
  assert.ok(patch.patched.includes('input: unknown'));
  assert.ok(patch.unifiedDiff.includes('--- a/src/index.ts'));
  assert.ok(patch.unifiedDiff.includes('+++ b/src/index.ts'));

  const generated = generateCodeArtifact({
    prompt: 'Create PostgreSQL user login auth handler',
    language: 'TypeScript',
    artifactType: 'api',
  });
  assert.equal(generated.fileName, 'authPostgresService.ts');
  assert.ok(generated.code.includes('bcrypt'));
});

// ---------------------------------------------------------------------------
// 2. OMNI GENOME DIGITAL DNA TESTS
// ---------------------------------------------------------------------------
test('OMNI GENOME builds Digital DNA graph and computes BFS blast radius impact', () => {
  const files = [
    { path: 'server/routes/api.ts', content: "import { queryUser } from '../db/repo';\napp.get('/api/users', () => queryUser());" },
    { path: 'server/db/repo.ts', content: 'export function queryUser() { return "SELECT * FROM users"; }' },
    { path: 'src/App.tsx', content: "fetch('/api/users');" },
  ];
  const analysis = analyzeProjectFiles(files);
  const dna = buildProjectDigitalDNA({
    analysis,
    dbTables: ['users'],
    apiRoutes: [{ method: 'GET', path: '/api/users' }],
    tasks: [{ id: 't1', title: 'Audit users endpoint', status: 'running' }],
    versions: [{ id: 'v1', label: 'v3.0', created_at: '2026-01-01T00:00:00Z' }],
    fileContents: Object.fromEntries(files.map((f) => [f.path, f.content])),
  });

  assert.ok(dna.nodes.some((n) => n.id === 'db:users'));
  assert.ok(dna.nodes.some((n) => n.id === 'api:GET /api/users'));
  assert.ok(dna.health.overall >= 0 && dna.health.overall <= 100);

  const impact = analyzeChangeImpact(dna, 'db:users');
  assert.ok(impact.directAffected.some((n) => n.id === 'file:server/db/repo.ts'));
  assert.ok(impact.transitiveAffected.some((n) => n.id === 'file:server/routes/api.ts'));
  assert.ok(impact.estimatedBlastRadiusPct > 0);
});

// ---------------------------------------------------------------------------
// 3. OMNI LAB SCIENTIFIC & ENGINEERING TESTS
// ---------------------------------------------------------------------------
test('OMNI LAB solves linear systems, determinants, RK4 ODEs, and statistics accurately', () => {
  // 2x + y = 5; x + 3y = 10 => x = 1, y = 3
  const sol = solveLinearSystem([[2, 1], [1, 3]], [5, 10]);
  assert.equal(sol[0], 1);
  assert.equal(sol[1], 3);

  const det = matrixDeterminant([[4, 6], [3, 8]]);
  assert.equal(det, 14);

  const prod = multiplyMatrices([[1, 2], [3, 4]], [[2, 0], [1, 2]]);
  assert.deepEqual(prod, [[4, 4], [10, 8]]);

  const reg = computeStatisticsAndRegression([1, 2, 3, 4], [3, 5, 7, 9]);
  assert.equal(reg.slope, 2);
  assert.equal(reg.intercept, 1);
  assert.equal(reg.rSquared, 1);

  const decay = solveOdeModel({ model: 'exponential_decay', y0: 100, paramA: 0.5, tEnd: 2, steps: 40 });
  const expected = 100 * Math.exp(-0.5 * 2);
  assert.ok(Math.abs(decay.summary.finalY - expected) < 0.05);
});

test('OMNI LAB physics, reference materials stress-strain, and Euler-Bernoulli beam formulas match physics laws', () => {
  const proj = runPhysicsExperiment({ experimentType: 'projectile', v0: 40, angleDeg: 45, gravity: 9.81, dragCoeff: 0 });
  // Theoretical zero-drag range: v0^2 * sin(90) / g ≈ 163.1 m
  assert.ok(Math.abs(proj.metrics.rangeMeters - 163.1) < 6);

  const coll = runPhysicsExperiment({ experimentType: 'collision_1d', mass: 5, v0: 4, mass2: 3, v2: -2, restitution: 0.8 });
  assert.ok(Math.abs(coll.metrics.momentumBefore - coll.metrics.momentumAfter) < 1e-4);

  const carnot = runPhysicsExperiment({ experimentType: 'thermodynamics_carnot', tHotK: 600, tColdK: 300, heatInJ: 1000 });
  assert.equal(carnot.metrics.carnotEfficiencyPct, 50);
  assert.equal(carnot.metrics.maxWorkOutputJ, 500);

  assert.ok(REFERENCE_MATERIALS.length >= 6);
  const stressRes = analyzeMaterialStress({
    materialId: 'mat-steel-a36',
    appliedForceN: 30000,
    crossSectionAreaMm2: 100, // 300 MPa > 250 MPa yield, < 400 MPa ultimate
  });
  assert.equal(stressRes.appliedStressMPa, 300);
  assert.equal(stressRes.regime, 'yielding');
  assert.ok(stressRes.stressStrainCurve.length > 10);

  const beam = runEngineeringAnalysis({
    analysisType: 'beam_bending',
    lengthM: 4,
    loadN: 8000,
    widthMm: 100,
    heightMm: 200,
    youngsModulusGPa: 200,
    yieldStrengthMPa: 250,
    beamSupport: 'simply_supported',
  });
  // Max moment = P*L/4 = 8000 * 4 / 4 = 8000 N*m
  assert.equal(beam.results.maxMomentNm, 8000);
  assert.ok(beam.results.maxDeflectionMm > 0);
});

// ---------------------------------------------------------------------------
// 4. OMNI TRANSLATOR TESTS
// ---------------------------------------------------------------------------
test('OMNI TRANSLATOR parses/serializes subtitles preserving timestamps and verifies glossary QA', () => {
  const srt = `1\n00:00:01,000 --> 00:00:04,500\nSystem architecture review.\n\n2\n00:00:05,000 --> 00:00:08,000\nDatabase 2026 security check.`;
  const parsed = parseSubtitles(srt);
  assert.equal(parsed.format, 'srt');
  assert.equal(parsed.cues.length, 2);
  assert.equal(parsed.cues[0].startTime, '00:00:01,000');

  const vttOut = serializeSubtitles(parsed.cues, 'vtt');
  assert.ok(vttOut.startsWith('WEBVTT'));
  assert.ok(vttOut.includes('00:00:01.000 --> 00:00:04.500'));

  const glossaries = [{ sourceTerm: 'database', targetTerm: 'قاعدة البيانات', domain: 'Software Engineering' }];
  const hints = applyGlossaryHints('Audit database 2026 metrics', glossaries);
  assert.equal(hints.matchedTerms.length, 1);

  const fallback = deterministicTranslateFallback({
    text: 'Audit database 2026 metrics',
    sourceLang: 'en',
    targetLang: 'ar',
    glossaries,
    memoryMatches: [],
  });
  assert.ok(fallback.translated.includes('قاعدة البيانات'));

  const qa = verifyTranslationQuality({
    sourceText: 'Audit database 2026 metrics',
    translatedText: fallback.translated,
    matchedGlossaryTerms: hints.matchedTerms,
  });
  assert.equal(qa.glossaryCompliancePct, 100);
  assert.equal(qa.placeholderPreserved, true);
  assert.equal(qa.completenessOk, true);
});

// ---------------------------------------------------------------------------
// 5. OMNI AUTOBUILD FACTORY & ZIP ARCHIVE TESTS
// ---------------------------------------------------------------------------
test('OMNI AUTOBUILD synthesizes full blueprint, preserves state during live edit, and builds valid ZIP', () => {
  const bp = buildApplicationBlueprint('أنشئ نظام إدارة شركة هندسية باللغة العربية');
  assert.equal(bp.language, 'ar');
  assert.equal(bp.category, 'engineering_platform');
  assert.ok(bp.entities.some((e) => e.tableName === 'engineering_projects'));
  assert.ok(bp.qcReport.passed);

  const edited = applyLiveEditToBlueprint(bp, 'اجعل اللون أزرق وأضف إدارة الموظفين');
  assert.equal(edited.blueprint.themeAccent, 'blue');
  assert.ok(edited.blueprint.entities.some((e) => e.tableName === 'engineering_projects'));
  assert.ok(edited.blueprint.entities.some((e) => e.tableName === 'employees'));
  assert.ok(edited.appliedChanges.length >= 2);
  assert.equal(runAutoBuildQualityChecks(edited.blueprint).passed, true);

  const zipBuf = buildZipArchive(edited.blueprint.files);
  // ZIP Local file header magic PK\x03\x04
  assert.equal(zipBuf.readUInt32LE(0), 0x04034b50);
  assert.ok(zipBuf.toString('utf8').includes('index.html'));
  assert.ok(zipBuf.toString('utf8').includes('db/migrations/001_init.sql'));
});
