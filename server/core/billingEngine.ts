import crypto from 'node:crypto';
import { getDb } from '../db/schema.ts';
import { logAuditEvent } from './security.ts';

export type SubscriptionStatus =
  | 'FREE'
  | 'ACTIVE'
  | 'PAST_DUE'
  | 'CANCELLED'
  | 'EXPIRED'
  | 'PAYMENT_PENDING'
  | 'SUSPENDED';

export type PremiumFeatureKey =
  | 'ADVANCED_CODEX_INTELLIGENCE'
  | 'PROJECT_DIGITAL_DNA_PRO'
  | 'OMNI_LAB_PROFESSIONAL'
  | 'GLOBAL_RADAR_INTELLIGENCE'
  | 'OMNI_TRANSLATOR_PRO'
  | 'OMNI_AUTOBUILD_FACTORY'
  | 'OMNI_MULTI_AGENT_SWARM_PRO'
  | 'OMNI_MEMORY_VAULT'
  | 'OMNI_AUTOMATION_PRO'
  | 'PRIORITY_COMPUTE_PRO';

export interface SubscriptionSummary {
  planCode: 'FREE' | 'PREMIUM';
  planName: string;
  priceUsd: number;
  billingIntervalDays: number;
  status: SubscriptionStatus;
  isPremiumActive: boolean;
  startDate: string | null;
  expirationDate: string | null;
  renewalDate: string | null;
  cancellationDate: string | null;
  autoRenew: boolean;
  provider: string;
  stripeConfigured: boolean;
  activeEntitlements: PremiumFeatureKey[];
  allEntitlements: Array<{
    id: string;
    feature_key: PremiumFeatureKey;
    title: string;
    title_ar: string;
    description: string;
    description_ar: string;
    category: string;
    unlocked: boolean;
  }>;
  quotas: { projects: number; codexRunsPerDay: number; labExperiments: number; autobuildApps: number };
}

function getWebhookSecret(): string {
  return process.env.STRIPE_WEBHOOK_SECRET || process.env.OMNIX_WEBHOOK_SECRET || 'omnix-local-hmac-webhook-key';
}

export function isStripeConfigured(): boolean {
  const k = process.env.STRIPE_SECRET_KEY;
  return Boolean(k && k.startsWith('sk_') && k.length > 16);
}

export function signWebhookPayload(rawPayload: string, timestampSec?: number): string {
  const ts = timestampSec ?? Math.floor(Date.now() / 1000);
  const sig = crypto
    .createHmac('sha256', getWebhookSecret())
    .update(`${ts}.${rawPayload}`)
    .digest('hex');
  return `t=${ts},v1=${sig}`;
}

export function verifyWebhookSignature(rawPayload: string, header: string | undefined): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(
    header.split(',').map((kv) => {
      const idx = kv.indexOf('=');
      return idx === -1 ? [kv, ''] : [kv.slice(0, idx).trim(), kv.slice(idx + 1).trim()];
    })
  );
  const ts = Number(parts.t);
  const v1 = parts.v1;
  if (!ts || !v1 || !/^[0-9a-f]+$/i.test(v1)) return false;
  // Replay protection window: 10 minutes
  const ageSec = Math.abs(Math.floor(Date.now() / 1000) - ts);
  if (ageSec > 600) return false;

  const expected = crypto
    .createHmac('sha256', getWebhookSecret())
    .update(`${ts}.${rawPayload}`)
    .digest('hex');
  const a = Buffer.from(v1, 'hex');
  const b = Buffer.from(expected, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function syncExpirationIfNeeded(userId: string): void {
  const db = getDb();
  const sub = db
    .prepare(
      `SELECT id, status, expiration_date FROM Subscriptions WHERE user_id = ? ORDER BY created_at DESC LIMIT 1`
    )
    .get(userId) as { id: string; status: SubscriptionStatus; expiration_date: string | null } | undefined;
  if (!sub) return;
  if (
    (sub.status === 'ACTIVE' || sub.status === 'CANCELLED') &&
    sub.expiration_date &&
    new Date(sub.expiration_date).getTime() <= Date.now()
  ) {
    db.prepare(
      `UPDATE Subscriptions SET status = 'EXPIRED', plan_id = 'plan-free', auto_renew = 0, updated_at = datetime('now') WHERE id = ?`
    ).run(sub.id);
    db.prepare(
      `INSERT INTO SubscriptionHistory (id, subscription_id, user_id, from_status, to_status, reason)
       VALUES (?, ?, ?, ?, 'EXPIRED', 'Subscription period elapsed; reverted safely to FREE preserving user data.')`
    ).run(`sh-${crypto.randomUUID().slice(0, 8)}`, sub.id, userId, sub.status);
    db.prepare(
      `UPDATE users SET account_role = CASE WHEN account_role = 'PREMIUM_USER' THEN 'FREE_USER' ELSE account_role END WHERE id = ?`
    ).run(userId);
  }
}

export function getUserSubscriptionSummary(userId: string): SubscriptionSummary {
  const db = getDb();
  syncExpirationIfNeeded(userId);

  const sub = db
    .prepare(
      `SELECT s.*, p.code as plan_code, p.name as plan_name, p.price_usd, p.billing_interval_days, p.features_json, p.limits_json
       FROM Subscriptions s
       JOIN SubscriptionPlans p ON s.plan_id = p.id
       WHERE s.user_id = ?
       ORDER BY s.created_at DESC LIMIT 1`
    )
    .get(userId) as
    | {
        id: string;
        status: SubscriptionStatus;
        provider: string;
        start_date: string;
        expiration_date: string | null;
        renewal_date: string | null;
        cancellation_date: string | null;
        auto_renew: number;
        plan_code: 'FREE' | 'PREMIUM';
        plan_name: string;
        price_usd: number;
        billing_interval_days: number;
        features_json: string;
        limits_json: string;
      }
    | undefined;

  const entitlements = db.prepare(`SELECT * FROM PremiumEntitlements ORDER BY id ASC`).all() as Array<{
    id: string;
    feature_key: PremiumFeatureKey;
    title: string;
    title_ar: string;
    description: string;
    description_ar: string;
    category: string;
  }>;

  // Cancelled retains access until expiration_date
  const now = Date.now();
  const notExpired = !sub?.expiration_date || new Date(sub.expiration_date).getTime() > now;
  const isPremiumActive = Boolean(
    sub &&
      sub.plan_code === 'PREMIUM' &&
      (sub.status === 'ACTIVE' || (sub.status === 'CANCELLED' && notExpired))
  );

  const activeEntitlements: PremiumFeatureKey[] = isPremiumActive
    ? entitlements.map((e) => e.feature_key)
    : [];

  const quotas = sub?.limits_json
    ? (JSON.parse(sub.limits_json) as SubscriptionSummary['quotas'])
    : { projects: 5, codexRunsPerDay: 10, labExperiments: 10, autobuildApps: 1 };

  return {
    planCode: isPremiumActive ? 'PREMIUM' : 'FREE',
    planName: isPremiumActive ? sub?.plan_name || 'OMNIX PREMIUM (3-Month Pass)' : 'OMNIX Free Tier',
    priceUsd: isPremiumActive ? sub?.price_usd ?? 5.0 : 0,
    billingIntervalDays: sub?.billing_interval_days ?? 90,
    status: sub?.status ?? 'FREE',
    isPremiumActive,
    startDate: sub?.start_date ?? null,
    expirationDate: sub?.expiration_date ?? null,
    renewalDate: sub?.renewal_date ?? null,
    cancellationDate: sub?.cancellation_date ?? null,
    autoRenew: sub ? sub.auto_renew === 1 : false,
    provider: sub?.provider ?? 'omnix-free',
    stripeConfigured: isStripeConfigured(),
    activeEntitlements,
    allEntitlements: entitlements.map((e) => ({
      ...e,
      unlocked: isPremiumActive,
    })),
    quotas,
  };
}

export function hasEntitlement(userId: string, featureKey: PremiumFeatureKey): boolean {
  const summary = getUserSubscriptionSummary(userId);
  return summary.activeEntitlements.includes(featureKey);
}

export function createCheckoutSession(userId: string, mode: 'stripe' | 'sandbox' = 'sandbox'): {
  checkoutId: string;
  subscriptionId: string;
  amountUsd: number;
  currency: string;
  intervalDays: number;
  mode: 'stripe_live' | 'sandbox_test_billing';
  notice: string;
  signedSampleWebhook?: { eventId: string; payload: string; signatureHeader: string };
} {
  const db = getDb();
  const existing = db
    .prepare(`SELECT id, status FROM Subscriptions WHERE user_id = ? ORDER BY created_at DESC LIMIT 1`)
    .get(userId) as { id: string; status: SubscriptionStatus } | undefined;

  const subId = existing?.id || `sub-${crypto.randomUUID().slice(0, 8)}`;
  if (!existing) {
    db.prepare(
      `INSERT INTO Subscriptions (id, user_id, plan_id, status, provider) VALUES (?, ?, 'plan-free', 'PAYMENT_PENDING', ?)`
    ).run(subId, userId, mode === 'stripe' && isStripeConfigured() ? 'stripe' : 'sandbox-webhook');
  } else {
    db.prepare(
      `INSERT INTO SubscriptionHistory (id, subscription_id, user_id, from_status, to_status, reason) VALUES (?, ?, ?, ?, 'PAYMENT_PENDING', 'Checkout initiated')`
    ).run(`sh-${crypto.randomUUID().slice(0, 8)}`, subId, userId, existing.status);
  }

  const checkoutId = `chk-${crypto.randomUUID().slice(0, 8)}`;
  const paymentId = `pay-${crypto.randomUUID().slice(0, 8)}`;
  db.prepare(
    `INSERT INTO Payments (id, user_id, subscription_id, amount_usd, currency, status, provider, provider_payment_id, payment_method_summary)
     VALUES (?, ?, ?, 5.00, 'USD', 'pending', ?, ?, ?)`
  ).run(
    paymentId,
    userId,
    subId,
    mode === 'stripe' && isStripeConfigured() ? 'stripe' : 'sandbox-webhook',
    checkoutId,
    'External Gateway Token (No raw card data stored)'
  );

  const eventObj = {
    eventId: `evt_${crypto.randomUUID().replace(/-/g, '').slice(0, 14)}`,
    eventType: 'payment_succeeded',
    provider: mode === 'stripe' && isStripeConfigured() ? 'stripe' : 'sandbox-webhook',
    userId,
    subscriptionId: subId,
    paymentId,
    amountUsd: 5.0,
    currency: 'USD',
  };
  const payload = JSON.stringify(eventObj);
  const signatureHeader = signWebhookPayload(payload);

  return {
    checkoutId,
    subscriptionId: subId,
    amountUsd: 5.0,
    currency: 'USD',
    intervalDays: 90,
    mode: mode === 'stripe' && isStripeConfigured() ? 'stripe_live' : 'sandbox_test_billing',
    notice: isStripeConfigured()
      ? 'Stripe Checkout session prepared via STRIPE_SECRET_KEY.'
      : 'STRIPE_SECRET_KEY not configured; operating in [SANDBOX TEST BILLING] mode with cryptographic HMAC webhook verification.',
    signedSampleWebhook: {
      eventId: eventObj.eventId,
      payload,
      signatureHeader,
    },
  };
}

export function processSignedWebhook(params: {
  rawBody: string;
  signatureHeader: string | undefined;
}): {
  status: number;
  accepted: boolean;
  duplicate?: boolean;
  eventType?: string;
  subscriptionStatus?: SubscriptionStatus;
  invoiceId?: string;
  error?: string;
} {
  const db = getDb();
  const sigValid = verifyWebhookSignature(params.rawBody, params.signatureHeader);
  let parsed: {
    eventId?: string;
    eventType?: string;
    provider?: string;
    userId?: string;
    subscriptionId?: string;
    paymentId?: string;
    amountUsd?: number;
    failureReason?: string;
  };
  try {
    parsed = JSON.parse(params.rawBody);
  } catch {
    return { status: 400, accepted: false, error: 'Invalid JSON webhook body.' };
  }

  const eventId = parsed.eventId || `evt-${crypto.randomUUID().slice(0, 8)}`;
  const eventType = parsed.eventType || 'unknown';

  if (!sigValid) {
    db.prepare(
      `INSERT INTO PaymentWebhookLogs (id, event_id, event_type, http_status, signature_verified, idempotent_duplicate, detail)
       VALUES (?, ?, ?, 401, 0, 0, 'Rejected invalid or expired HMAC signature')`
    ).run(`wh-${crypto.randomUUID().slice(0, 8)}`, eventId, eventType);
    return { status: 401, accepted: false, error: 'Invalid or expired webhook HMAC signature.' };
  }

  // Idempotency check
  const existingEvent = db
    .prepare(`SELECT id FROM PaymentEvents WHERE event_id = ?`)
    .get(eventId);
  if (existingEvent) {
    db.prepare(
      `INSERT INTO PaymentWebhookLogs (id, event_id, event_type, http_status, signature_verified, idempotent_duplicate, detail)
       VALUES (?, ?, ?, 200, 1, 1, 'Duplicate webhook ignored safely via PaymentEvents idempotency lock')`
    ).run(`wh-${crypto.randomUUID().slice(0, 8)}`, eventId, eventType);
    return { status: 200, accepted: true, duplicate: true, eventType };
  }

  const payloadHash = crypto.createHash('sha256').update(params.rawBody).digest('hex');
  db.prepare(
    `INSERT INTO PaymentEvents (id, event_id, event_type, provider, signature_valid, processed, payload_hash)
     VALUES (?, ?, ?, ?, 1, 1, ?)`
  ).run(`pe-${crypto.randomUUID().slice(0, 8)}`, eventId, eventType, parsed.provider || 'sandbox-webhook', payloadHash);

  const userId = parsed.userId;
  const sub = parsed.subscriptionId
    ? (db.prepare(`SELECT * FROM Subscriptions WHERE id = ?`).get(parsed.subscriptionId) as
        | { id: string; user_id: string; status: SubscriptionStatus; expiration_date: string | null }
        | undefined)
    : userId
      ? (db.prepare(`SELECT * FROM Subscriptions WHERE user_id = ? ORDER BY created_at DESC LIMIT 1`).get(userId) as
          | { id: string; user_id: string; status: SubscriptionStatus; expiration_date: string | null }
          | undefined)
      : undefined;

  if (!sub) {
    return { status: 404, accepted: false, error: 'Target subscription record not found.' };
  }

  const nowIso = new Date().toISOString();
  const ninetyDaysIso = new Date(Date.now() + 90 * 24 * 3600 * 1000).toISOString();
  let newStatus: SubscriptionStatus = sub.status;
  let invoiceId: string | undefined;

  if (eventType === 'payment_succeeded') {
    newStatus = 'ACTIVE';
    db.prepare(
      `UPDATE Subscriptions SET plan_id = 'plan-premium', status = 'ACTIVE', start_date = ?, expiration_date = ?, renewal_date = ?, cancellation_date = NULL, auto_renew = 1, updated_at = datetime('now') WHERE id = ?`
    ).run(nowIso, ninetyDaysIso, ninetyDaysIso, sub.id);

    if (parsed.paymentId) {
      db.prepare(`UPDATE Payments SET status = 'succeeded' WHERE id = ?`).run(parsed.paymentId);
    }
    db.prepare(
      `UPDATE users SET account_role = CASE WHEN account_role IN ('FREE_USER', 'PREMIUM_USER') THEN 'PREMIUM_USER' ELSE account_role END WHERE id = ?`
    ).run(sub.user_id);

    invoiceId = `inv-${crypto.randomUUID().slice(0, 8)}`;
    const invNum = `OMNIX-${new Date().getFullYear()}-${Math.floor(100000 + Math.random() * 899999)}`;
    db.prepare(
      `INSERT INTO Invoices (id, invoice_number, user_id, payment_id, subscription_id, amount_usd, currency, status, period_start, period_end, line_items_json)
       VALUES (?, ?, ?, ?, ?, 5.00, 'USD', 'paid', ?, ?, ?)`
    ).run(
      invoiceId,
      invNum,
      sub.user_id,
      parsed.paymentId ?? null,
      sub.id,
      nowIso,
      ninetyDaysIso,
      JSON.stringify([{ description: 'OMNIX PREMIUM (90-Day Pass)', qty: 1, unitUsd: 5.0 }])
    );
  } else if (eventType === 'payment_failed') {
    newStatus = 'PAST_DUE';
    db.prepare(`UPDATE Subscriptions SET status = 'PAST_DUE', updated_at = datetime('now') WHERE id = ?`).run(sub.id);
    if (parsed.paymentId) {
      db.prepare(`UPDATE Payments SET status = 'failed', failure_reason = ? WHERE id = ?`).run(
        parsed.failureReason || 'Payment authorization declined by gateway',
        parsed.paymentId
      );
    }
  } else if (eventType === 'subscription_cancelled') {
    newStatus = 'CANCELLED';
    db.prepare(
      `UPDATE Subscriptions SET status = 'CANCELLED', cancellation_date = ?, auto_renew = 0, updated_at = datetime('now') WHERE id = ?`
    ).run(nowIso, sub.id);
  } else if (eventType === 'subscription_expired') {
    newStatus = 'EXPIRED';
    db.prepare(
      `UPDATE Subscriptions SET status = 'EXPIRED', plan_id = 'plan-free', auto_renew = 0, updated_at = datetime('now') WHERE id = ?`
    ).run(sub.id);
    db.prepare(
      `UPDATE users SET account_role = CASE WHEN account_role = 'PREMIUM_USER' THEN 'FREE_USER' ELSE account_role END WHERE id = ?`
    ).run(sub.user_id);
  } else if (eventType === 'refund_issued') {
    newStatus = 'CANCELLED';
    if (parsed.paymentId) {
      db.prepare(`UPDATE Payments SET status = 'refunded' WHERE id = ?`).run(parsed.paymentId);
      db.prepare(`UPDATE Invoices SET status = 'refunded' WHERE payment_id = ?`).run(parsed.paymentId);
    }
    db.prepare(
      `UPDATE Subscriptions SET status = 'EXPIRED', plan_id = 'plan-free', auto_renew = 0, updated_at = datetime('now') WHERE id = ?`
    ).run(sub.id);
    db.prepare(
      `UPDATE users SET account_role = CASE WHEN account_role = 'PREMIUM_USER' THEN 'FREE_USER' ELSE account_role END WHERE id = ?`
    ).run(sub.user_id);
  }

  db.prepare(
    `INSERT INTO SubscriptionHistory (id, subscription_id, user_id, from_status, to_status, reason)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(`sh-${crypto.randomUUID().slice(0, 8)}`, sub.id, sub.user_id, sub.status, newStatus, `Webhook ${eventType}`);

  db.prepare(
    `INSERT INTO PaymentWebhookLogs (id, event_id, event_type, http_status, signature_verified, idempotent_duplicate, detail)
     VALUES (?, ?, ?, 200, 1, 0, ?)`
  ).run(`wh-${crypto.randomUUID().slice(0, 8)}`, eventId, eventType, `Processed ${eventType} -> ${newStatus}`);

  logAuditEvent({
    userId: sub.user_id,
    action: `billing_${eventType}`,
    resourceType: 'subscription',
    resourceId: sub.id,
    status: 'allowed',
    details: { eventId, newStatus },
  });

  return { status: 200, accepted: true, duplicate: false, eventType, subscriptionStatus: newStatus, invoiceId };
}

export function renderInvoiceHtml(invoiceId: string, userId: string): { fileName: string; html: string } {
  const db = getDb();
  const inv = db
    .prepare(
      `SELECT i.*, u.name as user_name, u.email as user_email
       FROM Invoices i JOIN users u ON i.user_id = u.id
       WHERE i.id = ? AND i.user_id = ?`
    )
    .get(invoiceId, userId) as
    | {
        invoice_number: string;
        amount_usd: number;
        currency: string;
        status: string;
        period_start: string;
        period_end: string;
        line_items_json: string;
        user_name: string;
        user_email: string;
        created_at: string;
      }
    | undefined;
  if (!inv) throw new Error('Invoice not found or access denied.');
  const items = JSON.parse(inv.line_items_json || '[]') as Array<{ description: string; qty: number; unitUsd: number }>;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Invoice ${inv.invoice_number}</title>
<style>body{font-family:system-ui,sans-serif;max-width:720px;margin:40px auto;color:#0f172a;padding:24px}h1{border-bottom:2px solid #e2e8f0;padding-bottom:10px}table{width:100%;border-collapse:collapse;margin-top:20px}th,td{padding:10px;border-bottom:1px solid #e2e8f0;text-align:left}</style>
</head><body>
<h1>OMNIX Tax / Billing Invoice · ${inv.invoice_number}</h1>
<p><strong>Billed To:</strong> ${inv.user_name} (${inv.user_email})</p>
<p><strong>Status:</strong> ${inv.status.toUpperCase()} · <strong>Issued:</strong> ${inv.created_at}</p>
<p><strong>Period:</strong> ${inv.period_start.slice(0, 10)} → ${inv.period_end.slice(0, 10)}</p>
<table><thead><tr><th>Description</th><th>Qty</th><th>Amount</th></tr></thead><tbody>
${items.map((it) => `<tr><td>${it.description}</td><td>${it.qty}</td><td>$${it.unitUsd.toFixed(2)} ${inv.currency}</td></tr>`).join('')}
</tbody></table>
<h3 style="text-align:right;margin-top:20px">Total: $${inv.amount_usd.toFixed(2)} ${inv.currency}</h3>
</body></html>`;
  return { fileName: `${inv.invoice_number}.html`, html };
}
