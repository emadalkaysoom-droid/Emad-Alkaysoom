import React, { useEffect, useState } from 'react';
import { Play, Plus, Workflow } from 'lucide-react';
import { useOmnix } from '../../contexts/OmnixContext';
import { apiFetch } from '../../lib/apiClient';
import type { AgentInfo, AgentTask } from '../../types/omnix';

interface TaskExecution {
  id: string;
  task_id: string;
  agent_id: string;
  output_json: string;
  error_message: string | null;
  duration_ms: number;
  verified_by_qa: number;
  executed_at: string;
}

export function AgentsView() {
  const { activeWorkspaceId, activeProjectId, refreshTick, triggerRefresh } = useOmnix();
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [tasks, setTasks] = useState<AgentTask[]>([]);
  const [executions, setExecutions] = useState<TaskExecution[]>([]);
  const [newAgentId, setNewAgentId] = useState('agent-math');
  const [newTitle, setNewTitle] = useState('');
  const [newExpr, setNewExpr] = useState('sqrt(256) * 3 + 18');
  const [feedback, setFeedback] = useState<string | null>(null);
  const [workflows, setWorkflows] = useState<Array<{ id: string; name: string; trigger_type: string; last_run_at: string | null }>>([]);
  const [wfName, setWfName] = useState('Telemetry Audit + Memory Pipeline');
  const [wfTrigger, setWfTrigger] = useState<'manual' | 'schedule' | 'event'>('manual');

  useEffect(() => {
    fetch(`/api/agents?workspaceId=${encodeURIComponent(activeWorkspaceId)}`)
      .then((r) => r.json())
      .then((d) => {
        setAgents(d.agents || []);
        setTasks(d.tasks || []);
        setExecutions(d.executions || []);
      })
      .catch(() => {});
    apiFetch(`/api/automation/workflows?workspaceId=${encodeURIComponent(activeWorkspaceId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) setWorkflows(d.workflows || []);
      })
      .catch(() => {});
  }, [activeWorkspaceId, refreshTick]);

  const scheduleTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;
    const res = await fetch('/api/tasks/schedule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspaceId: activeWorkspaceId,
        projectId: activeProjectId,
        agentId: newAgentId,
        title: newTitle.trim(),
        description: newExpr,
      }),
    });
    if (res.ok) {
      setNewTitle('');
      setFeedback('Task scheduled in workflow queue.');
      triggerRefresh();
    }
  };

  const executeTask = async (taskId: string) => {
    const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/execute`, { method: 'POST' });
    const data = await res.json();
    if (res.ok) {
      setFeedback(`Task executed in ${data.durationMs} ms · Output: ${JSON.stringify(data.output)}`);
      triggerRefresh();
    } else {
      setFeedback(`Execution failed: ${data.error}`);
    }
  };

  return (
    <div className="space-y-6">
      <div className="border-b border-slate-800/80 pb-4">
        <h1 className="font-display text-2xl font-bold text-slate-50">
          Specialized Agents & Autonomous Workflow Engine
        </h1>
        <p className="mt-1 text-sm text-slate-400">
          12 specialized domain agents with explicit tool allowlists, permission boundaries, QA
          verification, and execution history.
        </p>
      </div>

      {feedback && (
        <div className="rounded-lg border border-sky-500/30 bg-sky-950/20 px-4 py-2.5 text-xs text-sky-200 font-mono">
          {feedback}
        </div>
      )}

      {/* 12 Specialized Agents Grid */}
      <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2 lg:grid-cols-3">
        {agents.map((ag) => {
          const tools = JSON.parse(ag.allowed_tools_json || '[]') as string[];
          return (
            <div key={ag.id} className="rounded-xl border border-slate-800 bg-[#111724] p-4 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-display text-sm font-semibold text-slate-100">{ag.name}</h2>
                <span className="font-mono text-xs text-slate-400">{ag.permission_level}</span>
              </div>
              <p className="text-xs font-medium text-sky-400">{ag.role_title}</p>
              <p className="text-xs text-slate-400">{ag.specialty}</p>
              <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-xs text-slate-500">
                <span className="truncate">Tools: {tools.join(', ')}</span>
                <span className="font-mono tabular-nums shrink-0 ms-2">
                  {ag.tasks_completed} done
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Task Scheduler + Queue */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <form
          onSubmit={(e) => void scheduleTask(e)}
          className="lg:col-span-4 rounded-xl border border-slate-800 bg-[#111724] p-4 space-y-3"
        >
          <h2 className="font-display text-sm font-semibold text-slate-100">Schedule Agent Task</h2>
          <div>
            <label htmlFor="sched-agent" className="block text-xs text-slate-400 mb-1">
              Target Agent
            </label>
            <select
              id="sched-agent"
              value={newAgentId}
              onChange={(e) => setNewAgentId(e.target.value)}
              className="w-full rounded-lg border border-slate-800 bg-[#0B0F17] px-3 py-2 text-xs text-slate-100"
            >
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="sched-title" className="block text-xs text-slate-400 mb-1">
              Task Title
            </label>
            <input
              id="sched-title"
              type="text"
              required
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="e.g. Compute Bearing Load Factor"
              className="w-full rounded-lg border border-slate-800 bg-[#0B0F17] px-3 py-2 text-xs text-slate-100"
            />
          </div>
          <div>
            <label htmlFor="sched-payload" className="block text-xs text-slate-400 mb-1">
              Payload (Formula for Math Agent / JS for Coding Agent)
            </label>
            <textarea
              id="sched-payload"
              rows={3}
              value={newExpr}
              onChange={(e) => setNewExpr(e.target.value)}
              className="w-full rounded-lg border border-slate-800 bg-[#0B0F17] px-3 py-2 font-mono text-xs text-slate-100"
            />
          </div>
          <button
            type="submit"
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-sky-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-sky-400"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Queue Task</span>
          </button>
        </form>

        <div className="lg:col-span-8 rounded-xl border border-slate-800 bg-[#111724] p-4">
          <h2 className="font-display text-sm font-semibold text-slate-100 pb-3 border-b border-slate-800">
            Task Queue & Verified Executions ({tasks.length})
          </h2>
          <div className="mt-3 max-h-96 overflow-y-auto divide-y divide-slate-800/70">
            {tasks.map((task) => {
              const exec = executions.find((ex) => ex.task_id === task.id);
              return (
                <div key={task.id} className="py-3 flex flex-wrap items-center justify-between gap-3 text-xs">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-slate-100 truncate">{task.title}</p>
                    <p className="text-slate-400 mt-0.5">
                      {task.agent_name} · <span className="font-mono">{task.status}</span>
                      {exec && ` · ${exec.duration_ms} ms · QA: ${exec.verified_by_qa ? 'Verified' : 'Pending'}`}
                    </p>
                  </div>
                  {task.status === 'queued' && (
                    <button
                      type="button"
                      onClick={() => void executeTask(task.id)}
                      className="flex items-center gap-1.5 rounded-md bg-emerald-500/15 px-3 py-1.5 font-medium text-emerald-300 hover:bg-emerald-500/25"
                    >
                      <Play className="h-3 w-3" />
                      <span>Run Now</span>
                    </button>
                  )}
                </div>
              );
            })}
            {tasks.length === 0 && <p className="py-6 text-xs text-slate-500">No tasks queued yet.</p>}
          </div>
        </div>
      </div>

      {/* OMNI AUTOMATION PRO — Multi-Step Automated Workflows */}
      <div className="rounded-xl border border-slate-800 bg-[#111724] p-4 space-y-3 text-xs">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2.5">
          <div className="flex items-center gap-2 font-display text-sm font-semibold text-slate-100">
            <Workflow className="h-4 w-4 text-sky-400" />
            <span>OMNI AUTOMATION PRO · Multi-Step Workflows</span>
          </div>
          <div className="flex flex-wrap gap-2">
            <input
              value={wfName}
              onChange={(e) => setWfName(e.target.value)}
              className="rounded border border-slate-800 bg-[#0B0F17] px-2.5 py-1 text-slate-100"
            />
            <select
              value={wfTrigger}
              onChange={(e) => setWfTrigger(e.target.value as typeof wfTrigger)}
              className="rounded border border-slate-800 bg-[#0B0F17] px-2 py-1 text-slate-200"
            >
              <option value="manual">Manual Trigger</option>
              <option value="schedule">Scheduled</option>
              <option value="event">Event Hook</option>
            </select>
            <button
              type="button"
              onClick={async () => {
                const res = await apiFetch('/api/automation/workflows', {
                  method: 'POST',
                  body: JSON.stringify({
                    workspaceId: activeWorkspaceId,
                    name: wfName,
                    triggerType: wfTrigger,
                    steps: [
                      { toolName: 'math_eval', args: { expression: 'sqrt(144) * 5' } },
                      { toolName: 'analyze_data', args: { query: 'telemetry summary' } },
                    ],
                  }),
                });
                const d = await res.json();
                if (!res.ok) setFeedback(d.error || 'OMNI AUTOMATION PRO requires OMNIX PREMIUM');
                else {
                  setFeedback(`Created multi-step workflow ${d.id}`);
                  triggerRefresh();
                }
              }}
              className="rounded bg-sky-600 px-3 py-1 font-semibold text-white hover:bg-sky-500"
            >
              + Create 2-Step Workflow
            </button>
          </div>
        </div>

        <div className="divide-y divide-slate-800/70">
          {workflows.length === 0 ? (
            <p className="text-slate-400 py-2">Create an automated multi-step workflow to chain OMNIX tools cleanly.</p>
          ) : (
            workflows.map((wf) => (
              <div key={wf.id} className="flex items-center justify-between py-2">
                <div>
                  <span className="font-semibold text-slate-200">{wf.name}</span>
                  <span className="ms-2 font-mono text-slate-400">[{wf.trigger_type}]</span>
                  {wf.last_run_at && <span className="ms-2 text-slate-500">Last run: {wf.last_run_at}</span>}
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    const res = await apiFetch(`/api/automation/workflows/${encodeURIComponent(wf.id)}/run`, { method: 'POST' });
                    const d = await res.json();
                    if (!res.ok) setFeedback(d.error || 'Run failed');
                    else {
                      setFeedback(`Workflow ${wf.name} ${d.status} in ${d.durationMs}ms`);
                      triggerRefresh();
                    }
                  }}
                  className="rounded border border-emerald-500/40 bg-emerald-500/15 px-3 py-1 font-medium text-emerald-300"
                >
                  Execute Workflow
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
