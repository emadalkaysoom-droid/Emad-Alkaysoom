import React, { useCallback, useEffect, useState } from 'react';
import { Check, CreditCard, Crown, Download, Lock, Receipt, ShieldAlert } from 'lucide-react';
import { useOmnix } from '../../contexts/OmnixContext';
import { apiFetch, getAuthHeaders } from '../../lib/apiClient';
import type { OmnixView, SubscriptionSummary } from '../../types/omnix';

const CATEGORY_VIEW_MAP: Record<string, OmnixView> = {
  Codex: 'codex',
  Genome: 'genome',
  Lab: 'lab',
  Radar: 'radar',
  Translator: 'translator',
  AutoBuild: 'autobuild',
  Agents: 'agents',
  Memory: 'memory',
  Automation: 'agents',
  Platform: 'billing',
};

export function BillingPremiumView() {
  const { language, refreshSession, triggerRefresh, setActiveView } = useOmnix();
  const isAr = language === 'ar';

  const [summary, setSummary] = useState<SubscriptionSummary | null>(null);
  const [payments, setPayments] = useState<Array<{ id: string; amount_usd: number; status: string; provider: string; payment_method_summary: string; created_at: string }>>([]);
  const [invoices, setInvoices] = useState<Array<{ id: string; invoice_number: string; amount_usd: number; status: string; created_at: string }>>([]);
  const [history, setHistory] = useState<Array<{ id: string; from_status: string; to_status: string; reason: string; created_at: string }>>([]);
  const [pendingCheckout, setPendingCheckout] = useState<{
    checkoutId: string;
    mode: string;
    notice: string;
    signedSampleWebhook?: { eventId: string; payload: string; signatureHeader: string };
  } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const loadBilling = useCallback(async () => {
    const res = await apiFetch('/api/billing/overview');
    if (res.ok) {
      const data = await res.json();
      setSummary(data.summary);
      setPayments(data.payments || []);
      setInvoices(data.invoices || []);
      setHistory(data.history || []);
    }
  }, []);

  useEffect(() => {
    void loadBilling();
  }, [loadBilling]);

  const initiateCheckout = async () => {
    setErr(null);
    setMsg(null);
    const res = await apiFetch('/api/billing/checkout', {
      method: 'POST',
      body: JSON.stringify({ mode: summary?.stripeConfigured ? 'stripe' : 'sandbox' }),
    });
    const data = await res.json();
    if (!res.ok) {
      setErr(data.error || 'Checkout error');
      return;
    }
    setPendingCheckout(data);
  };

  const deliverSignedWebhook = async () => {
    if (!pendingCheckout?.signedSampleWebhook) return;
    setErr(null);
    const res = await fetch('/api/billing/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-omnix-signature': pendingCheckout.signedSampleWebhook.signatureHeader,
      },
      body: pendingCheckout.signedSampleWebhook.payload,
    });
    const data = await res.json();
    if (!res.ok) {
      setErr(data.error || 'Webhook verification failed');
      return;
    }
    setMsg(`Signed HMAC Webhook accepted (${data.eventType}) -> Subscription ${data.subscriptionStatus}. Invoice generated.`);
    setPendingCheckout(null);
    await loadBilling();
    await refreshSession();
    triggerRefresh();
  };

  const runLifecycleAction = async (action: 'cancel' | 'expire_now' | 'refund' | 'fail_test', paymentId?: string) => {
    setErr(null);
    const res = await apiFetch('/api/billing/subscription/action', {
      method: 'POST',
      body: JSON.stringify({ action, paymentId }),
    });
    const data = await res.json();
    if (!res.ok) {
      setErr(data.error || 'Action failed');
      return;
    }
    setMsg(`Subscription transition completed: ${data.subscriptionStatus}`);
    await loadBilling();
    await refreshSession();
    triggerRefresh();
  };

  const downloadInvoice = async (invoiceId: string, invoiceNum: string) => {
    const res = await fetch(`/api/billing/invoices/${encodeURIComponent(invoiceId)}/download`, {
      headers: getAuthHeaders(),
    });
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${invoiceNum}.html`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-4">
        <div>
          <h1 className="font-display text-xl font-bold text-slate-100 flex items-center gap-2">
            <Crown className="h-5 w-5 text-amber-400" />
            <span>OMNIX PREMIUM · {isAr ? 'الاشتراك الاحترافي والامتيازات العشرة ($5 / 3 أشهر)' : 'Pro Membership ($5 USD / 3 Months)'}</span>
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            {isAr
              ? 'إدارة خطط Free وPremium، بوابة الدفع والتحقق الرقمي HMAC Webhooks، الفواتير القابلة للتنزيل، وفتح الامتيازات العشرة الحصرية.'
              : 'Free vs $5 USD / 90-day Premium tier · HMAC-signed webhook billing state machine · Invoices · 10 Exclusive Intelligence Entitlements.'}
          </p>
        </div>

        <div className="font-mono text-xs text-slate-300">
          Gateway: {summary?.stripeConfigured ? 'Stripe Live Key Configured' : '[SANDBOX TEST BILLING] (No real card stored)'}
        </div>
      </div>

      {msg && <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-4 py-2 text-xs text-emerald-200">{msg}</div>}
      {err && <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-4 py-2 text-xs text-rose-200">{err}</div>}

      {/* Plan Comparison & Current Subscription State */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 text-xs">
        <div className="rounded-lg border border-slate-800 bg-[#0F141F] p-4 space-y-2.5">
          <div className="text-slate-400 uppercase font-semibold tracking-wider">Free Plan · $0</div>
          <div className="text-lg font-bold text-slate-100">Core Multimodal OS</div>
          <ul className="space-y-1.5 text-slate-300 pt-1">
            <li>· OMNI BRAIN Assistant & Memory Basics</li>
            <li>· OMNI VISION, VOICE, 3D & Simulation</li>
            <li>· Basic Codex File Scan & Lab Physics</li>
            <li>· Up to 5 Workspace Projects</li>
          </ul>
        </div>

        <div className="rounded-lg border border-sky-500/40 bg-[#0F141F] p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sky-300 uppercase font-semibold tracking-wider">OMNIX PREMIUM</span>
            <span className="font-mono font-bold text-amber-300 text-sm">$5.00 USD / 90 Days</span>
          </div>
          <div className="text-xs text-slate-300">
            Status: <span className="font-mono font-bold text-white">{summary?.status || 'FREE'}</span>
            {summary?.expirationDate && (
              <span className="ms-2 text-slate-400">· Expires {summary.expirationDate.slice(0, 10)}</span>
            )}
          </div>
          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="button"
              onClick={() => void initiateCheckout()}
              className="flex items-center gap-1.5 rounded bg-sky-600 px-3.5 py-2 font-semibold text-white hover:bg-sky-500"
            >
              <CreditCard className="h-3.5 w-3.5" />
              <span>{summary?.isPremiumActive ? 'Renew / Extend 90 Days ($5)' : 'Upgrade to Premium ($5 / 3mo)'}</span>
            </button>
            {summary?.isPremiumActive && (
              <>
                <button
                  type="button"
                  onClick={() => void runLifecycleAction('cancel')}
                  className="rounded border border-slate-700 px-3 py-2 text-slate-300 hover:bg-slate-800"
                >
                  Cancel Auto-Renew
                </button>
                <button
                  type="button"
                  onClick={() => void runLifecycleAction('expire_now')}
                  className="rounded border border-amber-500/40 px-3 py-2 text-amber-300 hover:bg-amber-500/10"
                >
                  Test Expiry Downgrade
                </button>
              </>
            )}
          </div>
        </div>

        <div className="rounded-lg border border-slate-800 bg-[#0F141F] p-4 space-y-2">
          <div className="font-semibold text-slate-200 flex items-center gap-1.5">
            <ShieldAlert className="h-4 w-4 text-sky-400" />
            <span>Active Quotas & Security Guarantee</span>
          </div>
          <div className="grid grid-cols-2 gap-2 pt-1 font-mono">
            <div>Projects: {summary?.quotas.projects ?? 5}</div>
            <div>Codex/day: {summary?.quotas.codexRunsPerDay ?? 10}</div>
            <div>Lab Runs: {summary?.quotas.labExperiments ?? 10}</div>
            <div>AutoBuild: {summary?.quotas.autobuildApps ?? 1}</div>
          </div>
          <p className="text-[11px] text-slate-400 pt-1">
            Zero raw card numbers or CVVs stored. Activation happens strictly after server-side HMAC webhook signature & idempotency verification.
          </p>
        </div>
      </div>

      {pendingCheckout && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 space-y-2 text-xs">
          <div className="font-semibold text-amber-200">
            Checkout Session Prepared ({pendingCheckout.checkoutId}) · {pendingCheckout.mode}
          </div>
          <p className="text-amber-100/80">{pendingCheckout.notice}</p>
          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="button"
              onClick={() => void deliverSignedWebhook()}
              className="rounded bg-emerald-600 px-3.5 py-1.5 font-semibold text-white hover:bg-emerald-500"
            >
              Verify & Deliver Signed Webhook (payment_succeeded)
            </button>
            <button
              type="button"
              onClick={() => void runLifecycleAction('fail_test')}
              className="rounded border border-rose-500/40 px-3 py-1.5 text-rose-300"
            >
              Simulate Payment Failure
            </button>
          </div>
        </div>
      )}

      {/* All 10 Exclusive Premium Entitlements */}
      <div className="rounded-lg border border-slate-800 bg-[#0F141F] p-4">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">
          {isAr ? 'الامتيازات الحصرية العشرة لمشتركي OMNIX PREMIUM' : '10 Exclusive Premium Entitlements'}
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
          {(summary?.allEntitlements || []).map((ent, idx) => (
            <div key={ent.feature_key} className="flex items-start justify-between gap-3 border-b border-slate-800/80 pb-2.5">
              <div>
                <div className="font-semibold text-slate-100 flex items-center gap-1.5">
                  <span className="font-mono text-slate-500">{String(idx + 1).padStart(2, '0')}</span>
                  <span>{isAr ? ent.title_ar : ent.title}</span>
                </div>
                <p className="text-[11px] text-slate-400 mt-0.5">{isAr ? ent.description_ar : ent.description}</p>
              </div>
              <div className="flex flex-col items-end gap-1 shrink-0">
                <span className={`flex items-center gap-1 font-mono text-[11px] ${ent.unlocked ? 'text-emerald-400' : 'text-slate-500'}`}>
                  {ent.unlocked ? <Check className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
                  <span>{ent.unlocked ? 'UNLOCKED' : 'LOCKED'}</span>
                </span>
                <button
                  type="button"
                  onClick={() => setActiveView(CATEGORY_VIEW_MAP[ent.category] || 'home')}
                  className="text-[11px] text-sky-400 hover:underline"
                >
                  Open {ent.category}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Invoices, Payments, and Subscription State History */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 text-xs">
        <div className="rounded-lg border border-slate-800 bg-[#0F141F] p-4 space-y-2">
          <h2 className="font-semibold text-slate-200 flex items-center gap-1.5">
            <Receipt className="h-4 w-4 text-sky-400" />
            <span>Invoices & Payments</span>
          </h2>
          {invoices.length === 0 && payments.length === 0 ? (
            <p className="text-slate-400">No payment or invoice records yet.</p>
          ) : (
            <div className="divide-y divide-slate-800/80">
              {invoices.map((inv) => (
                <div key={inv.id} className="flex items-center justify-between py-2">
                  <div>
                    <span className="font-mono text-slate-100">{inv.invoice_number}</span>
                    <span className="ms-2 text-slate-400">${inv.amount_usd.toFixed(2)} · {inv.status}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => void downloadInvoice(inv.id, inv.invoice_number)}
                    className="flex items-center gap-1 text-sky-400 hover:underline"
                  >
                    <Download className="h-3 w-3" />
                    <span>HTML Invoice</span>
                  </button>
                </div>
              ))}
              {payments.map((p) => (
                <div key={p.id} className="flex items-center justify-between py-2 text-[11px]">
                  <span className="font-mono text-slate-300">{p.id} · ${p.amount_usd.toFixed(2)} · {p.status}</span>
                  {p.status === 'succeeded' && (
                    <button
                      type="button"
                      onClick={() => void runLifecycleAction('refund', p.id)}
                      className="text-rose-300 hover:underline"
                    >
                      Test Refund
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-lg border border-slate-800 bg-[#0F141F] p-4 space-y-2">
          <h2 className="font-semibold text-slate-200">Subscription Transition Audit</h2>
          <div className="divide-y divide-slate-800/80 max-h-56 overflow-y-auto">
            {history.length === 0 ? (
              <p className="text-slate-400">No status changes recorded yet.</p>
            ) : (
              history.map((h) => (
                <div key={h.id} className="py-2">
                  <div className="font-mono text-slate-200">{h.from_status} → {h.to_status}</div>
                  <div className="text-[11px] text-slate-400">{h.reason} · {h.created_at}</div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
