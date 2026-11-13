import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Download, Hammer, Monitor, Smartphone, Tablet, Wand2 } from 'lucide-react';
import { useOmnix } from '../../contexts/OmnixContext';
import { apiFetch, getAuthHeaders } from '../../lib/apiClient';
import type { AutoBuildBlueprint } from '../../../shared/autobuildEngine';

export function AutoBuildView() {
  const { activeWorkspaceId, language, hasEntitlement, setActiveView } = useOmnix();
  const isAr = language === 'ar';

  const [prompt, setPrompt] = useState('أنشئ تطبيقاً لإدارة شركة هندسية');
  const [editPrompt, setEditPrompt] = useState('غير لون الواجهة إلى الأزرق وأضف نظاماً لإدارة الموظفين');
  const [projects, setProjects] = useState<Array<{ id: string; name: string; category: string; revision: number; blueprint_json: string }>>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [blueprint, setBlueprint] = useState<AutoBuildBlueprint | null>(null);
  const [viewport, setViewport] = useState<'desktop' | 'tablet' | 'mobile'>('desktop');
  const [activeTab, setActiveTab] = useState<'preview' | 'architecture' | 'files'>('preview');
  const [editNotes, setEditNotes] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadProjects = useCallback(async () => {
    const res = await apiFetch(`/api/autobuild/projects?workspaceId=${encodeURIComponent(activeWorkspaceId)}`);
    if (res.ok) {
      const data = await res.json();
      const list = (data.projects || []) as typeof projects;
      setProjects(list);
      if (list.length > 0 && !activeProjectId) {
        setActiveProjectId(list[0].id);
        setBlueprint(JSON.parse(list[0].blueprint_json) as AutoBuildBlueprint);
      }
    }
  }, [activeWorkspaceId, activeProjectId]);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  const buildNewApp = async () => {
    setLoading(true);
    setError(null);
    setEditNotes([]);
    try {
      const res = await apiFetch('/api/autobuild/build', {
        method: 'POST',
        body: JSON.stringify({ workspaceId: activeWorkspaceId, prompt }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'AutoBuild requires OMNIX PREMIUM');
      setActiveProjectId(data.projectId);
      setBlueprint(data.blueprint);
      void loadProjects();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Build failed');
    } finally {
      setLoading(false);
    }
  };

  const applyLiveEdit = async () => {
    if (!activeProjectId || !editPrompt.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/autobuild/${encodeURIComponent(activeProjectId)}/edit`, {
        method: 'POST',
        body: JSON.stringify({ instruction: editPrompt }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Live edit failed');
      setBlueprint(data.blueprint);
      setEditNotes(data.appliedChanges || []);
      void loadProjects();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Live edit error');
    } finally {
      setLoading(false);
    }
  };

  const downloadZip = async () => {
    if (!activeProjectId) return;
    const res = await fetch(`/api/autobuild/${encodeURIComponent(activeProjectId)}/export`, {
      headers: getAuthHeaders(),
    });
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(blueprint?.appName || 'omnix-app').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.zip`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const previewWidthClass =
    viewport === 'mobile' ? 'max-w-[390px]' : viewport === 'tablet' ? 'max-w-[768px]' : 'w-full';

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-4">
        <div>
          <h1 className="font-display text-xl font-bold text-slate-100 flex items-center gap-2">
            <Hammer className="h-5 w-5 text-sky-400" />
            <span>OMNI AUTOBUILD · {isAr ? 'مصنع بناء التطبيقات والبرمجيات المستقل' : 'Autonomous Application Factory'}</span>
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            {isAr
              ? 'تحويل الوصف إلى تطبيق متكامل عبر فريق 10 وكلاء، معاينة حية تفاعلية، تعديل سياقي مباشر، وفحص جودة قبل التصدير ZIP.'
              : 'NL-to-App via 10-role Multi-Agent team · Live interactive responsive preview · Contextual live edits · Automated QC & ZIP export.'}
          </p>
        </div>

        {!hasEntitlement('OMNI_AUTOBUILD_FACTORY') && (
          <button
            type="button"
            onClick={() => setActiveView('billing')}
            className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-300"
          >
            {isAr ? 'ترقية لفتح مصنع التطبيقات المستقل' : 'Unlock AutoBuild Factory ($5/3mo)'}
          </button>
        )}
      </div>

      {error && (
        <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-4 py-2 text-xs text-rose-200">{error}</div>
      )}

      <div className="rounded-lg border border-slate-800 bg-[#0F141F] p-4 space-y-3">
        <div className="flex flex-wrap gap-2">
          <input
            type="text"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={isAr ? 'صف التطبيق الذي تريد بناءه بالكامل...' : 'Describe the application to synthesize...'}
            className="flex-1 min-w-[260px] rounded-md border border-slate-800 bg-[#0B0F17] px-3 py-2 text-xs text-slate-100 focus:border-sky-500 focus:outline-none"
          />
          <button
            type="button"
            onClick={() => void buildNewApp()}
            disabled={loading}
            className="flex items-center gap-1.5 rounded-md bg-sky-600 px-4 py-2 text-xs font-semibold text-white hover:bg-sky-500 disabled:opacity-50"
          >
            <Wand2 className="h-3.5 w-3.5" />
            <span>{isAr ? 'بناء التطبيق بالكامل' : 'Build Full-Stack App'}</span>
          </button>
          {activeProjectId && (
            <button
              type="button"
              onClick={() => void downloadZip()}
              className="flex items-center gap-1.5 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3.5 py-2 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/20"
            >
              <Download className="h-3.5 w-3.5" />
              <span>Export ZIP</span>
            </button>
          )}
        </div>

        {projects.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 text-xs pt-1">
            <span className="text-slate-400">Built Apps:</span>
            {projects.slice(0, 6).map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  setActiveProjectId(p.id);
                  setBlueprint(JSON.parse(p.blueprint_json) as AutoBuildBlueprint);
                }}
                className={`rounded px-2.5 py-1 font-mono text-[11px] ${
                  activeProjectId === p.id ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40' : 'bg-slate-900 text-slate-400 border border-slate-800'
                }`}
              >
                {p.name} (v{p.revision})
              </button>
            ))}
          </div>
        )}
      </div>

      {blueprint && (
        <div className="space-y-4">
          {/* Live Edit Bar */}
          <div className="rounded-lg border border-slate-800 bg-[#0F141F] p-3 flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={editPrompt}
              onChange={(e) => setEditPrompt(e.target.value)}
              placeholder={isAr ? 'تعديل مباشر على التطبيق الحالي (مثال: غير لون الواجهة إلى الأزرق)...' : 'Live Edit current app (e.g. Change UI color to blue and add HR module)...'}
              className="flex-1 min-w-[240px] rounded border border-slate-800 bg-[#0B0F17] px-3 py-1.5 text-xs text-slate-100"
            />
            <button
              type="button"
              onClick={() => void applyLiveEdit()}
              disabled={loading}
              className="rounded border border-sky-500/40 bg-sky-500/15 px-3.5 py-1.5 text-xs font-semibold text-sky-300 hover:bg-sky-500/25"
            >
              {isAr ? 'تطبيق التعديل المباشر' : 'Apply Live Edit'}
            </button>
            {editNotes.length > 0 && (
              <span className="text-[11px] text-emerald-300">{editNotes.join(' · ')}</span>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex rounded-md border border-slate-800 bg-[#0F141F] p-0.5 text-xs">
              {([
                ['preview', isAr ? 'المعاينة الحية' : 'Live Interactive Preview'],
                ['architecture', isAr ? 'فريق الوكلاء والبنية' : '10-Agent Pipeline & QC'],
                ['files', isAr ? 'ملفات المشروع المولدة' : 'Generated Source Files'],
              ] as const).map(([id, lbl]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setActiveTab(id)}
                  className={`rounded px-3 py-1.5 font-medium ${activeTab === id ? 'bg-sky-500/20 text-sky-300' : 'text-slate-400'}`}
                >
                  {lbl}
                </button>
              ))}
            </div>

            {activeTab === 'preview' && (
              <div className="flex items-center gap-1 rounded-md border border-slate-800 bg-[#0F141F] p-0.5">
                <button type="button" aria-label="Desktop preview" onClick={() => setViewport('desktop')} className={`rounded p-1.5 ${viewport === 'desktop' ? 'bg-sky-500/20 text-sky-300' : 'text-slate-400'}`}>
                  <Monitor className="h-3.5 w-3.5" />
                </button>
                <button type="button" aria-label="Tablet preview" onClick={() => setViewport('tablet')} className={`rounded p-1.5 ${viewport === 'tablet' ? 'bg-sky-500/20 text-sky-300' : 'text-slate-400'}`}>
                  <Tablet className="h-3.5 w-3.5" />
                </button>
                <button type="button" aria-label="Mobile preview" onClick={() => setViewport('mobile')} className={`rounded p-1.5 ${viewport === 'mobile' ? 'bg-sky-500/20 text-sky-300' : 'text-slate-400'}`}>
                  <Smartphone className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
          </div>

          {activeTab === 'preview' && (
            <div className="rounded-lg border border-slate-800 bg-[#0B0F17] p-3 flex justify-center">
              <iframe
                data-testid="autobuild-preview-iframe"
                title={blueprint.appName}
                sandbox="allow-scripts allow-forms"
                srcDoc={blueprint.files['index.html'] || ''}
                className={`${previewWidthClass} h-[480px] rounded border border-slate-800 bg-[#090d16] transition-all`}
              />
            </div>
          )}

          {activeTab === 'architecture' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 text-xs">
              <div className="rounded-lg border border-slate-800 bg-[#0F141F] p-4 space-y-2">
                <h2 className="font-semibold text-slate-200 mb-2">Multi-Agent Construction Pipeline</h2>
                <div className="divide-y divide-slate-800/80">
                  {blueprint.pipelineStages.map((s) => (
                    <div key={s.stage} className="py-2">
                      <div className="flex justify-between font-medium text-slate-200">
                        <span>{s.stage}</span>
                        <span className="font-mono text-sky-400">{s.agentRole}</span>
                      </div>
                      <div className="text-[11px] text-slate-400 mt-0.5">{s.artifactSummary}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-lg border border-slate-800 bg-[#0F141F] p-4 space-y-2">
                <h2 className="font-semibold text-slate-200 mb-2">Automated Quality Control Checks</h2>
                <div className="divide-y divide-slate-800/80">
                  {blueprint.qcReport.checks.map((c) => (
                    <div key={c.name} className="py-2 flex items-center justify-between">
                      <div>
                        <div className="text-slate-200 font-medium">{c.name}</div>
                        <div className="text-[11px] text-slate-400">{c.detail}</div>
                      </div>
                      <CheckCircle2 className={`h-4 w-4 ${c.passed ? 'text-emerald-400' : 'text-rose-400'}`} />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'files' && (
            <div className="rounded-lg border border-slate-800 bg-[#0F141F] p-4 space-y-3 text-xs">
              {Object.entries(blueprint.files).map(([fileName, content]) => (
                <details key={fileName} open={fileName === 'db/migrations/001_init.sql'} className="border-b border-slate-800 pb-2">
                  <summary className="cursor-pointer font-mono font-semibold text-sky-300 py-1">{fileName}</summary>
                  <pre className="mt-2 max-h-60 overflow-auto rounded bg-[#0B0F17] p-2.5 font-mono text-[11px] text-slate-300">
                    {content}
                  </pre>
                </details>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
