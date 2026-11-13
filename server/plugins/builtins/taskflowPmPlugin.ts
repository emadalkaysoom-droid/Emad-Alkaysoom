import crypto from 'node:crypto';
import type { OmnixPlugin, PluginExecutionContext, PluginExecutionResult } from '../../../shared/pluginContract.ts';

interface TaskFlowIssue {
  key: string;
  title: string;
  priority: 'high' | 'medium' | 'low';
  status: 'open' | 'in_progress' | 'done';
  linkedProjectId?: string | null;
  createdAt: string;
}

const DEFAULT_ISSUES: TaskFlowIssue[] = [
  {
    key: 'TF-101',
    title: 'Inspect Turbine-01 bearing thermal spike at 13:00Z',
    priority: 'high',
    status: 'in_progress',
    linkedProjectId: 'proj-telemetry',
    createdAt: '2026-11-12T09:30:00Z',
  },
  {
    key: 'TF-102',
    title: 'Calibrate 6-DOF manipulator collision restitution damping',
    priority: 'medium',
    status: 'open',
    linkedProjectId: 'proj-manipulator',
    createdAt: '2026-11-12T11:15:00Z',
  },
];

export const taskflowPmPlugin: OmnixPlugin = {
  manifest: {
    id: 'plugin-taskflow-pm',
    name: 'TaskFlow Project Management Connector',
    version: '1.2.0',
    author: 'OMNI CONNECT Ecosystem',
    category: 'project_management',
    description:
      'Bidirectional project management adapter for tracking engineering issues, syncing OMNIX projects to external sprint boards, and gating board archive operations.',
    permissions: ['projects:read', 'projects:write', 'workspace:read'],
    allowedDomains: ['api.taskflow.example'],
    entryType: 'builtin',
    actions: [
      {
        id: 'list_issues',
        name: 'List Board Issues',
        description: 'Retrieve tracked engineering issues from the connected TaskFlow board.',
        requiredPermission: 'projects:read',
        inputSchema: {
          status: {
            type: 'string',
            required: false,
            description: 'Optional status filter (open, in_progress, done)',
            defaultValue: '',
          },
        },
      },
      {
        id: 'create_issue',
        name: 'Create Tracked Issue',
        description: 'Open a new issue in TaskFlow linked to an active OMNIX project.',
        requiredPermission: 'projects:write',
        inputSchema: {
          title: {
            type: 'string',
            required: true,
            description: 'Concise engineering issue title',
            defaultValue: 'Review automated Z-score telemetry alert',
          },
          priority: {
            type: 'string',
            required: false,
            description: 'Priority level: high, medium, or low',
            defaultValue: 'high',
          },
          projectId: {
            type: 'string',
            required: false,
            description: 'OMNIX Project ID to link',
            defaultValue: 'proj-telemetry',
          },
        },
      },
      {
        id: 'sync_project_to_board',
        name: 'Sync OMNIX Projects to Board',
        description: 'Synchronize workspace projects into TaskFlow milestone tickets.',
        requiredPermission: 'projects:write',
        inputSchema: {},
      },
      {
        id: 'purge_board_archive',
        name: 'Purge Closed Board Issues',
        description: 'Destructive cleanup of closed board tickets (requires OMNI SECURITY approval).',
        requiredPermission: 'projects:write',
        requiresApproval: true,
        inputSchema: {},
      },
    ],
  },

  initialize(ctx) {
    const existing = ctx.readStore<TaskFlowIssue[]>('issues');
    if (!existing) {
      ctx.writeStore('issues', DEFAULT_ISSUES);
    }
  },

  execute(actionId: string, input: Record<string, unknown>, ctx: PluginExecutionContext): PluginExecutionResult {
    const issues = ctx.readStore<TaskFlowIssue[]>('issues') ?? [...DEFAULT_ISSUES];
    const now = new Date().toISOString();

    if (actionId === 'list_issues') {
      const statusFilter = typeof input.status === 'string' ? input.status.trim() : '';
      const filtered = statusFilter ? issues.filter((i) => i.status === statusFilter) : issues;
      return {
        ok: true,
        actionId,
        provider: 'TaskFlow Cloud PM',
        summary: `Retrieved ${filtered.length} issue(s) from TaskFlow board.`,
        data: { issues: filtered, totalCount: issues.length },
        executedAt: now,
      };
    }

    if (actionId === 'create_issue') {
      const title = String(input.title || '').trim();
      if (!title) {
        throw new Error('Action "create_issue" requires a non-empty "title" input.');
      }
      const priorityRaw = String(input.priority || 'medium').toLowerCase();
      const priority: TaskFlowIssue['priority'] =
        priorityRaw === 'high' || priorityRaw === 'low' ? priorityRaw : 'medium';

      const newIssue: TaskFlowIssue = {
        key: `TF-${103 + issues.length}`,
        title,
        priority,
        status: 'open',
        linkedProjectId: typeof input.projectId === 'string' && input.projectId ? input.projectId : ctx.projectId ?? null,
        createdAt: now,
      };
      const updated = [newIssue, ...issues];
      ctx.writeStore('issues', updated);

      return {
        ok: true,
        actionId,
        provider: 'TaskFlow Cloud PM',
        summary: `Created issue ${newIssue.key}: "${newIssue.title}" (${newIssue.priority}).`,
        data: { created: newIssue, boardCount: updated.length },
        executedAt: now,
      };
    }

    if (actionId === 'sync_project_to_board') {
      const projects = ctx.listProjects();
      const existingTitles = new Set(issues.map((i) => i.linkedProjectId));
      const newlyCreated: TaskFlowIssue[] = [];
      for (const proj of projects) {
        if (!existingTitles.has(proj.id)) {
          newlyCreated.push({
            key: `TF-${crypto.randomInt(200, 999)}`,
            title: `Milestone Sync: ${proj.name}`,
            priority: 'medium',
            status: proj.status === 'active' ? 'in_progress' : 'done',
            linkedProjectId: proj.id,
            createdAt: now,
          });
        }
      }
      const merged = [...newlyCreated, ...issues];
      ctx.writeStore('issues', merged);
      return {
        ok: true,
        actionId,
        provider: 'TaskFlow Cloud PM',
        summary: `Synced ${projects.length} workspace project(s); created ${newlyCreated.length} new board milestone(s).`,
        data: { syncedProjects: projects.length, newlyCreated, totalBoardIssues: merged.length },
        executedAt: now,
      };
    }

    if (actionId === 'purge_board_archive') {
      const remaining = issues.filter((i) => i.status !== 'done');
      const removed = issues.length - remaining.length;
      ctx.writeStore('issues', remaining);
      return {
        ok: true,
        actionId,
        provider: 'TaskFlow Cloud PM',
        summary: `Purged ${removed} completed issue(s) from TaskFlow archive.`,
        data: { purgedCount: removed, remainingCount: remaining.length },
        executedAt: now,
      };
    }

    throw new Error(`Unsupported action "${actionId}" on TaskFlow PM plugin.`);
  },
};
