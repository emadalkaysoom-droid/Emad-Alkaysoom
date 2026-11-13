import React, { useCallback, useEffect, useState } from 'react';
import { Code2, GitBranch, Play, RefreshCw, ShieldAlert, Sparkles, Terminal, Undo2, Wrench } from 'lucide-react';
import { useOmnix } from '../../contexts/OmnixContext';
import { apiFetch } from '../../lib/apiClient';
import type { CodexFinding, ProjectAnalysisReport, SupportedCodexLanguage } from '../../../shared/codexEngine';

const LANGS: SupportedCodexLanguage[] = [
  'TypeScript', 'JavaScript', 'Python', 'Java', 'C', 'C++', 'C#', 'Go', 'Rust', 'PHP', 'HTML', 'CSS', 'SQL', 'Swift', 'Kotlin',
];

export function CodexView() {
  const { activeWorkspaceId, language, hasEntitlement, setActiveView } = useOmnix();
  const isAr = language === 'ar';

  const [tab, setTab] = useState<'analyzer' | 'generator' | 'sandbox' | 'git'>('analyzer');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<ProjectAnalysisReport | null>(null);
  const [selectedLayer, setSelectedLayer] = useState<string>('ALL');
  const [selectedFinding, setSelectedFinding] = useState<CodexFinding | null>(null);
  const [patchPreview, setPatchPreview] = useState<{ patchId: string; unifiedDiff: string; status: string; note: string } | null>(null);
  const [customSnippet, setCustomSnippet] = useState<string>('');
  const [testOutput, setTestOutput] = useState<{ passed: boolean; stdout: string; stderr: string } | null>(null);

  // Generator state
  const [genPrompt, setGenPrompt] = useState('أنشئ نظام تسجيل دخول باستخدام قاعدة بيانات PostgreSQL');
  const [genLang, setGenLang] = useState<SupportedCodexLanguage>('TypeScript');
  const [genType, setGenType] = useState<'api' | 'model' | 'class' | 'test' | 'config' | 'docs'>('api');
  const [generated, setGenerated] = useState<{ fileName: string; code: string; notes: string; provider: string } | null>(null);

  // Sandbox state
  const [sbxLang, setSbxLang] = useState('JavaScript');
  const [sbxCode, setSbxCode] = useState('const nums = [12, 18, 24, 30];\nconsole.log("Mean:", nums.reduce((a,b)=>a+b,0)/nums.length);\nreturn { count: nums.length, max: Math.max(...nums) };');
  const [sbxResult, setSbxResult] = useState<{ status: string; stdout: string; stderr: string; durationMs: number; sandboxNotice: string } | null>(null);

  // Git & overview state
  const [gitInfo, setGitInfo] = useState<{ available: boolean; branch: string; statusLines: string[]; commits: Array<{ hash: string; author: string; date: string; message: string }>; diffPreview: string; notice?: string } | null>(null);
  const [patches, setPatches] = useState<Array<{ id: string; file_path: string; status: string; created_at: string }>>([]);

  const loadOverview = useCallback(async () => {
    const res = await apiFetch(`/api/codex/overview?workspaceId=${encodeURIComponent(activeWorkspaceId)}`);
    if (res.ok) {
      const data = await res.json();
      setPatches(data.patches || []);
    }
  }, [activeWorkspaceId]);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  const runScan = async () => {
    setLoading(true);
    setError(null);
    setPatchPreview(null);
    try {
      const body = customSnippet.trim()
        ? { workspaceId: activeWorkspaceId, targetName: 'Custom Code Paste', customFiles: [{ path: 'custom_module.ts', content: customSnippet }] }
        : { workspaceId: activeWorkspaceId };
      const res = await apiFetch('/api/codex/analyze', { method: 'POST', body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Analysis failed');
      setReport(data.report);
      setSelectedFinding(data.report.findings?.[0] || null);
      void loadOverview();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Scan error');
    } finally {
      setLoading(false);
    }
  };

  const previewPatch = async (finding: CodexFinding) => {
    setError(null);
    const res = await apiFetch('/api/codex/patch', {
      method: 'POST',
      body: JSON.stringify({
        workspaceId: activeWorkspaceId,
        finding,
        customSource: customSnippet.trim() ? customSnippet : undefined,
        persistToDisk: false,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || 'Patch preview requires OMNIX PREMIUM');
      return;
    }
    setPatchPreview(data);
    void loadOverview();
  };

  const rollbackPatch = async (patchId: string) => {
    const res = await apiFetch(`/api/codex/patch/${encodeURIComponent(patchId)}/rollback`, { method: 'POST' });
    if (res.ok) {
      setPatchPreview(null);
      void loadOverview();
    }
  };

  const runCodeGen = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch('/api/codex/generate', {
        method: 'POST',
        body: JSON.stringify({ workspaceId: activeWorkspaceId, prompt: genPrompt, language: genLang, artifactType: genType }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Generation failed');
      setGenerated(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Code gen error');
    } finally {
      setLoading(false);
    }
  };

  const runSandbox = async () => {
    setLoading(true);
    try {
      const res = await apiFetch('/api/codex/sandbox', {
        method: 'POST',
        body: JSON.stringify({ workspaceId: activeWorkspaceId, language: sbxLang, code: sbxCode }),
      });
      const data = await res.json();
      setSbxResult(data);
    } finally {
      setLoading(false);
    }
  };

  const loadGit = async () => {
    const res = await apiFetch('/api/codex/git');
    if (res.ok) setGitInfo(await res.json());
  };

  const runUnitTests = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch('/api/codex/tests/run', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Requires Premium');
      setTestOutput(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Test run blocked');
    } finally {
      setLoading(false);
    }
  };

  const filteredFindings = (report?.findings || []).filter(
    (f) => selectedLayer === 'ALL' || f.layer === selectedLayer
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-4">
        <div>
          <h1 className="font-display text-xl font-bold text-slate-100 flex items-center gap-2">
            <Code2 className="h-5 w-5 text-sky-400" />
            <span>OMNI CODEX · {isAr ? 'ذكاء هندسة البرمجيات المتقدم' : 'Software Engineering Intelligence'}</span>
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            {isAr
              ? 'فحص شامل للمشاريع عبر 15 لغة برمجة و10 طبقات تحليل، إصلاح ذكي مع تراجع، توليد الكود، Sandbox، وGit.'
              : '15-language project engine · 10-layer static/security/architecture audit · Diff repair & rollback · Sandbox & Git.'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {!hasEntitlement('ADVANCED_CODEX_INTELLIGENCE') && (
            <button
              type="button"
              onClick={() => setActiveView('billing')}
              className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-300 hover:bg-amber-500/20"
            >
              {isAr ? 'الترقية إلى Premium لفتح التصحيح المتقدم' : 'Unlock Pro Repair & Refactor ($5/3mo)'}
            </button>
          )}
          <div className="flex rounded-md border border-slate-800 bg-[#0F141F] p-0.5 text-xs">
            {([
              ['analyzer', isAr ? 'المحلل الذكي' : '10-Layer Audit'],
              ['generator', isAr ? 'توليد الكود' : 'Code Gen'],
              ['sandbox', 'Sandbox'],
              ['git', 'Git VCS'],
            ] as const).map(([id, lbl]) => (
              <button
                key={id}
                type="button"
                onClick={() => {
                  setTab(id);
                  if (id === 'git' && !gitInfo) void loadGit();
                }}
                className={`rounded px-3 py-1.5 font-medium transition-colors ${
                  tab === id ? 'bg-sky-500/20 text-sky-300' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {lbl}
              </button>
            ))}
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-4 py-2.5 text-xs text-rose-200 flex items-center justify-between">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} className="text-rose-300 underline">Dismiss</button>
        </div>
      )}

      {tab === 'analyzer' && (
        <div className="space-y-4">
          <div className="rounded-lg border border-slate-800 bg-[#0F141F] p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs text-slate-300 font-medium">
                {isAr ? 'نطاق الفحص: مساحة العمل الحية أو لصق كود مباشر' : 'Scan Target: Live OMNIX Workspace or Paste Custom Snippet'}
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void runUnitTests()}
                  disabled={loading}
                  className="flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800/70 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800"
                >
                  <Terminal className="h-3.5 w-3.5 text-emerald-400" />
                  <span>{isAr ? 'تشغيل اختبارات المشروع' : 'Run Test Suite'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => void runScan()}
                  disabled={loading}
                  className="flex items-center gap-1.5 rounded-md bg-sky-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-sky-500 disabled:opacity-50"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
                  <span>{isAr ? 'بدء التحليل الشامل' : 'Run 10-Layer Analysis'}</span>
                </button>
              </div>
            </div>
            <textarea
              value={customSnippet}
              onChange={(e) => setCustomSnippet(e.target.value)}
              rows={3}
              placeholder={isAr ? 'اختياري: الصق كوداً هنا لفحصه مباشرة (أو اتركه فارغاً لفحص كامل ملفات المشروع)...' : 'Optional: paste source code here to audit a snippet directly (leave blank to scan the full workspace codebase)...'}
              className="w-full rounded-md border border-slate-800 bg-[#0B0F17] p-2.5 font-mono text-xs text-slate-200 placeholder:text-slate-600 focus:border-sky-500 focus:outline-none"
            />
          </div>

          {testOutput && (
            <div className="rounded-lg border border-slate-800 bg-[#0F141F] p-4 text-xs">
              <div className="flex items-center justify-between mb-2">
                <span className="font-semibold text-slate-200">Verification Test Output</span>
                <span className={`font-mono font-semibold ${testOutput.passed ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {testOutput.passed ? 'PASSED' : 'FAILED'}
                </span>
              </div>
              <pre className="max-h-40 overflow-auto rounded bg-[#0B0F17] p-2.5 font-mono text-[11px] text-slate-300">
                {testOutput.stdout || testOutput.stderr}
              </pre>
            </div>
          )}

          {report && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                {[
                  ['Files / LOC', `${report.fileCount} · ${report.totalLoc.toLocaleString()}`],
                  ['Quality Score', `${report.qualityScore}%`],
                  ['Security Score', `${report.securityScore}%`],
                  ['Architecture', `${report.architectureScore}%`],
                  ['Findings', `${report.findings.length} (${report.severitySummary.critical} crit)`],
                ].map(([label, val]) => (
                  <div key={label} className="rounded-lg border border-slate-800 bg-[#0F141F] p-3">
                    <div className="text-[11px] text-slate-400">{label}</div>
                    <div className="font-mono text-base font-bold tabular-nums text-slate-100 mt-1">{val}</div>
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-800 pb-3 text-xs">
                {['ALL', 'Security', 'Syntax', 'Semantic', 'Dependency', 'Performance', 'Quality', 'DeadCode', 'DuplicateCode', 'Architecture'].map((layer) => (
                  <button
                    key={layer}
                    type="button"
                    onClick={() => setSelectedLayer(layer)}
                    className={`rounded px-2.5 py-1 font-mono text-[11px] transition-colors ${
                      selectedLayer === layer ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40' : 'bg-slate-900 text-slate-400 border border-slate-800 hover:text-slate-200'
                    }`}
                  >
                    {layer}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="rounded-lg border border-slate-800 bg-[#0F141F] divide-y divide-slate-800/80 max-h-[420px] overflow-y-auto">
                  {filteredFindings.length === 0 ? (
                    <div className="p-6 text-xs text-slate-400">No findings in selected layer.</div>
                  ) : (
                    filteredFindings.map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => {
                          setSelectedFinding(f);
                          setPatchPreview(null);
                        }}
                        className={`w-full text-start p-3 hover:bg-slate-800/40 transition-colors ${
                          selectedFinding?.id === f.id ? 'bg-sky-500/10' : ''
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <span className="font-semibold text-slate-200 truncate">{f.title}</span>
                          <span className={`font-mono text-[11px] uppercase ${
                            f.severity === 'critical' ? 'text-rose-400' : f.severity === 'high' ? 'text-amber-400' : 'text-sky-400'
                          }`}>
                            {f.severity}
                          </span>
                        </div>
                        <div className="mt-1 font-mono text-[11px] text-slate-400">
                          {f.file}:{f.line} · {f.layer} · {f.language}
                        </div>
                      </button>
                    ))
                  )}
                </div>

                <div className="rounded-lg border border-slate-800 bg-[#0F141F] p-4 space-y-3">
                  {selectedFinding ? (
                    <>
                      <div className="flex items-start justify-between gap-2 border-b border-slate-800 pb-2">
                        <div>
                          <div className="text-sm font-semibold text-slate-100 flex items-center gap-1.5">
                            <ShieldAlert className="h-4 w-4 text-amber-400" />
                            <span>{selectedFinding.title}</span>
                          </div>
                          <div className="font-mono text-[11px] text-slate-400 mt-0.5">
                            {selectedFinding.file}:{selectedFinding.line} · {selectedFinding.type}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => void previewPatch(selectedFinding)}
                          className="flex items-center gap-1 rounded bg-sky-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-sky-500 shrink-0"
                        >
                          <Wrench className="h-3.5 w-3.5" />
                          <span>{isAr ? 'معاينة الإصلاح Diff' : 'Preview Repair Diff'}</span>
                        </button>
                      </div>
                      <div className="space-y-2 text-xs">
                        <div><span className="text-slate-400">Cause: </span><span className="text-slate-200">{selectedFinding.cause}</span></div>
                        <div><span className="text-slate-400">Impact: </span><span className="text-slate-200">{selectedFinding.impact}</span></div>
                        <div><span className="text-slate-400">Proposed Fix: </span><span className="text-emerald-300">{selectedFinding.proposedFix}</span></div>
                        <div className="rounded bg-[#0B0F17] p-2 font-mono text-[11px] text-slate-300 overflow-x-auto">
                          <div className="text-rose-400">- {selectedFinding.originalSnippet}</div>
                          {selectedFinding.replacementCode && <div className="text-emerald-400">+ {selectedFinding.replacementCode}</div>}
                        </div>
                      </div>
                      {patchPreview && (
                        <div className="border-t border-slate-800 pt-3 space-y-2">
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-semibold text-sky-300">Patch Snapshot ({patchPreview.patchId})</span>
                            <button
                              type="button"
                              onClick={() => void rollbackPatch(patchPreview.patchId)}
                              className="flex items-center gap-1 text-slate-300 hover:text-white underline"
                            >
                              <Undo2 className="h-3 w-3" />
                              <span>Rollback</span>
                            </button>
                          </div>
                          <pre className="rounded bg-[#0B0F17] p-2.5 font-mono text-[11px] text-slate-200 overflow-x-auto">
                            {patchPreview.unifiedDiff}
                          </pre>
                          <p className="text-[11px] text-slate-400">{patchPreview.note}</p>
                        </div>
                      )}
                    </>
                  ) : (
                    <p className="text-xs text-slate-400">Select any finding to inspect root cause, impact, and patch diff.</p>
                  )}
                </div>
              </div>
            </>
          )}

          {patches.length > 0 && (
            <div className="rounded-lg border border-slate-800 bg-[#0F141F] p-4">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">Patch Snapshot History</h2>
              <div className="divide-y divide-slate-800/80 text-xs">
                {patches.slice(0, 5).map((p) => (
                  <div key={p.id} className="flex items-center justify-between py-2">
                    <span className="font-mono text-slate-200">{p.file_path} · {p.id}</span>
                    <span className="font-mono text-slate-400">{p.status}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'generator' && (
        <div className="rounded-lg border border-slate-800 bg-[#0F141F] p-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-slate-400 mb-1">{isAr ? 'وصف الوحدة أو النظام المطلوب' : 'Specification Prompt'}</label>
              <input
                type="text"
                value={genPrompt}
                onChange={(e) => setGenPrompt(e.target.value)}
                className="w-full rounded-md border border-slate-800 bg-[#0B0F17] px-3 py-2 text-xs text-slate-100 focus:border-sky-500 focus:outline-none"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Language</label>
                <select
                  value={genLang}
                  onChange={(e) => setGenLang(e.target.value as SupportedCodexLanguage)}
                  className="w-full rounded-md border border-slate-800 bg-[#0B0F17] px-2.5 py-2 text-xs text-slate-100"
                >
                  {LANGS.map((l) => <option key={l} value={l}>{l}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Artifact</label>
                <select
                  value={genType}
                  onChange={(e) => setGenType(e.target.value as typeof genType)}
                  className="w-full rounded-md border border-slate-800 bg-[#0B0F17] px-2.5 py-2 text-xs text-slate-100"
                >
                  <option value="api">API Service</option>
                  <option value="model">DB Model</option>
                  <option value="class">Class / Module</option>
                  <option value="test">Unit Tests</option>
                  <option value="config">Config</option>
                  <option value="docs">Docs</option>
                </select>
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void runCodeGen()}
            disabled={loading}
            className="flex items-center gap-1.5 rounded-md bg-sky-600 px-4 py-2 text-xs font-semibold text-white hover:bg-sky-500"
          >
            <Sparkles className="h-3.5 w-3.5" />
            <span>{isAr ? 'توليد الكود الهندسي' : 'Generate Code Artifact'}</span>
          </button>

          {generated && (
            <div className="space-y-2 border-t border-slate-800 pt-3">
              <div className="flex items-center justify-between text-xs">
                <span className="font-mono font-semibold text-sky-300">{generated.fileName}</span>
                <span className="font-mono text-slate-400">Engine: {generated.provider}</span>
              </div>
              <p className="text-xs text-slate-400">{generated.notes}</p>
              <pre className="max-h-96 overflow-auto rounded-md border border-slate-800 bg-[#0B0F17] p-3 font-mono text-xs text-slate-200">
                {generated.code}
              </pre>
            </div>
          )}
        </div>
      )}

      {tab === 'sandbox' && (
        <div className="rounded-lg border border-slate-800 bg-[#0F141F] p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <select
              value={sbxLang}
              onChange={(e) => setSbxLang(e.target.value)}
              className="rounded-md border border-slate-800 bg-[#0B0F17] px-3 py-1.5 text-xs text-slate-200"
            >
              <option value="JavaScript">JavaScript (Isolated node:vm)</option>
              <option value="TypeScript">TypeScript (Isolated node:vm)</option>
              <option value="Python">Python (Pre-flight Audit)</option>
              <option value="SQL">SQL (Pre-flight Audit)</option>
            </select>
            <button
              type="button"
              onClick={() => void runSandbox()}
              disabled={loading}
              className="flex items-center gap-1.5 rounded-md bg-emerald-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500"
            >
              <Play className="h-3.5 w-3.5" />
              <span>{isAr ? 'تشغيل في بيئة معزولة' : 'Execute in Sandbox'}</span>
            </button>
          </div>
          <textarea
            value={sbxCode}
            onChange={(e) => setSbxCode(e.target.value)}
            rows={7}
            className="w-full rounded-md border border-slate-800 bg-[#0B0F17] p-3 font-mono text-xs text-slate-200 focus:border-sky-500 focus:outline-none"
          />
          {sbxResult && (
            <div className="rounded-md border border-slate-800 bg-[#0B0F17] p-3 space-y-2 text-xs">
              <div className="flex items-center justify-between font-mono">
                <span className={sbxResult.status === 'completed' ? 'text-emerald-400' : 'text-amber-300'}>
                  STATUS: {sbxResult.status.toUpperCase()} ({sbxResult.durationMs}ms)
                </span>
              </div>
              <p className="text-[11px] text-slate-400">{sbxResult.sandboxNotice}</p>
              {sbxResult.stdout && <pre className="font-mono text-emerald-300 whitespace-pre-wrap">{sbxResult.stdout}</pre>}
              {sbxResult.stderr && <pre className="font-mono text-rose-400 whitespace-pre-wrap">{sbxResult.stderr}</pre>}
            </div>
          )}
        </div>
      )}

      {tab === 'git' && (
        <div className="rounded-lg border border-slate-800 bg-[#0F141F] p-4 space-y-3 text-xs">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 font-semibold text-slate-200">
              <GitBranch className="h-4 w-4 text-sky-400" />
              <span>Branch: {gitInfo?.branch || '...'}</span>
            </div>
            <button
              type="button"
              onClick={() => void loadGit()}
              className="rounded border border-slate-700 px-2.5 py-1 text-slate-300 hover:bg-slate-800"
            >
              Refresh Git
            </button>
          </div>
          {gitInfo && !gitInfo.available && <p className="text-amber-300">{gitInfo.notice}</p>}
          {gitInfo?.available && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <h3 className="font-semibold text-slate-400 mb-2">Recent Commits</h3>
                <div className="divide-y divide-slate-800">
                  {gitInfo.commits.map((c) => (
                    <div key={c.hash} className="py-2">
                      <span className="font-mono text-sky-400">{c.hash}</span> · <span className="text-slate-200">{c.message}</span>
                      <div className="text-[11px] text-slate-500">{c.author} · {c.date}</div>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <h3 className="font-semibold text-slate-400 mb-2">Working Tree Changes & Diff Stat</h3>
                <pre className="rounded bg-[#0B0F17] p-3 font-mono text-[11px] text-slate-300 overflow-auto max-h-64">
                  {gitInfo.statusLines.join('\n') || 'Clean tree'}
                  {'\n\n'}
                  {gitInfo.diffPreview}
                </pre>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
