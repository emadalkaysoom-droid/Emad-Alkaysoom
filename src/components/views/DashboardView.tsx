import React, { useEffect, useState } from 'react';
import { ArrowRight, Compass, Cpu, FolderPlus, ShieldAlert } from 'lucide-react';
import { useOmnix } from '../../contexts/OmnixContext';
import type { AgentTask, Project, SubsystemHealth } from '../../types/omnix';

interface DashboardData {
  projects: Project[];
  recentTasks: AgentTask[];
  storageBytes: number;
  fileCount: number;
  usage: { calls: number; totalTokens: number; avgLatencyMs: number };
  pendingApprovals: number;
  health: { overall: string; checks: SubsystemHealth[] };
}

export function DashboardView() {
  const { activeWorkspaceId, setActiveView, setActiveProjectId, t, refreshTick } = useOmnix();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/dashboard?workspaceId=${encodeURIComponent(activeWorkspaceId)}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((json: DashboardData) => {
        if (!cancelled) {
          setData(json);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load dashboard');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeWorkspaceId, refreshTick]);

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  if (loading && !data) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-10 w-64 rounded bg-slate-800/60" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-24 rounded-xl border border-slate-800 bg-[#111724]" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-500/30 bg-red-950/20 p-6 text-sm text-red-300">
        Dashboard load error: {error}
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-800/80 pb-5">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-slate-50">
            OMNIX Operations Overview
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Unified workspace telemetry, multi-agent execution ledger, and subsystem readiness.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => setActiveView('onboarding')}
            className="flex items-center gap-2 rounded-lg border border-sky-500/40 bg-sky-500/10 px-4 py-2 text-xs font-medium text-sky-300 hover:bg-sky-500/20 whitespace-nowrap shrink-0"
          >
            <Compass className="h-3.5 w-3.5" />
            <span>{t('interactive_onboarding')}</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveView('projects')}
            className="flex items-center gap-2 rounded-lg border border-slate-700 bg-[#111724] px-4 py-2 text-xs font-medium text-slate-200 hover:border-slate-600 hover:text-white whitespace-nowrap shrink-0"
          >
            <FolderPlus className="h-3.5 w-3.5" />
            <span>{t('new_project')}</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveView('assistant')}
            className="flex items-center gap-2 rounded-lg bg-sky-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-sky-400 whitespace-nowrap shrink-0"
          >
            <Cpu className="h-3.5 w-3.5" />
            <span>{t('launch_assistant')}</span>
          </button>
        </div>
      </div>

      {/* KPI Summary Row */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-800 bg-[#111724] p-5">
          <p className="text-xs font-medium text-slate-400">{t('active_projects')}</p>
          <p className="mt-2 font-mono text-2xl font-semibold tabular-nums text-slate-100">
            {data?.projects.filter((p) => p.status === 'active').length ?? 0}
          </p>
          <p className="mt-1 text-xs text-slate-500 tabular-nums">
            {data?.projects.length ?? 0} total in workspace
          </p>
        </div>

        <div className="rounded-xl border border-slate-800 bg-[#111724] p-5">
          <p className="text-xs font-medium text-slate-400">{t('storage_used')}</p>
          <p className="mt-2 font-mono text-2xl font-semibold tabular-nums text-slate-100">
            {formatBytes(data?.storageBytes ?? 0)}
          </p>
          <p className="mt-1 text-xs text-slate-500 tabular-nums">
            {data?.fileCount ?? 0} stored file artifact(s)
          </p>
        </div>

        <div className="rounded-xl border border-slate-800 bg-[#111724] p-5">
          <p className="text-xs font-medium text-slate-400">{t('gateway_calls')}</p>
          <p className="mt-2 font-mono text-2xl font-semibold tabular-nums text-slate-100">
            {data?.usage.calls ?? 0}
          </p>
          <p className="mt-1 text-xs text-slate-500 tabular-nums">
            {data?.usage.totalTokens ?? 0} tokens · {data?.usage.avgLatencyMs ?? 0} ms avg
          </p>
        </div>

        <div className="rounded-xl border border-slate-800 bg-[#111724] p-5">
          <p className="text-xs font-medium text-slate-400">{t('system_status')}</p>
          <p
            className={`mt-2 font-mono text-2xl font-semibold ${
              data?.health.overall === 'ONLINE'
                ? 'text-emerald-400'
                : data?.health.overall === 'DEGRADED'
                  ? 'text-amber-400'
                  : 'text-red-400'
            }`}
          >
            {data?.health.overall ?? 'UNKNOWN'}
          </p>
          <button
            type="button"
            onClick={() => setActiveView('health')}
            className="mt-1 text-xs text-sky-400 hover:underline"
          >
            Inspect live diagnostics
          </button>
        </div>
      </div>

      {data && data.pendingApprovals > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-amber-500/35 bg-amber-950/20 px-5 py-3.5 text-sm">
          <div className="flex items-center gap-3 text-amber-200">
            <ShieldAlert className="h-4 w-4 shrink-0 text-amber-400" />
            <span>
              <strong className="font-mono tabular-nums">{data.pendingApprovals}</strong> sensitive
              operation(s) awaiting explicit authorization in OMNI SECURITY.
            </span>
          </div>
          <button
            type="button"
            onClick={() => setActiveView('security')}
            className="rounded-lg bg-amber-500/20 px-3 py-1.5 text-xs font-semibold text-amber-200 hover:bg-amber-500/30 whitespace-nowrap"
          >
            Review Approvals
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Active Projects List */}
        <section className="lg:col-span-5 rounded-xl border border-slate-800 bg-[#111724] p-5">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800/80">
            <h2 className="font-display text-base font-semibold text-slate-100">
              {t('active_projects')}
            </h2>
            <button
              type="button"
              onClick={() => setActiveView('projects')}
              className="text-xs text-sky-400 hover:text-sky-300"
            >
              Manage all
            </button>
          </div>
          <div className="mt-3 divide-y divide-slate-800/70">
            {data?.projects.length === 0 ? (
              <p className="py-6 text-sm text-slate-500">{t('no_data')}</p>
            ) : (
              data?.projects.slice(0, 5).map((proj) => (
                <div key={proj.id} className="py-3 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <button
                      type="button"
                      onClick={() => {
                        setActiveProjectId(proj.id);
                        setActiveView('projects');
                      }}
                      className="text-sm font-medium text-slate-100 hover:text-sky-400 text-start truncate block"
                    >
                      {proj.name}
                    </button>
                    <p className="mt-0.5 text-xs text-slate-400 line-clamp-1">{proj.description}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {proj.category} · {proj.status} · {proj.updated_at.slice(0, 10)}
                    </p>
                  </div>
                  <button
                    type="button"
                    aria-label={`Open ${proj.name}`}
                    onClick={() => {
                      setActiveProjectId(proj.id);
                      setActiveView('assistant');
                    }}
                    className="rounded-md p-1.5 text-slate-400 hover:bg-slate-800 hover:text-sky-400 shrink-0"
                  >
                    <ArrowRight className="h-4 w-4" />
                  </button>
                </div>
              ))
            )}
          </div>
        </section>

        {/* Recent Agent Tasks */}
        <section className="lg:col-span-7 rounded-xl border border-slate-800 bg-[#111724] p-5">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800/80">
            <h2 className="font-display text-base font-semibold text-slate-100">
              {t('running_tasks')}
            </h2>
            <button
              type="button"
              onClick={() => setActiveView('agents')}
              className="text-xs text-sky-400 hover:text-sky-300"
            >
              Agent Console
            </button>
          </div>
          <div className="mt-3 overflow-x-auto">
            {data?.recentTasks.length === 0 ? (
              <p className="py-6 text-sm text-slate-500">
                No agent tasks recorded yet. Execute a directive in OMNI BRAIN to inspect live workflows.
              </p>
            ) : (
              <table className="w-full text-start text-xs">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400">
                    <th className="py-2 pe-3 text-start font-medium">Task</th>
                    <th className="py-2 pe-3 text-start font-medium">Agent</th>
                    <th className="py-2 pe-3 text-start font-medium">Status</th>
                    <th className="py-2 text-end font-medium">Timestamp</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {data?.recentTasks.slice(0, 7).map((task) => (
                    <tr key={task.id} className="hover:bg-slate-800/30">
                      <td className="py-2.5 pe-3 text-slate-200 max-w-[240px] truncate">
                        {task.title}
                      </td>
                      <td className="py-2.5 pe-3 text-slate-400 whitespace-nowrap">
                        {task.agent_name || task.agent_id}
                      </td>
                      <td className="py-2.5 pe-3 whitespace-nowrap font-mono">
                        <span
                          className={
                            task.status === 'completed'
                              ? 'text-emerald-400'
                              : task.status === 'awaiting_approval'
                                ? 'text-amber-400'
                                : task.status === 'failed'
                                  ? 'text-red-400'
                                  : 'text-sky-400'
                          }
                        >
                          {task.status}
                        </span>
                      </td>
                      <td className="py-2.5 text-end font-mono tabular-nums text-slate-500 whitespace-nowrap">
                        {task.created_at.slice(11, 19)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
      </div>

      {/* Live Subsystem Readiness Strip */}
      <section className="rounded-xl border border-slate-800 bg-[#111724] p-5">
        <div className="flex items-center justify-between pb-3 border-b border-slate-800/80">
          <h2 className="font-display text-base font-semibold text-slate-100">
            Subsystem Diagnostics
          </h2>
          <span className="text-xs text-slate-500">Live server-side probe results</span>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {data?.health.checks.map((chk) => (
            <div
              key={chk.id}
              className="rounded-lg border border-slate-800/80 bg-[#0B0F17] p-3.5 text-xs"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-slate-200 truncate">{chk.name}</span>
                <span
                  className={`font-mono font-semibold shrink-0 ${
                    chk.status === 'ONLINE'
                      ? 'text-emerald-400'
                      : chk.status === 'NOT CONFIGURED' || chk.status === 'DEGRADED'
                        ? 'text-amber-400'
                        : 'text-red-400'
                  }`}
                >
                  {chk.status}
                </span>
              </div>
              <p className="mt-1.5 text-slate-400 line-clamp-2">{chk.detail}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
