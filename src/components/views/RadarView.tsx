import React, { useCallback, useEffect, useState } from 'react';
import { ExternalLink, FileText, Plus, Radar, RefreshCw } from 'lucide-react';
import { useOmnix } from '../../contexts/OmnixContext';
import { apiFetch } from '../../lib/apiClient';

interface RadarSignal {
  id: string;
  category: string;
  title: string;
  summary: string;
  source_name: string;
  source_url: string;
  published_at: string;
  signal_kind: string;
  confidence: number;
}

export function RadarView() {
  const { activeWorkspaceId, language, hasEntitlement, setActiveView } = useOmnix();
  const isAr = language === 'ar';

  const [query, setQuery] = useState('AI agents engineering');
  const [monitorName, setMonitorName] = useState('');
  const [monitorType, setMonitorType] = useState<'topic' | 'competitor' | 'source'>('topic');
  const [monitors, setMonitors] = useState<Array<{ id: string; name: string; monitor_type: string }>>([]);
  const [signals, setSignals] = useState<RadarSignal[]>([]);
  const [reports, setReports] = useState<Array<{ id: string; title: string; facts_json: string; analysis: string; predictions_json: string; created_at: string }>>([]);
  const [sourceStatus, setSourceStatus] = useState<Array<{ source: string; status: string; detail: string }>>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadOverview = useCallback(async () => {
    const res = await apiFetch(`/api/radar/overview?workspaceId=${encodeURIComponent(activeWorkspaceId)}`);
    if (res.ok) {
      const data = await res.json();
      setMonitors(data.monitors || []);
      setSignals(data.signals || []);
      setReports(data.reports || []);
    }
  }, [activeWorkspaceId]);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  const addMonitor = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!monitorName.trim()) return;
    const res = await apiFetch('/api/radar/monitors', {
      method: 'POST',
      body: JSON.stringify({ workspaceId: activeWorkspaceId, name: monitorName, monitorType }),
    });
    if (res.ok) {
      setMonitorName('');
      void loadOverview();
    }
  };

  const collectSignals = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch('/api/radar/collect', {
        method: 'POST',
        body: JSON.stringify({ workspaceId: activeWorkspaceId, query }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Radar Pro requires OMNIX PREMIUM');
      setSourceStatus(data.sourcesChecked || []);
      void loadOverview();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Collection failed');
    } finally {
      setLoading(false);
    }
  };

  const buildReport = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch('/api/radar/report', {
        method: 'POST',
        body: JSON.stringify({ workspaceId: activeWorkspaceId, topic: query }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Report generation requires OMNIX PREMIUM');
      void loadOverview();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Report failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-4">
        <div>
          <h1 className="font-display text-xl font-bold text-slate-100 flex items-center gap-2">
            <Radar className="h-5 w-5 text-sky-400" />
            <span>OMNI RADAR · {isAr ? 'رادار الاستخبارات والفرص العالمي' : 'Global Intelligence & Opportunity Radar'}</span>
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            {isAr
              ? 'رصد المصادر العامة الموثوقة (GitHub، HackerNews، Wikipedia)، اكتشاف الاتجاهات والفرص، وفصل الحقائق عن التوقعات.'
              : 'Live public feed intelligence (HackerNews, GitHub, Wikipedia), competitor/topic monitors, and Fact vs Prediction reports.'}
          </p>
        </div>

        {!hasEntitlement('GLOBAL_RADAR_INTELLIGENCE') && (
          <button
            type="button"
            onClick={() => setActiveView('billing')}
            className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-300"
          >
            {isAr ? 'ترقية لفتح المراقبة المباشرة والتقارير' : 'Unlock Live Radar Feeds ($5/3mo)'}
          </button>
        )}
      </div>

      {error && (
        <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-4 py-2 text-xs text-rose-200">{error}</div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="rounded-lg border border-slate-800 bg-[#0F141F] p-4 space-y-4 text-xs">
          <div className="space-y-2">
            <label className="block font-semibold text-slate-200">{isAr ? 'استكشاف المصادر الحية' : 'Live Source Discovery'}</label>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full rounded border border-slate-800 bg-[#0B0F17] px-2.5 py-1.5 text-slate-100"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void collectSignals()}
                disabled={loading}
                className="flex-1 flex items-center justify-center gap-1.5 rounded bg-sky-600 px-3 py-1.5 font-semibold text-white hover:bg-sky-500"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
                <span>{isAr ? 'جلب الإشارات' : 'Scan Feeds'}</span>
              </button>
              <button
                type="button"
                onClick={() => void buildReport()}
                disabled={loading}
                className="flex items-center gap-1 rounded border border-slate-700 bg-slate-800/80 px-3 py-1.5 text-slate-200 hover:bg-slate-800"
              >
                <FileText className="h-3.5 w-3.5 text-emerald-400" />
                <span>{isAr ? 'تقرير استخباراتي' : 'Briefing'}</span>
              </button>
            </div>
          </div>

          {sourceStatus.length > 0 && (
            <div className="border-t border-slate-800 pt-3 space-y-1.5">
              {sourceStatus.map((s) => (
                <div key={s.source} className="flex items-center justify-between text-[11px]">
                  <span className="text-slate-300">{s.source}</span>
                  <span className={`font-mono ${s.status === 'live' ? 'text-emerald-400' : 'text-amber-400'}`}>
                    {s.status} · {s.detail}
                  </span>
                </div>
              ))}
            </div>
          )}

          <form onSubmit={(e) => void addMonitor(e)} className="border-t border-slate-800 pt-3 space-y-2">
            <div className="font-semibold text-slate-200">{isAr ? 'إضافة مراقب (منافس / موضوع)' : 'Add Topic / Competitor Monitor'}</div>
            <input
              type="text"
              value={monitorName}
              onChange={(e) => setMonitorName(e.target.value)}
              placeholder="e.g. OpenAI Agents / Autonomous Robotics"
              className="w-full rounded border border-slate-800 bg-[#0B0F17] px-2.5 py-1.5 text-slate-100"
            />
            <div className="flex gap-2">
              <select value={monitorType} onChange={(e) => setMonitorType(e.target.value as typeof monitorType)} className="rounded border border-slate-800 bg-[#0B0F17] px-2 py-1 text-slate-200">
                <option value="topic">Topic</option>
                <option value="competitor">Competitor</option>
                <option value="source">Source URL</option>
              </select>
              <button type="submit" className="flex items-center gap-1 rounded border border-sky-500/40 bg-sky-500/15 px-3 py-1 text-sky-300 hover:bg-sky-500/25">
                <Plus className="h-3.5 w-3.5" />
                <span>Track</span>
              </button>
            </div>
            {monitors.length > 0 && (
              <div className="pt-1 space-y-1">
                {monitors.map((m) => (
                  <div key={m.id} className="flex justify-between text-[11px] text-slate-400">
                    <span>{m.name}</span>
                    <span className="font-mono uppercase">{m.monitor_type}</span>
                  </div>
                ))}
              </div>
            )}
          </form>
        </div>

        <div className="lg:col-span-2 space-y-4">
          <div className="rounded-lg border border-slate-800 bg-[#0F141F] p-4">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">
              {isAr ? 'الإشارات المرصودة مع الروابط والتواريخ' : 'Verified Collected Signals'}
            </h2>
            {signals.length === 0 ? (
              <p className="text-xs text-slate-400">Run "Scan Feeds" to collect verified signals from GitHub, HackerNews, and Wikipedia.</p>
            ) : (
              <div className="divide-y divide-slate-800/80 max-h-80 overflow-y-auto">
                {signals.map((sig) => (
                  <div key={sig.id} className="py-2.5 space-y-1 text-xs">
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-semibold text-slate-100">{sig.title}</span>
                      <span className="font-mono text-[10px] uppercase text-sky-400 shrink-0">{sig.signal_kind}</span>
                    </div>
                    <p className="text-slate-400 text-[11px]">{sig.summary}</p>
                    <div className="flex items-center justify-between text-[11px] text-slate-500 font-mono">
                      <span>{sig.source_name} · {sig.published_at.slice(0, 10)}</span>
                      <a href={sig.source_url} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-sky-400 hover:underline">
                        <span>Source</span>
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {reports.length > 0 && (
            <div className="rounded-lg border border-slate-800 bg-[#0F141F] p-4 space-y-3 text-xs">
              <h2 className="font-semibold uppercase tracking-wider text-slate-400">Intelligence Briefings (Facts vs Analysis vs Predictions)</h2>
              {reports.slice(0, 2).map((rep) => {
                const facts = JSON.parse(rep.facts_json || '[]') as Array<{ statement: string }>;
                const preds = JSON.parse(rep.predictions_json || '[]') as Array<{ statement: string; confidencePct: number }>;
                return (
                  <div key={rep.id} className="border-t border-slate-800 pt-3 space-y-2">
                    <div className="font-semibold text-slate-100">{rep.title}</div>
                    <div><span className="font-mono text-emerald-400">FACTS ({facts.length}): </span><span className="text-slate-300">{facts[0]?.statement || 'None'}</span></div>
                    <div><span className="font-mono text-sky-400">ANALYSIS: </span><span className="text-slate-300">{rep.analysis}</span></div>
                    <div><span className="font-mono text-amber-400">PREDICTION ({preds[0]?.confidencePct ?? 0}%): </span><span className="text-slate-300">{preds[0]?.statement}</span></div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
