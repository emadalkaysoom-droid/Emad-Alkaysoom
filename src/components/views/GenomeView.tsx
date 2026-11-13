import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Camera, Dna, GitCommitHorizontal, Search, ZoomIn, ZoomOut } from 'lucide-react';
import { useOmnix } from '../../contexts/OmnixContext';
import { apiFetch } from '../../lib/apiClient';
import type { ChangeImpactResult, GenomeNode, ProjectDigitalDNA } from '../../../shared/genomeEngine';

const KIND_COLOR: Record<GenomeNode['kind'], string> = {
  file: '#38bdf8',
  api_route: '#34d399',
  db_table: '#f59e0b',
  module: '#a78bfa',
  task: '#f472b6',
  version: '#94a3b8',
};

export function GenomeView() {
  const { activeWorkspaceId, language, hasEntitlement, setActiveView } = useOmnix();
  const isAr = language === 'ar';

  const [dna, setDna] = useState<ProjectDigitalDNA | null>(null);
  const [snapshots, setSnapshots] = useState<Array<{ id: string; label: string; health_json: string; created_at: string }>>([]);
  const [selectedNode, setSelectedNode] = useState<GenomeNode | null>(null);
  const [impact, setImpact] = useState<ChangeImpactResult | null>(null);
  const [kindFilter, setKindFilter] = useState<string>('ALL');
  const [query, setQuery] = useState('');
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [snapLabel, setSnapLabel] = useState('');
  const [error, setError] = useState<string | null>(null);

  const loadGenome = useCallback(async () => {
    const res = await apiFetch(`/api/genome?workspaceId=${encodeURIComponent(activeWorkspaceId)}`);
    if (res.ok) {
      const data = await res.json();
      setDna(data.dna);
      setSnapshots(data.snapshots || []);
      if (data.dna?.nodes?.length && !selectedNode) {
        setSelectedNode(data.dna.nodes[0]);
      }
    }
  }, [activeWorkspaceId]);

  useEffect(() => {
    void loadGenome();
  }, [loadGenome]);

  const runImpact = async (node: GenomeNode) => {
    setSelectedNode(node);
    setError(null);
    const res = await apiFetch('/api/genome/impact', {
      method: 'POST',
      body: JSON.stringify({ workspaceId: activeWorkspaceId, targetNodeId: node.id }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || 'Impact analysis requires OMNIX PREMIUM');
      return;
    }
    setImpact(data);
  };

  const saveSnapshot = async () => {
    const res = await apiFetch('/api/genome/snapshot', {
      method: 'POST',
      body: JSON.stringify({ workspaceId: activeWorkspaceId, label: snapLabel || `DNA Baseline ${new Date().toISOString().slice(11, 16)}` }),
    });
    if (res.ok) {
      setSnapLabel('');
      void loadGenome();
    }
  };

  const visibleNodes = useMemo(() => {
    if (!dna) return [];
    return dna.nodes.filter((n) => {
      if (kindFilter !== 'ALL' && n.kind !== kindFilter) return false;
      if (query.trim() && !n.label.toLowerCase().includes(query.toLowerCase())) return false;
      return true;
    });
  }, [dna, kindFilter, query]);

  const visibleNodeIds = useMemo(() => new Set(visibleNodes.map((n) => n.id)), [visibleNodes]);
  const highlightedIds = useMemo(() => {
    const s = new Set<string>();
    if (selectedNode) s.add(selectedNode.id);
    if (impact) {
      for (const n of impact.directAffected) s.add(n.id);
      for (const n of impact.transitiveAffected) s.add(n.id);
    }
    return s;
  }, [selectedNode, impact]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-4">
        <div>
          <h1 className="font-display text-xl font-bold text-slate-100 flex items-center gap-2">
            <Dna className="h-5 w-5 text-sky-400" />
            <span>OMNI GENOME · {isAr ? 'البصمة الرقمية الشاملة للمشروع' : 'Project Digital DNA'}</span>
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            {isAr
              ? 'خريطة العلاقات التفاعلية بين الملفات وقواعد البيانات والـ APIs، تحليل أثر التغيير، وصحة المشروع المقاسة.'
              : 'Interactive architectural DNA map linking source files, APIs, DB tables, measurable health metrics, and change impact prediction.'}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {!hasEntitlement('PROJECT_DIGITAL_DNA_PRO') && (
            <button
              type="button"
              onClick={() => setActiveView('billing')}
              className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-300"
            >
              {isAr ? 'ترقية لتحليل أثر التغيير الكامل' : 'Unlock Impact Forecasting ($5/3mo)'}
            </button>
          )}
          <input
            type="text"
            value={snapLabel}
            onChange={(e) => setSnapLabel(e.target.value)}
            placeholder={isAr ? 'اسم نقطة الاستعادة...' : 'Snapshot label...'}
            className="rounded-md border border-slate-800 bg-[#0F141F] px-2.5 py-1.5 text-xs text-slate-100"
          />
          <button
            type="button"
            onClick={() => void saveSnapshot()}
            className="flex items-center gap-1.5 rounded-md bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-500"
          >
            <Camera className="h-3.5 w-3.5" />
            <span>{isAr ? 'حفظ بصمة' : 'Capture Snapshot'}</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-4 py-2 text-xs text-rose-200">{error}</div>
      )}

      {dna && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
            {[
              ['Overall DNA', `${dna.health.overall}%`],
              ['Architecture', `${dna.health.architecture}%`],
              ['Code Quality', `${dna.health.codeQuality}%`],
              ['Dependencies', `${dna.health.dependencyHealth}%`],
              ['Security', `${dna.health.security}%`],
              ['Test Coverage', `${dna.health.testCoverage}%`],
              ['Tech Debt', `${dna.health.technicalDebtHours}h`],
            ].map(([lbl, val]) => (
              <div key={lbl} className="rounded-lg border border-slate-800 bg-[#0F141F] p-3">
                <div className="text-[11px] text-slate-400">{lbl}</div>
                <div className="font-mono text-base font-bold tabular-nums text-slate-100 mt-1">{val}</div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2 rounded-lg border border-slate-800 bg-[#0F141F] p-3 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 flex-1 min-w-[200px]">
                  <div className="relative flex-1">
                    <Search className="h-3.5 w-3.5 text-slate-500 absolute start-2.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="search"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Filter nodes..."
                      className="w-full rounded border border-slate-800 bg-[#0B0F17] py-1 ps-8 pe-2 text-xs text-slate-200"
                    />
                  </div>
                  <select
                    value={kindFilter}
                    onChange={(e) => setKindFilter(e.target.value)}
                    className="rounded border border-slate-800 bg-[#0B0F17] px-2 py-1 text-xs text-slate-200"
                  >
                    <option value="ALL">All Nodes ({dna.nodes.length})</option>
                    <option value="file">Source Files ({dna.summary.files})</option>
                    <option value="api_route">API Routes ({dna.summary.apiRoutes})</option>
                    <option value="db_table">DB Tables ({dna.summary.dbTables})</option>
                    <option value="task">Tasks ({dna.summary.tasks})</option>
                  </select>
                </div>

                <div className="flex items-center gap-1">
                  <button type="button" aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(0.6, z - 0.15))} className="rounded border border-slate-800 p-1 text-slate-300 hover:bg-slate-800">
                    <ZoomOut className="h-3.5 w-3.5" />
                  </button>
                  <button type="button" aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(1.8, z + 0.15))} className="rounded border border-slate-800 p-1 text-slate-300 hover:bg-slate-800">
                    <ZoomIn className="h-3.5 w-3.5" />
                  </button>
                  <button type="button" onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }} className="rounded border border-slate-800 px-2 py-1 text-[11px] text-slate-300 hover:bg-slate-800">
                    Reset
                  </button>
                </div>
              </div>

              <div className="overflow-hidden rounded-md border border-slate-800 bg-[#0B0F17]">
                <svg
                  data-testid="genome-graph-svg"
                  viewBox="0 0 1120 680"
                  className="h-[420px] w-full cursor-grab"
                  onWheel={(e) => {
                    e.preventDefault();
                    setZoom((z) => Math.max(0.55, Math.min(1.9, z + (e.deltaY < 0 ? 0.08 : -0.08))));
                  }}
                >
                  <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
                    {dna.edges
                      .filter((e) => visibleNodeIds.has(e.source) && visibleNodeIds.has(e.target))
                      .map((edge) => {
                        const src = dna.nodes.find((n) => n.id === edge.source);
                        const tgt = dna.nodes.find((n) => n.id === edge.target);
                        if (!src || !tgt) return null;
                        const active = highlightedIds.has(src.id) && highlightedIds.has(tgt.id);
                        return (
                          <line
                            key={edge.id}
                            x1={src.x}
                            y1={src.y}
                            x2={tgt.x}
                            y2={tgt.y}
                            stroke={active ? '#38bdf8' : '#1e293b'}
                            strokeWidth={active ? 1.8 : 0.9}
                            strokeOpacity={active ? 0.9 : 0.65}
                          />
                        );
                      })}
                    {visibleNodes.map((n) => {
                      const isSel = selectedNode?.id === n.id;
                      const isHit = highlightedIds.has(n.id);
                      const color = KIND_COLOR[n.kind] || '#38bdf8';
                      return (
                        <g
                          key={n.id}
                          transform={`translate(${n.x}, ${n.y})`}
                          className="cursor-pointer"
                          onClick={() => void runImpact(n)}
                        >
                          <circle
                            r={isSel ? 9 : isHit ? 7 : 5.5}
                            fill={color}
                            stroke={isSel ? '#ffffff' : '#0B0F17'}
                            strokeWidth={isSel ? 2 : 1.2}
                          />
                          <text
                            x={9}
                            y={3}
                            fill={isSel || isHit ? '#f8fafc' : '#94a3b8'}
                            fontSize={10}
                            fontFamily="monospace"
                          >
                            {n.label.length > 26 ? `${n.label.slice(0, 24)}…` : n.label}
                          </text>
                        </g>
                      );
                    })}
                  </g>
                </svg>
              </div>
            </div>

            <div className="space-y-4">
              <div className="rounded-lg border border-slate-800 bg-[#0F141F] p-4 space-y-2.5 text-xs">
                <h2 className="font-semibold text-slate-200 border-b border-slate-800 pb-2">
                  {isAr ? 'مفتش العقدة وأثر التغيير' : 'Node & Change Impact Inspector'}
                </h2>
                {selectedNode ? (
                  <>
                    <div className="font-mono text-sky-300 break-all">{selectedNode.label}</div>
                    <div className="text-slate-400">
                      Kind: {selectedNode.kind} · In: {selectedNode.inDegree} · Out: {selectedNode.outDegree}
                    </div>
                    <button
                      type="button"
                      onClick={() => void runImpact(selectedNode)}
                      className="w-full rounded bg-sky-600/20 border border-sky-500/40 px-3 py-1.5 font-medium text-sky-300 hover:bg-sky-600/30"
                    >
                      {isAr ? 'حساب أثر التغيير المتوقع' : 'Predict Change Blast Radius'}
                    </button>
                  </>
                ) : (
                  <p className="text-slate-400">Click any node in the DNA graph.</p>
                )}

                {impact && (
                  <div className="border-t border-slate-800 pt-2.5 space-y-1.5">
                    <div className="flex justify-between">
                      <span className="text-slate-400">Blast Radius</span>
                      <span className="font-mono font-bold text-amber-300 tabular-nums">{impact.estimatedBlastRadiusPct}%</span>
                    </div>
                    <div className="text-slate-300">Direct: {impact.directAffected.length} · Transitive: {impact.transitiveAffected.length}</div>
                    {impact.affectedApiRoutes.length > 0 && (
                      <div className="text-[11px] text-emerald-300">APIs: {impact.affectedApiRoutes.slice(0, 4).join(', ')}</div>
                    )}
                    {impact.affectedDbTables.length > 0 && (
                      <div className="text-[11px] text-amber-300">Tables: {impact.affectedDbTables.slice(0, 4).join(', ')}</div>
                    )}
                    <div className="text-[11px] text-slate-400">Tests: {impact.recommendedTests.slice(0, 3).join(', ')}</div>
                  </div>
                )}
              </div>

              <div className="rounded-lg border border-slate-800 bg-[#0F141F] p-4 space-y-2 text-xs">
                <h2 className="font-semibold text-slate-200 flex items-center gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
                  <span>{isAr ? 'توقعات المخاطر المعمارية' : 'Predictive Risk Signals'}</span>
                </h2>
                <div className="divide-y divide-slate-800/80 max-h-48 overflow-y-auto">
                  {dna.risks.slice(0, 5).map((r) => (
                    <div key={r.id} className="py-2">
                      <div className="font-mono text-slate-200 truncate">{r.label}</div>
                      <div className="text-[11px] text-slate-400">{r.reason}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {snapshots.length > 0 && (
            <div className="rounded-lg border border-slate-800 bg-[#0F141F] p-4 text-xs">
              <h2 className="font-semibold text-slate-300 mb-2 flex items-center gap-1.5">
                <GitCommitHorizontal className="h-4 w-4 text-sky-400" />
                <span>{isAr ? 'الخط الزمني لنقاط الاستعادة' : 'Digital DNA History & Restore Points'}</span>
              </h2>
              <div className="divide-y divide-slate-800/70">
                {snapshots.map((s) => {
                  const h = JSON.parse(s.health_json || '{}') as { overall?: number };
                  return (
                    <div key={s.id} className="flex items-center justify-between py-2">
                      <span className="text-slate-200 font-medium">{s.label}</span>
                      <span className="font-mono text-slate-400 tabular-nums">Health {h.overall ?? '--'}% · {s.created_at}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
