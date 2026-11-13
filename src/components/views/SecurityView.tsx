import React, { useEffect, useState } from 'react';
import { Check, DatabaseBackup, Lock, X } from 'lucide-react';
import { useOmnix } from '../../contexts/OmnixContext';

interface ApprovalTicket {
  id: string;
  requested_by: string;
  action_type: string;
  target_resource: string;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
}

interface AuditLog {
  id: string;
  action: string;
  resource_type: string;
  resource_id: string | null;
  status: string;
  created_at: string;
}

export function SecurityView() {
  const { activeWorkspaceId, refreshTick, triggerRefresh, setUser } = useOmnix();
  const [approvals, setApprovals] = useState<ApprovalTicket[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [backupInfo, setBackupInfo] = useState<string | null>(null);
  const [email, setEmail] = useState('architect@omnix.local');
  const [password, setPassword] = useState('');
  const [authMsg, setAuthMsg] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/security?workspaceId=${encodeURIComponent(activeWorkspaceId)}`)
      .then((r) => r.json())
      .then((d) => {
        setApprovals(d.approvals || []);
        setAuditLogs(d.auditLogs || []);
      })
      .catch(() => {});
  }, [activeWorkspaceId, refreshTick]);

  const decideApproval = async (id: string, decision: 'approved' | 'rejected') => {
    const res = await fetch(`/api/security/approvals/${encodeURIComponent(id)}/decide`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision }),
    });
    if (res.ok) {
      triggerRefresh();
    }
  };

  const triggerBackup = async () => {
    const res = await fetch('/api/security/backup', { method: 'POST' });
    const data = await res.json();
    if (res.ok) {
      setBackupInfo(`Snapshot created: ${data.fileName} (${data.bytes} bytes)`);
      triggerRefresh();
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthMsg(null);
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (res.ok) {
      localStorage.setItem('omnix_token', data.token);
      setUser(data.user);
      setPassword('');
      setAuthMsg(`Authenticated session issued for ${data.user.email} (${data.user.role}).`);
      triggerRefresh();
    } else {
      setAuthMsg(data.error || 'Authentication failed');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-800/80 pb-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-50">
            OMNI SECURITY — Approvals, RBAC & Audit Center
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Enforce human-in-the-loop approval for destructive actions, inspect immutable audit logs,
            and create SQLite database backups.
          </p>
        </div>

        <button
          type="button"
          onClick={() => void triggerBackup()}
          className="flex items-center gap-2 rounded-lg border border-slate-700 bg-[#111724] px-4 py-2 text-xs font-medium text-slate-200 hover:border-slate-500"
        >
          <DatabaseBackup className="h-3.5 w-3.5 text-sky-400" />
          <span>Create SQLite Backup</span>
        </button>
      </div>

      {backupInfo && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-950/20 px-4 py-2.5 font-mono text-xs text-emerald-200">
          {backupInfo}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* AI Action Approval Queue */}
        <section className="lg:col-span-7 rounded-xl border border-slate-800 bg-[#111724] p-5 space-y-3">
          <h2 className="font-display text-sm font-semibold text-slate-100 pb-2 border-b border-slate-800">
            AI Action Approval Queue ({approvals.filter((a) => a.status === 'pending').length} pending)
          </h2>
          {approvals.length === 0 ? (
            <p className="py-4 text-xs text-slate-500">
              No sensitive operations queued. Destructive directives or deletions automatically pause here.
            </p>
          ) : (
            <div className="divide-y divide-slate-800/70">
              {approvals.map((ap) => (
                <div key={ap.id} className="py-3 flex flex-wrap items-center justify-between gap-3 text-xs">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-slate-100">
                      {ap.action_type} · {ap.target_resource}
                    </p>
                    <p className="text-slate-400 mt-0.5">{ap.reason}</p>
                    <p className="font-mono text-slate-500 mt-0.5">
                      Requested by {ap.requested_by} · Status: {ap.status.toUpperCase()}
                    </p>
                  </div>

                  {ap.status === 'pending' && (
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => void decideApproval(ap.id, 'approved')}
                        className="flex items-center gap-1 rounded-md bg-emerald-500/20 px-3 py-1.5 font-medium text-emerald-200 hover:bg-emerald-500/30"
                      >
                        <Check className="h-3.5 w-3.5" />
                        <span>Approve</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => void decideApproval(ap.id, 'rejected')}
                        className="flex items-center gap-1 rounded-md bg-red-500/20 px-3 py-1.5 font-medium text-red-200 hover:bg-red-500/30"
                      >
                        <X className="h-3.5 w-3.5" />
                        <span>Reject</span>
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Session Authentication */}
        <section className="lg:col-span-5 rounded-xl border border-slate-800 bg-[#111724] p-5 space-y-3">
          <h2 className="font-display text-sm font-semibold text-slate-100 pb-2 border-b border-slate-800 flex items-center gap-2">
            <Lock className="h-4 w-4 text-sky-400" />
            <span>Operator Authentication</span>
          </h2>
          <form onSubmit={(e) => void handleLogin(e)} className="space-y-3 text-xs">
            <div>
              <label htmlFor="sec-email" className="block text-slate-400 mb-1">
                Email
              </label>
              <input
                id="sec-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-lg border border-slate-800 bg-[#0B0F17] px-3 py-2 text-slate-100"
              />
            </div>
            <div>
              <label htmlFor="sec-pass" className="block text-slate-400 mb-1">
                Password
              </label>
              <input
                id="sec-pass"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter operator password"
                className="w-full rounded-lg border border-slate-800 bg-[#0B0F17] px-3 py-2 text-slate-100"
              />
            </div>
            <button
              type="submit"
              className="w-full rounded-lg bg-sky-500 px-4 py-2 font-semibold text-slate-950 hover:bg-sky-400"
            >
              Authenticate Session
            </button>
            {authMsg && <p className="text-sky-300">{authMsg}</p>}
          </form>
        </section>

        {/* Audit Logs */}
        <section className="lg:col-span-12 rounded-xl border border-slate-800 bg-[#111724] p-5">
          <h2 className="font-display text-sm font-semibold text-slate-100 pb-3 border-b border-slate-800">
            Security & Operation Audit Logs ({auditLogs.length})
          </h2>
          <div className="mt-3 max-h-72 overflow-y-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400">
                  <th className="py-2 text-start">Action</th>
                  <th className="py-2 text-start">Resource</th>
                  <th className="py-2 text-start">Status</th>
                  <th className="py-2 text-end">Timestamp</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono">
                {auditLogs.map((log) => (
                  <tr key={log.id}>
                    <td className="py-2 text-slate-200">{log.action}</td>
                    <td className="py-2 text-slate-400">
                      {log.resource_type} {log.resource_id ? `(${log.resource_id})` : ''}
                    </td>
                    <td className="py-2 text-sky-300">{log.status}</td>
                    <td className="py-2 text-end tabular-nums text-slate-500">{log.created_at}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
