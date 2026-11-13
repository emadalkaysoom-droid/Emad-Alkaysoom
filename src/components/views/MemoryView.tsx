import React, { useEffect, useState } from 'react';
import { Plus, Search, Trash2 } from 'lucide-react';
import { useOmnix } from '../../contexts/OmnixContext';

import { apiFetch } from '../../lib/apiClient';

interface MemoryEntry {
  id: string;
  scope: 'short_term' | 'long_term';
  title: string;
  content: string;
  source: string;
  tags_json: string;
  created_at: string;
}

interface MemoryRule {
  id: string;
  rule_title: string;
  rule_content: string;
  created_at: string;
}

interface KnowledgeNode {
  id: string;
  node_type: string;
  label: string;
}

interface KnowledgeRelation {
  id: string;
  source_node_id: string;
  target_node_id: string;
  relation_type: string;
}

export function MemoryView() {
  const { activeWorkspaceId, activeProjectId, refreshTick, triggerRefresh } = useOmnix();
  const [tab, setTab] = useState<'long_term' | 'short_term' | 'graph' | 'learn' | 'vault'>('long_term');
  const [entries, setEntries] = useState<MemoryEntry[]>([]);
  const [nodes, setNodes] = useState<KnowledgeNode[]>([]);
  const [relations, setRelations] = useState<KnowledgeRelation[]>([]);
  const [vaultRules, setVaultRules] = useState<MemoryRule[]>([]);
  const [ruleTitle, setRuleTitle] = useState('');
  const [ruleContent, setRuleContent] = useState('');
  const [query, setQuery] = useState('');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [scope, setScope] = useState<'long_term' | 'short_term'>('long_term');
  const [adaptiveOptIn, setAdaptiveOptIn] = useState(true);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const loadMemory = async (search = query) => {
    const res = await fetch(
      `/api/memory?workspaceId=${encodeURIComponent(activeWorkspaceId)}&q=${encodeURIComponent(search)}`
    );
    if (res.ok) {
      const d = await res.json();
      setEntries(d.entries || []);
      setNodes(d.nodes || []);
      setRelations(d.relations || []);
    }
    const vRes = await apiFetch(`/api/memory/vault?workspaceId=${encodeURIComponent(activeWorkspaceId)}`);
    if (vRes.ok) {
      const vd = await vRes.json();
      setVaultRules(vd.rules || []);
    }
  };

  useEffect(() => {
    void loadMemory('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWorkspaceId, refreshTick]);

  const handleSaveMemory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !content.trim()) return;
    const res = await fetch('/api/memory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspaceId: activeWorkspaceId,
        projectId: activeProjectId,
        scope,
        title: title.trim(),
        content: content.trim(),
        tags: ['manual'],
      }),
    });
    if (res.ok) {
      setTitle('');
      setContent('');
      setStatusMsg('Memory persisted and linked into Knowledge Graph.');
      triggerRefresh();
    }
  };

  const handleRequestDelete = async (id: string) => {
    const res = await fetch(
      `/api/memory/${encodeURIComponent(id)}?workspaceId=${encodeURIComponent(activeWorkspaceId)}`,
      { method: 'DELETE' }
    );
    const data = await res.json();
    if (data.approvalRequired) {
      setStatusMsg(
        `Approval ticket ${data.approvalId} created. Authorize deletion in OMNI SECURITY.`
      );
      triggerRefresh();
    }
  };

  const filteredEntries = entries.filter((e) =>
    tab === 'short_term' || tab === 'long_term' ? e.scope === tab : true
  );

  // Simple deterministic circular SVG layout for Knowledge Graph nodes
  const cx = 320;
  const cy = 190;
  const radius = 135;
  const nodePositions = new Map<string, { x: number; y: number }>();
  nodes.forEach((n, idx) => {
    const angle = (idx / Math.max(1, nodes.length)) * Math.PI * 2 - Math.PI / 2;
    nodePositions.set(n.id, {
      x: cx + Math.cos(angle) * radius,
      y: cy + Math.sin(angle) * radius,
    });
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-800/80 pb-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-50">
            OMNI MEMORY & Knowledge Graph Engine
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Strict separation between short-term session context, long-term knowledge, and
            non-weight-mutating adaptive workflow learning.
          </p>
        </div>

        <div className="flex items-center gap-1 rounded-lg bg-[#111724] p-1 border border-slate-800">
          {([
            ['long_term', 'Long-Term'],
            ['short_term', 'Short-Term'],
            ['graph', 'Knowledge Graph'],
            ['vault', 'Memory Vault Pro'],
            ['learn', 'OMNI LEARN'],
          ] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                tab === id ? 'bg-sky-500/20 text-sky-300' : 'text-slate-400 hover:text-slate-100'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {statusMsg && (
        <div className="rounded-lg border border-sky-500/30 bg-sky-950/20 px-4 py-2.5 text-xs text-sky-200">
          {statusMsg}
        </div>
      )}

      {tab === 'graph' ? (
        <div className="rounded-xl border border-slate-800 bg-[#111724] p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-sm font-semibold text-slate-100">
              Relational Knowledge Network ({nodes.length} nodes · {relations.length} edges)
            </h2>
          </div>
          <div className="overflow-x-auto rounded-lg border border-slate-800 bg-[#0B0F17] p-2">
            <svg viewBox="0 0 640 380" className="w-full max-w-3xl mx-auto h-80">
              {relations.map((rel) => {
                const a = nodePositions.get(rel.source_node_id);
                const b = nodePositions.get(rel.target_node_id);
                if (!a || !b) return null;
                const mx = (a.x + b.x) / 2;
                const my = (a.y + b.y) / 2;
                return (
                  <g key={rel.id}>
                    <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#334155" strokeWidth={1.5} />
                    <text
                      x={mx}
                      y={my - 4}
                      fill="#94a3b8"
                      fontSize="9"
                      textAnchor="middle"
                    >
                      {rel.relation_type}
                    </text>
                  </g>
                );
              })}
              {nodes.map((node) => {
                const pos = nodePositions.get(node.id);
                if (!pos) return null;
                const color =
                  node.node_type === 'person'
                    ? '#38bdf8'
                    : node.node_type === 'project'
                      ? '#10b981'
                      : node.node_type === 'file'
                        ? '#f59e0b'
                        : '#a78bfa';
                return (
                  <g key={node.id}>
                    <circle cx={pos.x} cy={pos.y} r={18} fill="#111724" stroke={color} strokeWidth={2} />
                    <text
                      x={pos.x}
                      y={pos.y + 30}
                      fill="#e2e8f0"
                      fontSize="10"
                      textAnchor="middle"
                    >
                      {node.label.slice(0, 24)}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>
        </div>
      ) : tab === 'learn' ? (
        <div className="rounded-xl border border-slate-800 bg-[#111724] p-5 space-y-4">
          <h2 className="font-display text-base font-semibold text-slate-100">
            OMNI LEARN — Adaptive Intelligence Governance
          </h2>
          <p className="text-xs text-slate-300 leading-relaxed max-w-3xl">
            OMNI LEARN improves workspace accuracy via explicit <strong>Memory Adaptation</strong>,{' '}
            <strong>Retrieval Ranking</strong>, and <strong>Workflow Optimization</strong>. It
            never claims to automatically retrain or mutate underlying foundation model weights.
          </p>
          <div className="flex items-center justify-between rounded-lg border border-slate-800 bg-[#0B0F17] p-4 max-w-xl">
            <div>
              <p className="text-xs font-semibold text-slate-100">
                User-Consented Preference & Retrieval Adaptation
              </p>
              <p className="text-xs text-slate-400 mt-0.5">
                Prioritize verified workspace memory entries in OMNI BRAIN context retrieval.
              </p>
            </div>
            <input
              type="checkbox"
              checked={adaptiveOptIn}
              aria-label="Enable user-consented preference adaptation"
              onChange={async (e) => {
                const val = e.target.checked;
                setAdaptiveOptIn(val);
                await fetch('/api/settings', {
                  method: 'PUT',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ adaptiveLearningEnabled: val }),
                });
              }}
              className="h-4 w-4 accent-sky-500"
            />
          </div>
        </div>
      ) : tab === 'vault' ? (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (!ruleTitle.trim() || !ruleContent.trim()) return;
              const res = await apiFetch('/api/memory/vault', {
                method: 'POST',
                body: JSON.stringify({ workspaceId: activeWorkspaceId, ruleTitle, ruleContent }),
              });
              const d = await res.json();
              if (!res.ok) {
                setStatusMsg(d.error || 'Memory Vault Pro requires OMNIX PREMIUM');
                return;
              }
              setRuleTitle('');
              setRuleContent('');
              setStatusMsg('Personal vault rule persisted cleanly.');
              void loadMemory();
            }}
            className="lg:col-span-5 rounded-xl border border-slate-800 bg-[#111724] p-4 space-y-3 text-xs"
          >
            <h2 className="font-display text-sm font-semibold text-slate-100">OMNI MEMORY VAULT · Personal Assistant Rules</h2>
            <input
              value={ruleTitle}
              onChange={(e) => setRuleTitle(e.target.value)}
              placeholder="Rule Title (e.g. Always cite SI units)"
              className="w-full rounded-lg border border-slate-800 bg-[#0B0F17] px-3 py-2 text-slate-100"
            />
            <textarea
              rows={3}
              value={ruleContent}
              onChange={(e) => setRuleContent(e.target.value)}
              placeholder="Rule directive applied across personal reasoning..."
              className="w-full rounded-lg border border-slate-800 bg-[#0B0F17] px-3 py-2 text-slate-100"
            />
            <button type="submit" className="w-full rounded-lg bg-sky-600 py-2 font-semibold text-white hover:bg-sky-500">
              Save Vault Rule
            </button>
          </form>
          <div className="lg:col-span-7 rounded-xl border border-slate-800 bg-[#111724] p-4 divide-y divide-slate-800 text-xs">
            {vaultRules.length === 0 ? (
              <p className="text-slate-400 py-4">No custom vault rules added yet.</p>
            ) : (
              vaultRules.map((r) => (
                <div key={r.id} className="py-2.5">
                  <div className="font-semibold text-slate-100">{r.rule_title}</div>
                  <div className="text-slate-400 mt-0.5">{r.rule_content}</div>
                </div>
              ))
            )}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <form
            onSubmit={(e) => void handleSaveMemory(e)}
            className="lg:col-span-4 rounded-xl border border-slate-800 bg-[#111724] p-4 space-y-3"
          >
            <h2 className="font-display text-sm font-semibold text-slate-100">Store Memory Entry</h2>
            <div>
              <label htmlFor="mem-scope" className="block text-xs text-slate-400 mb-1">
                Memory Tier
              </label>
              <select
                id="mem-scope"
                value={scope}
                onChange={(e) => setScope(e.target.value as 'long_term' | 'short_term')}
                className="w-full rounded-lg border border-slate-800 bg-[#0B0F17] px-3 py-2 text-xs text-slate-100"
              >
                <option value="long_term">Long-Term Knowledge</option>
                <option value="short_term">Short-Term Session Context</option>
              </select>
            </div>
            <div>
              <label htmlFor="mem-title" className="block text-xs text-slate-400 mb-1">
                Title
              </label>
              <input
                id="mem-title"
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Rotor Material Spec"
                className="w-full rounded-lg border border-slate-800 bg-[#0B0F17] px-3 py-2 text-xs text-slate-100"
              />
            </div>
            <div>
              <label htmlFor="mem-content" className="block text-xs text-slate-400 mb-1">
                Content
              </label>
              <textarea
                id="mem-content"
                rows={4}
                required
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="Verified technical facts, project constraints, or preferences..."
                className="w-full rounded-lg border border-slate-800 bg-[#0B0F17] px-3 py-2 text-xs text-slate-100"
              />
            </div>
            <button
              type="submit"
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-sky-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-sky-400"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Save Memory</span>
            </button>
          </form>

          <div className="lg:col-span-8 rounded-xl border border-slate-800 bg-[#111724] p-4 space-y-4">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute start-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
                <input
                  type="search"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    void loadMemory(e.target.value);
                  }}
                  placeholder="Filter memory entries..."
                  className="w-full rounded-lg border border-slate-800 bg-[#0B0F17] py-1.5 ps-9 pe-3 text-xs text-slate-100"
                />
              </div>
            </div>

            <div className="divide-y divide-slate-800/70">
              {filteredEntries.length === 0 ? (
                <p className="py-6 text-xs text-slate-500">No entries in this memory tier.</p>
              ) : (
                filteredEntries.map((m) => (
                  <div key={m.id} className="py-3 flex items-start justify-between gap-3 text-xs">
                    <div>
                      <p className="font-semibold text-slate-100">{m.title}</p>
                      <p className="mt-1 text-slate-300 leading-relaxed">{m.content}</p>
                      <p className="mt-1 text-slate-500">
                        {m.scope} · Source: {m.source} · {m.created_at.slice(0, 10)}
                      </p>
                    </div>
                    <button
                      type="button"
                      aria-label={`Delete memory ${m.title}`}
                      onClick={() => void handleRequestDelete(m.id)}
                      className="p-1.5 text-slate-500 hover:text-red-400"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
