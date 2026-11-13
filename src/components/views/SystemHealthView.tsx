import React, { useEffect, useState } from 'react';
import { Play, RefreshCw } from 'lucide-react';
import type { SubsystemHealth } from '../../types/omnix';

export function SystemHealthView() {
  const [overall, setOverall] = useState<string>('CHECKING');
  const [checks, setChecks] = useState<SubsystemHealth[]>([]);
  const [testResult, setTestResult] = useState<{ passed: boolean; output: string; stderr: string } | null>(null);
  const [runningTests, setRunningTests] = useState(false);
  const [statusDoc, setStatusDoc] = useState('');

  const refreshHealth = async () => {
    const res = await fetch('/api/health');
    if (res.ok) {
      const d = await res.json();
      setOverall(d.overall);
      setChecks(d.checks || []);
    }
  };

  useEffect(() => {
    void refreshHealth();
    fetch('/api/status-doc')
      .then((r) => r.json())
      .then((d) => setStatusDoc(d.content || ''))
      .catch(() => {});
  }, []);

  const runSuite = async () => {
    setRunningTests(true);
    try {
      const res = await fetch('/api/tests/run', { method: 'POST' });
      const data = await res.json();
      setTestResult(data);
    } finally {
      setRunningTests(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-800/80 pb-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-50">
            System Health & Live Verification Suite
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Authentic subsystem readiness probes and live Node test suite execution.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void refreshHealth()}
            className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-[#111724] px-3.5 py-2 text-xs font-medium text-slate-200 hover:border-slate-500"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span>Re-run Probes</span>
          </button>
          <button
            type="button"
            disabled={runningTests}
            onClick={() => void runSuite()}
            className="flex items-center gap-1.5 rounded-lg bg-sky-500 px-3.5 py-2 text-xs font-semibold text-slate-950 hover:bg-sky-400 disabled:opacity-40"
          >
            <Play className="h-3.5 w-3.5" />
            <span>{runningTests ? 'Running Tests...' : 'Execute Unit Test Suite'}</span>
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-slate-800 bg-[#111724] p-5">
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <h2 className="font-display text-sm font-semibold text-slate-100">
            Overall Platform Status
          </h2>
          <span
            className={`font-mono text-sm font-bold ${
              overall === 'ONLINE'
                ? 'text-emerald-400'
                : overall === 'DEGRADED'
                  ? 'text-amber-400'
                  : 'text-red-400'
            }`}
          >
            {overall}
          </span>
        </div>

        <div className="mt-4 md:hidden space-y-3">
          {checks.map((c) => (
            <div key={c.id} className="rounded-lg border border-slate-800/80 bg-[#0B0F17] p-3.5 space-y-1.5 text-xs">
              <div className="flex items-start justify-between gap-2">
                <span className="font-medium text-slate-100">{c.name}</span>
                <span
                  className={`font-mono font-semibold whitespace-nowrap shrink-0 ${
                    c.status === 'ONLINE'
                      ? 'text-emerald-400'
                      : c.status === 'NOT CONFIGURED' || c.status === 'DEGRADED'
                        ? 'text-amber-400'
                        : 'text-red-400'
                  }`}
                >
                  {c.status}
                </span>
              </div>
              <div className="flex items-center justify-between text-[11px] text-slate-400">
                <span>{c.layer}</span>
                <span className="font-mono tabular-nums">{c.latencyMs} ms</span>
              </div>
              <p className="text-slate-400 leading-relaxed">{c.detail}</p>
            </div>
          ))}
        </div>

        <div className="mt-4 hidden md:block overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400">
                <th className="py-2 text-start">Subsystem</th>
                <th className="py-2 text-start">Architecture Layer</th>
                <th className="py-2 text-start">Status</th>
                <th className="py-2 text-end">Latency</th>
                <th className="py-2 ps-4 text-start">Diagnostic Output</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {checks.map((c) => (
                <tr key={c.id}>
                  <td className="py-2.5 font-medium text-slate-100 whitespace-nowrap">{c.name}</td>
                  <td className="py-2.5 text-slate-400 whitespace-nowrap">{c.layer}</td>
                  <td className="py-2.5 font-mono font-semibold whitespace-nowrap">
                    <span
                      className={
                        c.status === 'ONLINE'
                          ? 'text-emerald-400'
                          : c.status === 'NOT CONFIGURED' || c.status === 'DEGRADED'
                            ? 'text-amber-400'
                            : 'text-red-400'
                      }
                    >
                      {c.status}
                    </span>
                  </td>
                  <td className="py-2.5 text-end font-mono tabular-nums text-slate-300">
                    {c.latencyMs} ms
                  </td>
                  <td className="py-2.5 ps-4 text-slate-400">{c.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {testResult && (
        <div className="rounded-xl border border-slate-800 bg-[#111724] p-5 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-slate-200">Automated Test Runner Output</span>
            <span className={`font-mono font-bold ${testResult.passed ? 'text-emerald-400' : 'text-red-400'}`}>
              {testResult.passed ? 'PASSED' : 'FAILED'}
            </span>
          </div>
          <pre className="max-h-64 overflow-auto rounded-lg bg-[#0B0F17] p-3 font-mono text-[11px] text-slate-300">
            {testResult.output || testResult.stderr}
          </pre>
        </div>
      )}

      {statusDoc && (
        <div className="rounded-xl border border-slate-800 bg-[#111724] p-5 space-y-2">
          <h2 className="font-display text-sm font-semibold text-slate-100">
            OMNIX_IMPLEMENTATION_STATUS.md
          </h2>
          <pre className="max-h-80 overflow-auto rounded-lg bg-[#0B0F17] p-4 font-mono text-xs text-slate-300 whitespace-pre-wrap">
            {statusDoc}
          </pre>
        </div>
      )}
    </div>
  );
}
