import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Isolate SQLite DB in OS temp directory for OMNIX ID & Billing verification
const tmpDbPath = path.join(os.tmpdir(), `omnix-id-billing-${Date.now()}.db`);
process.env.OMNIX_DB_PATH = tmpDbPath;

import { getDb, closeDb } from '../server/db/schema.ts';
import {
  validatePasswordStrength,
  registerOmnixUser,
  loginOmnixUser,
  verifyEmailWithToken,
  initiatePasswordReset,
  completePasswordReset,
  generateTotpSecret,
  computeTotpCode,
  verifyTotpCode,
  listUserSessions,
  revokeSession,
} from '../server/core/authService.ts';
import {
  getUserSubscriptionSummary,
  hasEntitlement,
  createCheckoutSession,
  signWebhookPayload,
  verifyWebhookSignature,
  processSignedWebhook,
  renderInvoiceHtml,
} from '../server/core/billingEngine.ts';
import { createAutoBuildProject } from '../server/core/autobuildService.ts';

test.after(() => {
  closeDb();
  if (fs.existsSync(tmpDbPath)) fs.unlinkSync(tmpDbPath);
});

test('SQLite schema contains all 8 required OMNIX PREMIUM & billing tables and 10 seeded entitlements', () => {
  const db = getDb();
  const tables = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`)
    .all() as Array<{ name: string }>;
  const names = new Set(tables.map((t) => t.name));

  for (const required of [
    'SubscriptionPlans',
    'Subscriptions',
    'Payments',
    'Invoices',
    'PaymentEvents',
    'SubscriptionHistory',
    'PremiumEntitlements',
    'PaymentWebhookLogs',
    'codex_analyses',
    'genome_snapshots',
    'lab_experiments',
    'radar_monitors',
    'translator_jobs',
    'autobuild_projects',
    'memory_rules',
    'automation_workflows',
  ]) {
    assert.ok(names.has(required), `Missing required table: ${required}`);
  }

  const entitlements = db.prepare(`SELECT COUNT(*) as c FROM PremiumEntitlements`).get() as { c: number };
  assert.equal(entitlements.c, 10);

  const premiumPlan = db
    .prepare(`SELECT price_usd, billing_interval_days FROM SubscriptionPlans WHERE code = 'PREMIUM'`)
    .get() as { price_usd: number; billing_interval_days: number };
  assert.equal(premiumPlan.price_usd, 5.0);
  assert.equal(premiumPlan.billing_interval_days, 90);
});

test('OMNIX ID validates strong passwords, prevents duplicates, verifies email, resets passwords, and enforces TOTP 2FA', () => {
  assert.equal(validatePasswordStrength('weak').valid, false);
  assert.equal(validatePasswordStrength('StrongPass#2026').valid, true);

  const reg = registerOmnixUser({
    fullName: 'Layla Al-Mansoor',
    username: 'layla_arch',
    email: 'layla@example.com',
    password: 'OmnixUser#2026!',
    confirmPassword: 'OmnixUser#2026!',
    country: 'AE',
    preferredLanguage: 'ar',
    termsAccepted: true,
    ipAddress: '10.10.0.5',
  });

  assert.equal(reg.user.account_role, 'FREE_USER');
  assert.equal(reg.user.email_verified, 0);
  assert.ok(reg.verificationToken.startsWith('vrf-'));

  // Duplicate email/username blocked
  assert.throws(() =>
    registerOmnixUser({
      fullName: 'Duplicate User',
      username: 'layla_arch',
      email: 'layla@example.com',
      password: 'OmnixUser#2026!',
      confirmPassword: 'OmnixUser#2026!',
      termsAccepted: true,
    })
  );

  // Verify email token
  assert.equal(verifyEmailWithToken(reg.user.id, 'wrong-tok'), false);
  assert.equal(verifyEmailWithToken(reg.user.id, reg.verificationToken), true);

  // TOTP 2FA check
  const secret = generateTotpSecret();
  const code = computeTotpCode(secret);
  assert.equal(verifyTotpCode(secret, code), true);
  assert.equal(verifyTotpCode(secret, '000000'), false);

  // Password reset revokes active sessions
  const resetInfo = initiatePasswordReset('layla@example.com');
  assert.ok(resetInfo.resetToken.startsWith('rst-'));
  completePasswordReset('layla@example.com', resetInfo.resetToken, 'NewStrong#2026!');

  const activeAfterReset = listUserSessions(reg.user.id) as Array<{ revoked_at: string | null }>;
  assert.ok(activeAfterReset.every((s) => s.revoked_at !== null));

  // New password logs in cleanly + detects new IP alert
  const login = loginOmnixUser({
    identifier: 'layla_arch',
    password: 'NewStrong#2026!',
    ipAddress: '192.168.1.44',
  });
  assert.ok(login.suspiciousAlert?.includes('192.168.1.44'));
  assert.equal(revokeSession(reg.user.id, login.token, false), 1);
});

test('OMNIX PREMIUM enforces FREE tier gating, verifies HMAC webhooks w/ idempotency, keeps cancelled access until expiry, and preserves data on expiration', () => {
  const reg = registerOmnixUser({
    fullName: 'Omar Engineer',
    username: 'omar_eng',
    email: 'omar@example.com',
    password: 'OmarSecure#2026!',
    confirmPassword: 'OmarSecure#2026!',
    termsAccepted: true,
  });

  // 1. Free user starts locked out of all 10 premium entitlements
  let summary = getUserSubscriptionSummary(reg.user.id);
  assert.equal(summary.planCode, 'FREE');
  assert.equal(summary.isPremiumActive, false);
  assert.equal(summary.activeEntitlements.length, 0);
  assert.equal(hasEntitlement(reg.user.id, 'OMNI_AUTOBUILD_FACTORY'), false);

  // 2. Initiate checkout -> sandbox/webhook payload signed with HMAC
  const checkout = createCheckoutSession(reg.user.id, 'sandbox');
  assert.equal(checkout.amountUsd, 5.0);
  assert.equal(checkout.intervalDays, 90);
  assert.ok(checkout.signedSampleWebhook);

  // 3. Reject forged webhook signature
  const forged = processSignedWebhook({
    rawBody: checkout.signedSampleWebhook!.payload,
    signatureHeader: 't=9999999999,v1=deadbeef',
  });
  assert.equal(forged.status, 401);
  assert.equal(forged.accepted, false);

  // 4. Valid HMAC signature activates subscription & issues invoice
  assert.equal(
    verifyWebhookSignature(checkout.signedSampleWebhook!.payload, checkout.signedSampleWebhook!.signatureHeader),
    true
  );
  const activation = processSignedWebhook({
    rawBody: checkout.signedSampleWebhook!.payload,
    signatureHeader: checkout.signedSampleWebhook!.signatureHeader,
  });
  assert.equal(activation.status, 200);
  assert.equal(activation.accepted, true);
  assert.equal(activation.duplicate, false);
  assert.equal(activation.subscriptionStatus, 'ACTIVE');
  assert.ok(activation.invoiceId);

  // 5. Idempotency blocks duplicate event replay
  const duplicateReplay = processSignedWebhook({
    rawBody: checkout.signedSampleWebhook!.payload,
    signatureHeader: checkout.signedSampleWebhook!.signatureHeader,
  });
  assert.equal(duplicateReplay.status, 200);
  assert.equal(duplicateReplay.duplicate, true);

  // All 10 entitlements unlocked!
  summary = getUserSubscriptionSummary(reg.user.id);
  assert.equal(summary.planCode, 'PREMIUM');
  assert.equal(summary.isPremiumActive, true);
  assert.equal(summary.activeEntitlements.length, 10);
  assert.equal(hasEntitlement(reg.user.id, 'OMNI_AUTOBUILD_FACTORY'), true);
  assert.equal(hasEntitlement(reg.user.id, 'OMNI_MEMORY_VAULT'), true);

  // Downloadable HTML Invoice renders cleanly
  const inv = renderInvoiceHtml(activation.invoiceId!, reg.user.id);
  assert.ok(inv.html.includes('OMNIX PREMIUM (90-Day Pass)'));
  assert.ok(inv.html.includes('$5.00 USD'));

  // Create user-owned project while subscribed
  const appRec = createAutoBuildProject({
    workspaceId: 'ws-primary',
    userId: reg.user.id,
    prompt: 'Build Telemetry Inventory App',
  });
  assert.ok(appRec.projectId.startsWith('ab-'));

  // 6. Cancellation retains access until period end
  const cancelBody = JSON.stringify({
    eventId: 'evt_cancel_omar_1',
    eventType: 'subscription_cancelled',
    userId: reg.user.id,
    subscriptionId: checkout.subscriptionId,
  });
  const cancelRes = processSignedWebhook({
    rawBody: cancelBody,
    signatureHeader: signWebhookPayload(cancelBody),
  });
  assert.equal(cancelRes.subscriptionStatus, 'CANCELLED');
  assert.equal(getUserSubscriptionSummary(reg.user.id).isPremiumActive, true);

  // 7. Expiration downgrades cleanly to FREE WITHOUT deleting user's saved projects
  const expireBody = JSON.stringify({
    eventId: 'evt_expire_omar_1',
    eventType: 'subscription_expired',
    userId: reg.user.id,
    subscriptionId: checkout.subscriptionId,
  });
  const expireRes = processSignedWebhook({
    rawBody: expireBody,
    signatureHeader: signWebhookPayload(expireBody),
  });
  assert.equal(expireRes.subscriptionStatus, 'EXPIRED');
  const postExpire = getUserSubscriptionSummary(reg.user.id);
  assert.equal(postExpire.planCode, 'FREE');
  assert.equal(postExpire.isPremiumActive, false);
  assert.equal(postExpire.activeEntitlements.length, 0);

  // Verify user's saved project data is 100% preserved after downgrade
  const db = getDb();
  const savedCount = db
    .prepare(`SELECT COUNT(*) as c FROM autobuild_projects WHERE user_id = ?`)
    .get(reg.user.id) as { c: number };
  assert.equal(savedCount.c, 1);
});
