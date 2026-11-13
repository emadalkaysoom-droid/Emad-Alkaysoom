import React, { useEffect, useState } from 'react';
import { FolderPlus, MessageSquare, Trash2, Upload } from 'lucide-react';
import { useOmnix } from '../../contexts/OmnixContext';
import type { AgentTask, Project } from '../../types/omnix';

interface ProjectDetails {
  project: Project;
  files: Array<{ id: string; name: string; mime_type: string; size_bytes: number; created_at: string }>;
  tasks: AgentTask[];
  reports: Array<{ id: string; title: string; format: string; created_at: string }>;
  assets3d: Array<{ id: string; name: string; prompt: string; created_at: string }>;
  conversations: Array<{ id: string; title: string; updated_at: string }>;
}

export function ProjectsView() {
  const {
    activeWorkspaceId,
    activeProjectId,
    setActiveProjectId,
    setActiveConversationId,
    setActiveView,
    triggerRefresh,
    refreshTick,
  } = useOmnix();

  const [projects, setProjects] = useState<Project[]>([]);
  const [details, setDetails] = useState<ProjectDetails | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('engineering');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/projects?workspaceId=${encodeURIComponent(activeWorkspaceId)}`)
      .then((r) => r.json())
      .then((d) => {
        const list = d.projects || [];
        setProjects(list);
        if (!activeProjectId && list.length > 0) {
          setActiveProjectId(list[0].id);
        }
      })
      .catch(() => {});
  }, [activeWorkspaceId, refreshTick, activeProjectId, setActiveProjectId]);

  useEffect(() => {
    if (!activeProjectId) {
      setDetails(null);
      return;
    }
    fetch(`/api/projects/${encodeURIComponent(activeProjectId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setDetails(d))
      .catch(() => {});
  }, [activeProjectId, refreshTick]);

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspaceId: activeWorkspaceId,
        name: name.trim(),
        description: description.trim(),
        category,
      }),
    });
    const data = await res.json();
    if (res.ok) {
      setName('');
      setDescription('');
      setActiveProjectId(data.project.id);
      setStatusMessage(`Created project "${data.project.name}".`);
      triggerRefresh();
    } else {
      setStatusMessage(data.error || 'Could not create project.');
    }
  };

  const handleDeleteProject = async (id: string) => {
    const res = await fetch(
      `/api/projects/${encodeURIComponent(id)}?workspaceId=${encodeURIComponent(activeWorkspaceId)}`,
      { method: 'DELETE' }
    );
    const data = await res.json();
    if (data.approvalRequired) {
      setStatusMessage(
        `Approval ticket ${data.approvalId} created. Authorize deletion in OMNI SECURITY.`
      );
      triggerRefresh();
    }
  };

  const handleUploadProjectFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activeProjectId) return;
    const text = await file.text();
    const res = await fetch('/api/files', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspaceId: activeWorkspaceId,
        projectId: activeProjectId,
        name: file.name,
        mimeType: file.type || 'text/plain',
        contentText: text,
      }),
    });
    if (res.ok) {
      setStatusMessage(`Uploaded "${file.name}" to project.`);
      triggerRefresh();
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-800/80 pb-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-50">
            OMNI WORKSPACE — Unified Projects
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Manage project contexts, attached files, AI conversations, 3D assets, and compiled reports.
          </p>
        </div>
      </div>

      {statusMessage && (
        <div className="rounded-lg border border-sky-500/30 bg-sky-950/25 px-4 py-2.5 text-xs text-sky-200">
          {statusMessage}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Create + List */}
        <div className="lg:col-span-4 space-y-5">
          <form
            onSubmit={(e) => void handleCreateProject(e)}
            className="rounded-xl border border-slate-800 bg-[#111724] p-4 space-y-3"
          >
            <h2 className="font-display text-sm font-semibold text-slate-100">Create Project</h2>
            <div>
              <label htmlFor="proj-name" className="block text-xs text-slate-400 mb-1">
                Project Name
              </label>
              <input
                id="proj-name"
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Autonomous Drone Telemetry"
                className="w-full rounded-lg border border-slate-800 bg-[#0B0F17] px-3 py-2 text-xs text-slate-100"
              />
            </div>
            <div>
              <label htmlFor="proj-cat" className="block text-xs text-slate-400 mb-1">
                Category
              </label>
              <select
                id="proj-cat"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full rounded-lg border border-slate-800 bg-[#0B0F17] px-3 py-2 text-xs text-slate-100"
              >
                <option value="engineering">Engineering</option>
                <option value="data-intelligence">Data Intelligence</option>
                <option value="3d-simulation">3D & Simulation</option>
                <option value="research">Research</option>
              </select>
            </div>
            <div>
              <label htmlFor="proj-desc" className="block text-xs text-slate-400 mb-1">
                Description
              </label>
              <textarea
                id="proj-desc"
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Scope, goals, and workspace context..."
                className="w-full rounded-lg border border-slate-800 bg-[#0B0F17] px-3 py-2 text-xs text-slate-100"
              />
            </div>
            <button
              type="submit"
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-sky-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-sky-400"
            >
              <FolderPlus className="h-3.5 w-3.5" />
              <span>Create Project</span>
            </button>
          </form>

          <div className="rounded-xl border border-slate-800 bg-[#111724] p-4 space-y-2">
            <h2 className="font-display text-sm font-semibold text-slate-100 pb-2 border-b border-slate-800">
              Workspace Projects ({projects.length})
            </h2>
            {projects.map((p) => (
              <div
                key={p.id}
                className={`flex items-center justify-between rounded-lg px-3 py-2.5 text-xs ${
                  activeProjectId === p.id
                    ? 'bg-sky-500/15 border border-sky-500/30 text-sky-100'
                    : 'bg-[#0B0F17] text-slate-300 hover:bg-slate-800/60'
                }`}
              >
                <button
                  type="button"
                  onClick={() => setActiveProjectId(p.id)}
                  className="text-start flex-1 min-w-0 truncate font-medium"
                >
                  {p.name}
                </button>
                <button
                  type="button"
                  aria-label={`Request deletion of ${p.name}`}
                  onClick={() => void handleDeleteProject(p.id)}
                  className="ms-2 p-1 text-slate-500 hover:text-red-400"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Selected Project Workspace */}
        <div className="lg:col-span-8 rounded-xl border border-slate-800 bg-[#111724] p-5 space-y-6">
          {!details ? (
            <p className="text-sm text-slate-400">Select or create a project to inspect its context.</p>
          ) : (
            <>
              <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-800 pb-4">
                <div>
                  <h2 className="font-display text-lg font-bold text-slate-50">
                    {details.project.name}
                  </h2>
                  <p className="mt-1 text-xs text-slate-400">{details.project.description}</p>
                  <p className="mt-1.5 text-xs text-slate-500">
                    {details.project.category} · {details.project.status} · Updated{' '}
                    {details.project.updated_at}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <label className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-700 bg-[#0B0F17] px-3 py-2 text-xs font-medium text-slate-200 hover:border-slate-600">
                    <Upload className="h-3.5 w-3.5" />
                    <span>Upload File</span>
                    <input
                      type="file"
                      className="hidden"
                      onChange={(e) => void handleUploadProjectFile(e)}
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      setActiveConversationId(details.conversations[0]?.id ?? null);
                      setActiveView('assistant');
                    }}
                    className="flex items-center gap-1.5 rounded-lg bg-sky-500 px-3 py-2 text-xs font-semibold text-slate-950 hover:bg-sky-400"
                  >
                    <MessageSquare className="h-3.5 w-3.5" />
                    <span>Open Project Chat</span>
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                <div>
                  <h3 className="text-xs font-semibold text-slate-300 mb-2">
                    Project Files ({details.files.length})
                  </h3>
                  <div className="space-y-1.5">
                    {details.files.length === 0 ? (
                      <p className="text-xs text-slate-500">No files attached yet.</p>
                    ) : (
                      details.files.map((f) => (
                        <div
                          key={f.id}
                          className="flex items-center justify-between rounded-lg bg-[#0B0F17] px-3 py-2 text-xs"
                        >
                          <span className="text-slate-200 truncate">{f.name}</span>
                          <span className="font-mono tabular-nums text-slate-500">
                            {f.size_bytes} B
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                <div>
                  <h3 className="text-xs font-semibold text-slate-300 mb-2">
                    3D Assets & Reports ({details.assets3d.length + details.reports.length})
                  </h3>
                  <div className="space-y-1.5">
                    {details.assets3d.map((a) => (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => setActiveView('studio3d')}
                        className="flex w-full items-center justify-between rounded-lg bg-[#0B0F17] px-3 py-2 text-xs text-start hover:bg-slate-800/80"
                      >
                        <span className="text-sky-300 truncate">3D · {a.name}</span>
                        <span className="text-slate-500">Inspect</span>
                      </button>
                    ))}
                    {details.reports.map((r) => (
                      <div
                        key={r.id}
                        className="flex items-center justify-between rounded-lg bg-[#0B0F17] px-3 py-2 text-xs"
                      >
                        <span className="text-emerald-300 truncate">
                          {r.format.toUpperCase()} · {r.title}
                        </span>
                        <span className="font-mono text-slate-500">{r.created_at.slice(0, 10)}</span>
                      </div>
                    ))}
                    {details.assets3d.length === 0 && details.reports.length === 0 && (
                      <p className="text-xs text-slate-500">No generated assets or reports yet.</p>
                    )}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
