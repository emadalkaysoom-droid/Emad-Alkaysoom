import React, { useEffect, useState } from 'react';
import { BarChart3, Download, FileSpreadsheet, Sparkles } from 'lucide-react';
import { useOmnix } from '../../contexts/OmnixContext';
import type { DataRow, DatasetAnalysis, NLDataQueryResult } from '../../../shared/dataEngine';

interface StoredFile {
  id: string;
  name: string;
  mime_type: string;
  size_bytes: number;
}

export function DataStudioView() {
  const { activeWorkspaceId, activeProjectId } = useOmnix();
  const [files, setFiles] = useState<StoredFile[]>([]);
  const [datasetName, setDatasetName] = useState('');
  const [rows, setRows] = useState<DataRow[]>([]);
  const [analysis, setAnalysis] = useState<DatasetAnalysis | null>(null);
  const [nlQuery, setNlQuery] = useState('Analyze this data, identify top 5 values, and plot a chart');
  const [nlResult, setNlResult] = useState<NLDataQueryResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/files?workspaceId=${encodeURIComponent(activeWorkspaceId)}`)
      .then((r) => r.json())
      .then((d) => {
        const list = d.files || [];
        setFiles(list);
        if (list.length > 0 && rows.length === 0) {
          void loadWorkspaceFile(list[0].id);
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWorkspaceId]);

  const loadWorkspaceFile = async (fileId: string) => {
    setError(null);
    const res = await fetch('/api/data/parse-and-analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileId }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || 'Failed to parse file');
      return;
    }
    setDatasetName(data.fileName);
    setRows(data.rows || []);
    setAnalysis(data.analysis);
    setNlResult(null);
  };

  const handleLocalUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);

    const isBinaryXlsx = /\.xlsx?$/i.test(file.name);
    let payload: Record<string, string> = {
      fileName: file.name,
      mimeType: file.type || 'text/csv',
    };

    if (isBinaryXlsx) {
      const buf = await file.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let binary = '';
      for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
      payload.base64Buffer = btoa(binary);
    } else {
      payload.contentText = await file.text();
    }

    const res = await fetch('/api/data/parse-and-analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || 'Upload parse failed');
      return;
    }
    setDatasetName(data.fileName);
    setRows(data.rows || []);
    setAnalysis(data.analysis);
    setNlResult(null);
  };

  const runNLQuery = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nlQuery.trim() || rows.length === 0) return;
    const res = await fetch('/api/data/nl-query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: nlQuery.trim(), rows }),
    });
    const data = await res.json();
    if (res.ok) {
      setNlResult(data.result);
    }
  };

  const exportReport = async (format: 'pdf' | 'docx' | 'xlsx' | 'csv' | 'html') => {
    if (!analysis) return;
    const sections = [
      {
        heading: 'Descriptive Statistics',
        body: analysis.stats
          .map((s) =>
            s.type === 'numeric'
              ? `${s.column}: Mean=${s.mean}, Median=${s.median}, Min=${s.min}, Max=${s.max}, StdDev=${s.stdDev}`
              : `${s.column}: ${s.uniqueValues} categories`
          )
          .join('\n'),
      },
      {
        heading: 'Detected Anomalies (|Z| >= 2.0)',
        body:
          analysis.anomalies.length > 0
            ? analysis.anomalies
                .map((a) => `Row ${a.rowIndex + 1} (${a.column}): ${a.value} (Z=${a.zScore})`)
                .join('\n')
            : 'No significant outliers detected.',
      },
      ...(nlResult ? [{ heading: 'Natural Language Query Summary', body: nlResult.summary }] : []),
    ];

    const res = await fetch('/api/reports/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspaceId: activeWorkspaceId,
        projectId: activeProjectId,
        title: `Data Intelligence Report — ${datasetName || 'Dataset'}`,
        format,
        summary: `Analyzed ${analysis.rowCount} rows across ${analysis.columnCount} columns.`,
        sections,
        tableRows: rows,
      }),
    });

    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `omnix-data-report.${format}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const chartPoints =
    nlResult?.chartSeries ??
    (analysis && rows.length > 0
      ? (() => {
          const numCol = analysis.stats.find((s) => s.type === 'numeric')?.column;
          if (!numCol) return [];
          return rows.slice(0, 20).map((r, i) => ({
            label: String(r[analysis.columns[0]] ?? `#${i + 1}`),
            value: Number(r[numCol]) || 0,
          }));
        })()
      : []);

  const maxChartVal = Math.max(1, ...chartPoints.map((p) => Math.abs(p.value)));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-800/80 pb-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-50">
            OMNI DATA — Statistical Intelligence & Report Compiler
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Parse CSV, XLSX, JSON, and XML datasets, detect Z-score anomalies, run linear trend
            forecasts, and compile downloadable reports.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="flex cursor-pointer items-center gap-2 rounded-lg bg-sky-500 px-3.5 py-2 text-xs font-semibold text-slate-950 hover:bg-sky-400">
            <FileSpreadsheet className="h-3.5 w-3.5" />
            <span>Upload CSV / XLSX / JSON / XML</span>
            <input
              type="file"
              accept=".csv,.xlsx,.xls,.json,.xml"
              className="hidden"
              onChange={(e) => void handleLocalUpload(e)}
            />
          </label>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/40 bg-red-950/20 px-4 py-2.5 text-xs text-red-300">
          {error}
        </div>
      )}

      {/* Workspace Files Quick Load + Report Exports */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800 bg-[#111724] px-4 py-3">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-slate-400">Workspace Datasets:</span>
          {files.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => void loadWorkspaceFile(f.id)}
              className={`rounded-md px-2.5 py-1 font-medium transition-colors ${
                datasetName === f.name
                  ? 'bg-sky-500/20 text-sky-300 border border-sky-500/30'
                  : 'bg-[#0B0F17] text-slate-300 hover:text-white'
              }`}
            >
              {f.name}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {(['pdf', 'docx', 'xlsx', 'csv', 'html'] as const).map((fmt) => (
            <button
              key={fmt}
              type="button"
              disabled={!analysis}
              onClick={() => void exportReport(fmt)}
              className="flex items-center gap-1 rounded-md border border-slate-700 bg-[#0B0F17] px-2.5 py-1.5 text-xs font-mono uppercase text-slate-200 hover:border-slate-500 disabled:opacity-40"
            >
              <Download className="h-3 w-3 text-emerald-400" />
              <span>{fmt}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Natural Language Data Query */}
      <form onSubmit={(e) => void runNLQuery(e)} className="flex gap-2">
        <input
          type="text"
          value={nlQuery}
          onChange={(e) => setNlQuery(e.target.value)}
          placeholder="Ask in English or Arabic: e.g. 'Analyze this data, identify top 5 values, and plot a chart'"
          aria-label="Natural language data analysis query"
          className="flex-1 rounded-lg border border-slate-800 bg-[#111724] px-4 py-2.5 text-xs text-slate-100"
        />
        <button
          type="submit"
          disabled={rows.length === 0}
          className="flex items-center gap-1.5 rounded-lg bg-sky-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-sky-400 disabled:opacity-40 whitespace-nowrap"
        >
          <Sparkles className="h-3.5 w-3.5" />
          <span>Run NL Analysis</span>
        </button>
      </form>

      {nlResult && (
        <div className="rounded-xl border border-sky-500/30 bg-sky-950/15 p-4 text-xs text-slate-100">
          <p className="font-semibold text-sky-300 mb-1">Natural Language Analysis Result</p>
          <p>{nlResult.summary}</p>
        </div>
      )}

      {analysis && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* Interactive Bar Visualization */}
          <div className="lg:col-span-6 rounded-xl border border-slate-800 bg-[#111724] p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-sm font-semibold text-slate-100 flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-sky-400" />
                <span>Series Visualization ({nlResult?.focusColumn || analysis.stats.find((s) => s.type === 'numeric')?.column || 'Values'})</span>
              </h2>
              <span className="font-mono text-xs tabular-nums text-slate-400">
                {analysis.rowCount} rows
              </span>
            </div>
            <div className="flex h-52 items-end gap-1.5 rounded-lg border border-slate-800 bg-[#0B0F17] p-4">
              {chartPoints.map((pt, idx) => {
                const pct = Math.max(6, Math.round((Math.abs(pt.value) / maxChartVal) * 100));
                const isForecast = pt.label.startsWith('Forecast');
                return (
                  <div key={idx} className="flex-1 flex flex-col items-center justify-end h-full min-w-0">
                    <div
                      title={`${pt.label}: ${pt.value}`}
                      style={{ height: `${pct}%` }}
                      className={`w-full rounded-t transition-all ${
                        isForecast ? 'bg-amber-400/80' : 'bg-sky-500/80 hover:bg-sky-400'
                      }`}
                    />
                    <span className="mt-1.5 text-[10px] font-mono text-slate-500 truncate w-full text-center">
                      {(pt.label.includes('T') ? pt.label.split('T')[1] : pt.label).slice(0, 8)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Statistical Summary & Anomalies */}
          <div className="lg:col-span-6 rounded-xl border border-slate-800 bg-[#111724] p-5 space-y-4">
            <h2 className="font-display text-sm font-semibold text-slate-100">
              Descriptive Statistics & Anomalies
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400">
                    <th className="py-2 text-start">Column</th>
                    <th className="py-2 text-end">Mean</th>
                    <th className="py-2 text-end">Median</th>
                    <th className="py-2 text-end">Min / Max</th>
                    <th className="py-2 text-end">StdDev</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70 font-mono tabular-nums">
                  {analysis.stats
                    .filter((s) => s.type === 'numeric')
                    .map((s) => (
                      <tr key={s.column}>
                        <td className="py-2 text-slate-200 font-sans">{s.column}</td>
                        <td className="py-2 text-end text-slate-300">{s.mean}</td>
                        <td className="py-2 text-end text-slate-300">{s.median}</td>
                        <td className="py-2 text-end text-slate-400">
                          {s.min} / {s.max}
                        </td>
                        <td className="py-2 text-end text-slate-300">{s.stdDev}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>

            {analysis.anomalies.length > 0 && (
              <div className="pt-2 border-t border-slate-800">
                <p className="text-xs font-semibold text-amber-400 mb-1.5">
                  Outliers Detected ({analysis.anomalies.length})
                </p>
                <div className="space-y-1 text-xs font-mono tabular-nums text-slate-300">
                  {analysis.anomalies.slice(0, 5).map((a, idx) => (
                    <div key={idx}>
                      Row {a.rowIndex + 1} · {a.column} = {a.value} (Z={a.zScore})
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Data Preview Grid */}
          <div className="lg:col-span-12 rounded-xl border border-slate-800 bg-[#111724] p-5">
            <h2 className="font-display text-sm font-semibold text-slate-100 mb-3">
              Structured Table Preview ({rows.length} rows)
            </h2>
            <div className="overflow-x-auto max-h-64">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400">
                    {analysis.columns.map((c) => (
                      <th key={c} className="py-2 px-2.5 text-start font-medium whitespace-nowrap">
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 tabular-nums">
                  {rows.slice(0, 25).map((r, i) => (
                    <tr key={i} className="hover:bg-slate-800/30">
                      {analysis.columns.map((c) => (
                        <td key={c} className="py-2 px-2.5 text-slate-300 whitespace-nowrap font-mono">
                          {String(r[c] ?? '')}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
