import React, { useEffect, useState } from 'react';
import { Activity, Play, Plus, RefreshCw, ShieldCheck, ShieldAlert } from 'lucide-react';
import { useOmnix } from '../../contexts/OmnixContext';
import type { PluginManifest, PluginPermissionScope } from '../../../shared/pluginContract';

interface IntegrationRecord {
  id: string;
  name: string;
  connector_type: string;
  endpoint_url: string;
  auth_type: string;
  status: string;
  last_checked_at: string | null;
}

interface LoadedPlugin {
  id: string;
  name: string;
  version: string;
  author: string;
  category: string;
  description: string;
  enabled: boolean;
  source: 'builtin' | 'manifest_dir' | 'custom_registered';
  manifest: PluginManifest;
  grantedPermissions: PluginPermissionScope[];
  discoveredAt: string;
}

const SAMPLE_CUSTOM_MANIFEST = JSON.stringify(
  {
    id: 'plugin-sprint-sync',
    name: 'SprintBoard Webhook Adapter',
    version: '1.0.0',
    author: 'Workspace Developer',
    category: 'project_management',
    description: 'Custom manifest plugin that formats sprint status payloads for external boards.',
    permissions: ['workspace:read', 'projects:read'],
    allowedDomains: ['hooks.sprintboard.example'],
    entryType: 'manifest_webhook',
    actions: [
      {
        id: 'dispatch_digest',
        name: 'Build Sprint Digest',
        description: 'Creates a verified digest payload for SprintBoard.',
        requiredPermission: 'projects:read',
        inputSchema: {
          sprintName: {
            type: 'string',
            required: true,
            description: 'Sprint label',
            defaultValue: 'Sprint-2026-W46',
          },
        },
      },
    ],
  },
  null,
  2
);

export function IntegrationsView() {
  const { activeWorkspaceId, activeProjectId, user, refreshTick, triggerRefresh, setActiveView } = useOmnix();
  const [tab, setTab] = useState<'plugins' | 'connectors'>('plugins');

  // Connectors state
  const [integrations, setIntegrations] = useState<IntegrationRecord[]>([]);
  const [name, setName] = useState('');
  const [connectorType, setConnectorType] = useState<'rest_api' | 'webhook' | 'websocket' | 'oauth2' | 'file_connector'>('rest_api');
  const [endpointUrl, setEndpointUrl] = useState('https://httpbin.org/get');
  const [testFeedback, setTestFeedback] = useState<string | null>(null);

  // Plugins state
  const [plugins, setPlugins] = useState<LoadedPlugin[]>([]);
  const [selectedPluginId, setSelectedPluginId] = useState<string>('plugin-taskflow-pm');
  const [selectedActionId, setSelectedActionId] = useState<string>('list_issues');
  const [actionInputs, setActionInputs] = useState<Record<string, string>>({});
  const [execOutput, setExecOutput] = useState<{
    ok: boolean;
    message: string;
    data?: unknown;
    approvalRequired?: boolean;
  } | null>(null);
  const [showRegisterModal, setShowRegisterModal] = useState(false);
  const [customManifestText, setCustomManifestText] = useState(SAMPLE_CUSTOM_MANIFEST);
  const [pluginFeedback, setPluginFeedback] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/integrations?workspaceId=${encodeURIComponent(activeWorkspaceId)}`)
      .then((r) => r.json())
      .then((d) => {
        setIntegrations(d.integrations || []);
        const loaded = (d.plugins || []) as LoadedPlugin[];
        setPlugins(loaded);
        if (loaded.length > 0 && !loaded.some((p) => p.id === selectedPluginId)) {
          setSelectedPluginId(loaded[0].id);
          setSelectedActionId(loaded[0].manifest.actions[0]?.id || '');
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWorkspaceId, refreshTick]);

  const selectedPlugin = plugins.find((p) => p.id === selectedPluginId) ?? plugins[0];
  const selectedAction =
    selectedPlugin?.manifest.actions.find((a) => a.id === selectedActionId) ??
    selectedPlugin?.manifest.actions[0];

  const handleSelectPlugin = (pl: LoadedPlugin) => {
    setSelectedPluginId(pl.id);
    const firstAct = pl.manifest.actions[0];
    setSelectedActionId(firstAct?.id || '');
    const defaults: Record<string, string> = {};
    if (firstAct) {
      for (const [k, field] of Object.entries(firstAct.inputSchema || {})) {
        if (field.defaultValue !== undefined) defaults[k] = String(field.defaultValue);
      }
    }
    setActionInputs(defaults);
    setExecOutput(null);
  };

  const handleSelectAction = (actId: string) => {
    setSelectedActionId(actId);
    const act = selectedPlugin?.manifest.actions.find((a) => a.id === actId);
    const defaults: Record<string, string> = {};
    if (act) {
      for (const [k, field] of Object.entries(act.inputSchema || {})) {
        if (field.defaultValue !== undefined) defaults[k] = String(field.defaultValue);
      }
    }
    setActionInputs(defaults);
  };

  const handleDiscoverPlugins = async () => {
    setPluginFeedback(null);
    const res = await fetch('/api/plugins/discover', { method: 'POST' });
    const data = await res.json();
    if (res.ok) {
      setPlugins(data.plugins || []);
      setPluginFeedback(`Discovered and synchronized ${data.discoveredCount} plugin module(s) & manifest(s).`);
    }
  };

  const handleToggleEnabled = async (pl: LoadedPlugin) => {
    setPluginFeedback(null);
    const res = await fetch(`/api/plugins/${encodeURIComponent(pl.id)}/security`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspaceId: activeWorkspaceId,
        enabled: !pl.enabled,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setPluginFeedback(data.error || 'Permission denied.');
      return;
    }
    triggerRefresh();
  };

  const handleTogglePermissionGrant = async (pl: LoadedPlugin, perm: PluginPermissionScope) => {
    setPluginFeedback(null);
    const has = pl.grantedPermissions.includes(perm);
    const nextGrants = has
      ? pl.grantedPermissions.filter((p) => p !== perm)
      : [...pl.grantedPermissions, perm];

    const res = await fetch(`/api/plugins/${encodeURIComponent(pl.id)}/security`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspaceId: activeWorkspaceId,
        grantedPermissions: nextGrants,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setPluginFeedback(data.error || 'Failed to update permission grant.');
      return;
    }
    triggerRefresh();
  };

  const handleExecutePluginAction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPlugin || !selectedAction) return;
    setExecOutput(null);

    const parsedInput: Record<string, unknown> = {};
    for (const [k, field] of Object.entries(selectedAction.inputSchema || {})) {
      const val = actionInputs[k] ?? '';
      if (field.type === 'number') {
        parsedInput[k] = Number(val || 0);
      } else if (field.type === 'boolean') {
        parsedInput[k] = val === 'true';
      } else {
        parsedInput[k] = val;
      }
    }

    const res = await fetch(`/api/plugins/${encodeURIComponent(selectedPlugin.id)}/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspaceId: activeWorkspaceId,
        projectId: activeProjectId,
        actionId: selectedAction.id,
        input: parsedInput,
      }),
    });
    const data = await res.json();
    if (res.status === 202 && data.status === 'awaiting_approval') {
      setExecOutput({
        ok: false,
        approvalRequired: true,
        message: data.message,
        data,
      });
      triggerRefresh();
      return;
    }
    if (!res.ok) {
      setExecOutput({
        ok: false,
        message: data.error || `HTTP ${res.status} Execution blocked`,
        data,
      });
      return;
    }
    setExecOutput({
      ok: true,
      message: data.result.summary,
      data: data.result,
    });
    triggerRefresh();
  };

  const handleRegisterManifest = async (e: React.FormEvent) => {
    e.preventDefault();
    setPluginFeedback(null);
    try {
      const parsed = JSON.parse(customManifestText);
      const res = await fetch('/api/plugins/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId: activeWorkspaceId, manifest: parsed }),
      });
      const data = await res.json();
      if (!res.ok) {
        setPluginFeedback(data.error || 'Manifest validation failed.');
        return;
      }
      setShowRegisterModal(false);
      setPluginFeedback(`Installed plugin "${data.plugin.name}" with least-privilege default scopes.`);
      triggerRefresh();
    } catch (err) {
      setPluginFeedback(err instanceof Error ? err.message : 'Invalid JSON manifest syntax.');
    }
  };

  const handleCreateConnector = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !endpointUrl.trim()) return;
    const res = await fetch('/api/integrations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspaceId: activeWorkspaceId,
        name: name.trim(),
        connectorType,
        endpointUrl: endpointUrl.trim(),
      }),
    });
    if (res.ok) {
      setName('');
      triggerRefresh();
    }
  };

  const handleTestConnector = async (id: string) => {
    setTestFeedback('Testing live connection...');
    const res = await fetch(`/api/integrations/${encodeURIComponent(id)}/test`, { method: 'POST' });
    const data = await res.json();
    setTestFeedback(
      data.status === 'connected'
        ? `Connected (${data.httpStatus}) in ${data.latencyMs} ms`
        : `Connection check failed: ${data.error || data.status} (${data.latencyMs} ms)`
    );
    triggerRefresh();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-800/80 pb-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-50">
            OMNI CONNECT — Plugin Architecture & External Integrations
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Discover and execute scoped plugins (TaskFlow PM, NebulaVault Storage, custom manifests)
            with RBAC permission enforcement, approval gates, and live endpoint connectors.
          </p>
        </div>

        <div className="flex items-center gap-1 rounded-lg border border-slate-800 bg-[#111724] p-1">
          <button
            type="button"
            onClick={() => setTab('plugins')}
            className={`rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap ${
              tab === 'plugins' ? 'bg-sky-500/20 text-sky-300' : 'text-slate-400 hover:text-slate-100'
            }`}
          >
            Plugin Runtime ({plugins.length})
          </button>
          <button
            type="button"
            onClick={() => setTab('connectors')}
            className={`rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap ${
              tab === 'connectors' ? 'bg-sky-500/20 text-sky-300' : 'text-slate-400 hover:text-slate-100'
            }`}
          >
            Service Connectors ({integrations.length})
          </button>
        </div>
      </div>

      {pluginFeedback && (
        <div className="rounded-lg border border-sky-500/30 bg-sky-950/20 px-4 py-2.5 text-xs text-sky-200">
          {pluginFeedback}
        </div>
      )}

      {tab === 'plugins' ? (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs text-slate-400">
              Active RBAC Role: <span className="font-mono text-slate-200">{user?.role || 'admin'}</span> ·
              Plugins enforce both role permissions and granted manifest scopes.
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void handleDiscoverPlugins()}
                className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-[#111724] px-3.5 py-2 text-xs font-medium text-slate-200 hover:border-slate-500"
              >
                <RefreshCw className="h-3.5 w-3.5 text-sky-400" />
                <span>Discover Plugins</span>
              </button>
              <button
                type="button"
                onClick={() => setShowRegisterModal(!showRegisterModal)}
                className="flex items-center gap-1.5 rounded-lg bg-sky-500 px-3.5 py-2 text-xs font-semibold text-slate-950 hover:bg-sky-400"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Register Plugin Manifest</span>
              </button>
            </div>
          </div>

          {showRegisterModal && (
            <form
              onSubmit={(e) => void handleRegisterManifest(e)}
              className="rounded-xl border border-slate-700 bg-[#111724] p-5 space-y-3"
            >
              <div className="flex items-center justify-between">
                <h2 className="font-display text-sm font-semibold text-slate-100">
                  Install Declarative Plugin Manifest (Least-Privilege Default)
                </h2>
                <button
                  type="button"
                  onClick={() => setShowRegisterModal(false)}
                  className="text-xs text-slate-400 hover:text-slate-200"
                >
                  Cancel
                </button>
              </div>
              <textarea
                rows={10}
                aria-label="Plugin manifest JSON"
                value={customManifestText}
                onChange={(e) => setCustomManifestText(e.target.value)}
                className="w-full rounded-lg border border-slate-800 bg-[#0B0F17] p-3 font-mono text-xs text-slate-200"
              />
              <button
                type="submit"
                className="rounded-lg bg-sky-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-sky-400"
              >
                Validate & Load Plugin
              </button>
            </form>
          )}

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            {/* Discovered & Loaded Plugins List + Permission Grants */}
            <div className="lg:col-span-7 space-y-3">
              {plugins.map((pl) => {
                const isSelected = selectedPlugin?.id === pl.id;
                return (
                  <div
                    key={pl.id}
                    className={`rounded-xl border bg-[#111724] p-4 space-y-3 transition-colors ${
                      isSelected ? 'border-sky-500/50' : 'border-slate-800'
                    }`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <button
                          type="button"
                          onClick={() => handleSelectPlugin(pl)}
                          className="text-start font-display text-sm font-semibold text-slate-100 hover:text-sky-400"
                        >
                          {pl.name}
                        </button>
                        <p className="mt-0.5 text-xs text-slate-400">
                          v{pl.version} · {pl.author} · {pl.category} · {pl.source}
                        </p>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleSelectPlugin(pl)}
                          className="rounded-md border border-slate-700 bg-[#0B0F17] px-2.5 py-1 text-xs text-slate-200 hover:border-slate-500"
                        >
                          Configure / Run
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleToggleEnabled(pl)}
                          className={`rounded-md px-2.5 py-1 text-xs font-mono font-semibold ${
                            pl.enabled
                              ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                              : 'bg-slate-800 text-slate-400 border border-slate-700'
                          }`}
                        >
                          {pl.enabled ? 'ENABLED' : 'DISABLED'}
                        </button>
                      </div>
                    </div>

                    <p className="text-xs text-slate-400">{pl.description}</p>

                    <div className="border-t border-slate-800/80 pt-2.5">
                      <p className="text-[11px] font-medium text-slate-400 mb-2 flex items-center gap-1.5">
                        <ShieldCheck className="h-3.5 w-3.5 text-sky-400" />
                        <span>Granted Permission Scopes (click to grant or revoke)</span>
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {pl.manifest.permissions.map((perm) => {
                          const granted = pl.grantedPermissions.includes(perm);
                          return (
                            <label
                              key={perm}
                              className={`flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-[11px] ${
                                granted
                                  ? 'border-sky-500/40 bg-sky-500/10 text-sky-200'
                                  : 'border-slate-800 bg-[#0B0F17] text-slate-500'
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={granted}
                                onChange={() => void handleTogglePermissionGrant(pl, perm)}
                                className="accent-sky-500"
                              />
                              <span>{perm}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Interactive Plugin Action Runner */}
            <div className="lg:col-span-5">
              {selectedPlugin && (
                <form
                  onSubmit={(e) => void handleExecutePluginAction(e)}
                  className="rounded-xl border border-slate-800 bg-[#111724] p-5 space-y-4 sticky top-4"
                >
                  <div className="border-b border-slate-800 pb-3">
                    <h2 className="font-display text-sm font-semibold text-slate-100">
                      Plugin Action Runner — {selectedPlugin.name}
                    </h2>
                    <p className="mt-1 text-xs text-slate-400">
                      Executes scoped plugin actions with RBAC & audit logging.
                    </p>
                  </div>

                  <div>
                    <label htmlFor="plugin-action-select" className="block text-xs text-slate-400 mb-1">
                      Select Action
                    </label>
                    <select
                      id="plugin-action-select"
                      value={selectedAction?.id || ''}
                      onChange={(e) => handleSelectAction(e.target.value)}
                      className="w-full rounded-lg border border-slate-800 bg-[#0B0F17] px-3 py-2 text-xs text-slate-100"
                    >
                      {selectedPlugin.manifest.actions.map((act) => (
                        <option key={act.id} value={act.id}>
                          {act.name} ({act.requiredPermission})
                        </option>
                      ))}
                    </select>
                    {selectedAction && (
                      <p className="mt-1.5 text-xs text-slate-400">
                        {selectedAction.description}
                        {selectedAction.requiresApproval ? ' · Requires OMNI SECURITY approval.' : ''}
                      </p>
                    )}
                  </div>

                  {selectedAction && Object.keys(selectedAction.inputSchema || {}).length > 0 && (
                    <div className="space-y-2.5">
                      {Object.entries(selectedAction.inputSchema).map(([key, field]) => (
                        <div key={key}>
                          <label htmlFor={`pl-in-${key}`} className="block text-xs text-slate-400 mb-1">
                            {key} ({field.description})
                          </label>
                          <input
                            id={`pl-in-${key}`}
                            type="text"
                            value={actionInputs[key] ?? ''}
                            onChange={(e) =>
                              setActionInputs((prev) => ({ ...prev, [key]: e.target.value }))
                            }
                            placeholder={field.defaultValue !== undefined ? String(field.defaultValue) : ''}
                            className="w-full rounded-lg border border-slate-800 bg-[#0B0F17] px-3 py-2 text-xs text-slate-100"
                          />
                        </div>
                      ))}
                    </div>
                  )}

                  <button
                    type="submit"
                    className="flex w-full items-center justify-center gap-2 rounded-lg bg-sky-500 px-4 py-2.5 text-xs font-semibold text-slate-950 hover:bg-sky-400"
                  >
                    <Play className="h-3.5 w-3.5" />
                    <span>Execute Plugin Action</span>
                  </button>

                  {execOutput && (
                    <div
                      className={`rounded-lg border p-3.5 text-xs space-y-2 ${
                        execOutput.ok
                          ? 'border-emerald-500/30 bg-emerald-950/15 text-emerald-200'
                          : execOutput.approvalRequired
                            ? 'border-amber-500/35 bg-amber-950/20 text-amber-200'
                            : 'border-red-500/35 bg-red-950/20 text-red-200'
                      }`}
                    >
                      <div className="flex items-start gap-2 font-medium">
                        {!execOutput.ok && <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5" />}
                        <span>{execOutput.message}</span>
                      </div>
                      {execOutput.approvalRequired && (
                        <button
                          type="button"
                          onClick={() => setActiveView('security')}
                          className="rounded-md bg-amber-500/20 px-3 py-1 text-xs font-semibold text-amber-200 hover:bg-amber-500/30"
                        >
                          Open OMNI SECURITY Approvals
                        </button>
                      )}
                      {execOutput.data !== undefined && (
                        <pre className="max-h-56 overflow-auto rounded bg-[#0B0F17] p-2.5 font-mono text-[11px] text-slate-300">
                          {JSON.stringify(execOutput.data, null, 2)}
                        </pre>
                      )}
                    </div>
                  )}
                </form>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {testFeedback && (
            <div className="rounded-lg border border-sky-500/30 bg-sky-950/20 px-4 py-2.5 font-mono text-xs text-sky-200">
              {testFeedback}
            </div>
          )}

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            <form
              onSubmit={(e) => void handleCreateConnector(e)}
              className="lg:col-span-4 rounded-xl border border-slate-800 bg-[#111724] p-4 space-y-3"
            >
              <h2 className="font-display text-sm font-semibold text-slate-100">Add Service Connector</h2>
              <div>
                <label htmlFor="int-name" className="block text-xs text-slate-400 mb-1">
                  Connector Name
                </label>
                <input
                  id="int-name"
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Telemetry Webhook"
                  className="w-full rounded-lg border border-slate-800 bg-[#0B0F17] px-3 py-2 text-xs text-slate-100"
                />
              </div>
              <div>
                <label htmlFor="int-type" className="block text-xs text-slate-400 mb-1">
                  Protocol / Adapter
                </label>
                <select
                  id="int-type"
                  value={connectorType}
                  onChange={(e) =>
                    setConnectorType(
                      e.target.value as 'rest_api' | 'webhook' | 'websocket' | 'oauth2' | 'file_connector'
                    )
                  }
                  className="w-full rounded-lg border border-slate-800 bg-[#0B0F17] px-3 py-2 text-xs text-slate-100"
                >
                  <option value="rest_api">REST API</option>
                  <option value="webhook">Webhook</option>
                  <option value="websocket">WebSocket</option>
                  <option value="oauth2">OAuth 2.0 Adapter</option>
                  <option value="file_connector">File Connector</option>
                </select>
              </div>
              <div>
                <label htmlFor="int-url" className="block text-xs text-slate-400 mb-1">
                  Endpoint URL
                </label>
                <input
                  id="int-url"
                  type="url"
                  required
                  value={endpointUrl}
                  onChange={(e) => setEndpointUrl(e.target.value)}
                  className="w-full rounded-lg border border-slate-800 bg-[#0B0F17] px-3 py-2 font-mono text-xs text-slate-100"
                />
              </div>
              <button
                type="submit"
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-sky-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-sky-400"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Register Connector</span>
              </button>
            </form>

            <div className="lg:col-span-8 rounded-xl border border-slate-800 bg-[#111724] p-4">
              <h2 className="font-display text-sm font-semibold text-slate-100 pb-3 border-b border-slate-800">
                Configured Connections ({integrations.length})
              </h2>
              <div className="mt-3 divide-y divide-slate-800/70">
                {integrations.map((item) => (
                  <div key={item.id} className="py-3 flex flex-wrap items-center justify-between gap-3 text-xs">
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-100">{item.name}</p>
                      <p className="font-mono text-slate-400 truncate">
                        {item.connector_type} · {item.endpoint_url}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span
                        className={`font-mono font-semibold ${
                          item.status === 'connected'
                            ? 'text-emerald-400'
                            : item.status === 'error'
                              ? 'text-red-400'
                              : 'text-amber-400'
                        }`}
                      >
                        {item.status.toUpperCase()}
                      </span>
                      <button
                        type="button"
                        onClick={() => void handleTestConnector(item.id)}
                        className="flex items-center gap-1 rounded-md border border-slate-700 bg-[#0B0F17] px-2.5 py-1.5 text-slate-200 hover:border-slate-500"
                      >
                        <Activity className="h-3 w-3 text-sky-400" />
                        <span>Test</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
