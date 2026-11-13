import { Router, type Request, type Response } from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getDb } from '../db/schema.ts';
import {
  getActiveUserFromRequest,
  logAuditEvent,
  sanitizePlainText,
} from '../core/security.ts';
import {
  completePasswordReset,
  computeTotpCode,
  generateTotpSecret,
  initiatePasswordReset,
  listUserSessions,
  loginOmnixUser,
  registerOmnixUser,
  revokeSession,
  verifyEmailWithToken,
  verifyTotpCode,
} from '../core/authService.ts';
import {
  createCheckoutSession,
  getUserSubscriptionSummary,
  hasEntitlement,
  processSignedWebhook,
  renderInvoiceHtml,
  signWebhookPayload,
  type PremiumFeatureKey,
} from '../core/billingEngine.ts';
import {
  generateCodexCode,
  getGitWorkspaceSummary,
  previewOrApplyCodexPatch,
  resolveSafeWorkspacePath,
  rollbackCodexPatch,
  runCodexProjectScan,
  runCodexSandbox,
} from '../core/codexService.ts';
import type { CodexFinding, FileInput, SupportedCodexLanguage } from '../../shared/codexEngine.ts';
import {
  computeWorkspaceImpact,
  createGenomeSnapshot,
  generateCurrentWorkspaceDNA,
} from '../core/genomeService.ts';
import {
  analyzeMaterialStress,
  computeStatisticsAndRegression,
  matrixDeterminant,
  multiplyMatrices,
  REFERENCE_MATERIALS,
  runEngineeringAnalysis,
  runPhysicsExperiment,
  solveLinearSystem,
  solveOdeModel,
} from '../../shared/labEngine.ts';
import {
  collectLivePublicSignals,
  generateRadarBriefingReport,
} from '../core/radarService.ts';
import {
  translateContextual,
  translateSubtitlesContent,
} from '../core/translatorService.ts';
import {
  applyAutoBuildLiveEdit,
  createAutoBuildProject,
  exportAutoBuildZip,
} from '../core/autobuildService.ts';
import { runToolAction } from '../core/executionEngine.ts';

const execFileAsync = promisify(execFile);

function enforceEntitlement(userId: string, key: PremiumFeatureKey, res: Response): boolean {
  if (!hasEntitlement(userId, key)) {
    res.status(402).json({
      error: `OMNIX PREMIUM subscription required to unlock ${key}. Upgrade for $5 USD / 3 months.`,
      requiredEntitlement: key,
      upgradeUrl: '/billing',
    });
    return false;
  }
  return true;
}

export function createExpansionRouter(): Router {
  const router = Router();

  // ============================================================================
  // 1. OMNIX ID — ACCOUNT AUTHENTICATION, SESSIONS, 2FA, PROFILE
  // ============================================================================
  router.post('/id/register', (req: Request, res: Response) => {
    try {
      const body = req.body as {
        fullName?: string;
        username?: string;
        email?: string;
        password?: string;
        confirmPassword?: string;
        country?: string;
        preferredLanguage?: 'en' | 'ar';
        termsAccepted?: boolean;
      };
      const out = registerOmnixUser({
        fullName: body.fullName || '',
        username: body.username || '',
        email: body.email || '',
        password: body.password || '',
        confirmPassword: body.confirmPassword || '',
        country: body.country,
        preferredLanguage: body.preferredLanguage,
        termsAccepted: Boolean(body.termsAccepted),
        deviceLabel: String(req.headers['user-agent'] || 'Web Client').slice(0, 50),
        ipAddress: req.ip || '127.0.0.1',
      });
      const subscription = getUserSubscriptionSummary(out.user.id);
      res.status(201).json({ ...out, subscription });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Registration failed.' });
    }
  });

  router.post('/id/login', (req: Request, res: Response) => {
    try {
      const body = req.body as { identifier?: string; email?: string; password?: string; totpCode?: string };
      const result = loginOmnixUser({
        identifier: body.identifier || body.email || '',
        password: body.password || '',
        totpCode: body.totpCode,
        deviceLabel: String(req.headers['user-agent'] || 'Web Client').slice(0, 50),
        ipAddress: req.ip || '127.0.0.1',
        userAgent: String(req.headers['user-agent'] || ''),
      });
      const subscription = getUserSubscriptionSummary(result.user.id);
      res.json({ ...result, subscription });
    } catch (err) {
      const e = err as Error & { requires2FA?: boolean };
      res.status(e.requires2FA ? 403 : 401).json({
        error: e.message,
        requires2FA: Boolean(e.requires2FA),
      });
    }
  });

  router.post('/id/verify-email', (req: Request, res: Response) => {
    const user = getActiveUserFromRequest(req);
    const { token } = req.body as { token?: string };
    if (!token) {
      res.status(400).json({ error: 'Verification token is required.' });
      return;
    }
    const ok = verifyEmailWithToken(user.id, token);
    if (!ok) {
      res.status(400).json({ error: 'Invalid verification token.' });
      return;
    }
    res.json({ verified: true });
  });

  router.post('/id/password-reset/request', (req: Request, res: Response) => {
    try {
      const { email } = req.body as { email?: string };
      if (!email) {
        res.status(400).json({ error: 'Email is required.' });
        return;
      }
      const out = initiatePasswordReset(email);
      res.json(out);
    } catch (err) {
      res.status(404).json({ error: err instanceof Error ? err.message : 'Account not found' });
    }
  });

  router.post('/id/password-reset/confirm', (req: Request, res: Response) => {
    try {
      const { email, token, newPassword } = req.body as { email?: string; token?: string; newPassword?: string };
      if (!email || !token || !newPassword) {
        res.status(400).json({ error: 'Email, token, and newPassword are required.' });
        return;
      }
      completePasswordReset(email, token, newPassword);
      res.json({ reset: true });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Password reset failed' });
    }
  });

  router.get('/id/profile', (req: Request, res: Response) => {
    const user = getActiveUserFromRequest(req);
    const db = getDb();
    const sessions = listUserSessions(user.id);
    const subscription = getUserSubscriptionSummary(user.id);
    const stats = {
      conversations: (db.prepare(`SELECT COUNT(*) as c FROM conversations WHERE user_id = ?`).get(user.id) as { c: number }).c,
      codexRuns: (db.prepare(`SELECT COUNT(*) as c FROM codex_analyses WHERE user_id = ?`).get(user.id) as { c: number }).c,
      labExperiments: (db.prepare(`SELECT COUNT(*) as c FROM lab_experiments WHERE user_id = ?`).get(user.id) as { c: number }).c,
      autobuildProjects: (db.prepare(`SELECT COUNT(*) as c FROM autobuild_projects WHERE user_id = ?`).get(user.id) as { c: number }).c,
    };
    res.json({
      user,
      sessions,
      subscription,
      stats,
      googleOAuthConfigured: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    });
  });

  router.put('/id/profile', (req: Request, res: Response) => {
    const user = getActiveUserFromRequest(req);
    const body = req.body as {
      fullName?: string;
      country?: string;
      preferredLanguage?: 'en' | 'ar';
      avatarUrl?: string;
    };
    const db = getDb();
    const fullName = body.fullName ? sanitizePlainText(body.fullName) : user.full_name || user.name;
    const country = body.country ? sanitizePlainText(body.country).slice(0, 32) : user.country || 'US';
    const lang = body.preferredLanguage === 'ar' || body.preferredLanguage === 'en' ? body.preferredLanguage : user.preferred_language;
    const avatarUrl = body.avatarUrl !== undefined ? sanitizePlainText(body.avatarUrl).slice(0, 300) : user.avatar_url || '';

    db.prepare(
      `UPDATE users SET full_name = ?, name = ?, country = ?, preferred_language = ?, avatar_url = ? WHERE id = ?`
    ).run(fullName, fullName, country, lang, avatarUrl, user.id);

    res.json({ updated: true });
  });

  router.post('/id/2fa/setup', (req: Request, res: Response) => {
    const user = getActiveUserFromRequest(req);
    const db = getDb();
    const secret = generateTotpSecret();
    db.prepare(`UPDATE users SET two_factor_secret = ? WHERE id = ?`).run(secret, user.id);
    const sampleCode = computeTotpCode(secret);
    const otpauthUri = `otpauth://totp/OMNIX:${encodeURIComponent(user.email)}?secret=${secret}&issuer=OMNIX`;
    res.json({ secret, otpauthUri, sampleCode });
  });

  router.post('/id/2fa/enable', (req: Request, res: Response) => {
    const user = getActiveUserFromRequest(req);
    const { code } = req.body as { code?: string };
    const db = getDb();
    const row = db.prepare(`SELECT two_factor_secret FROM users WHERE id = ?`).get(user.id) as
      | { two_factor_secret: string }
      | undefined;
    if (!row?.two_factor_secret || !code || !verifyTotpCode(row.two_factor_secret, code)) {
      res.status(400).json({ error: 'Invalid 6-digit TOTP verification code.' });
      return;
    }
    db.prepare(`UPDATE users SET two_factor_enabled = 1 WHERE id = ?`).run(user.id);
    res.json({ twoFactorEnabled: true });
  });

  router.post('/id/2fa/disable', (req: Request, res: Response) => {
    const user = getActiveUserFromRequest(req);
    const db = getDb();
    db.prepare(`UPDATE users SET two_factor_enabled = 0, two_factor_secret = '' WHERE id = ?`).run(user.id);
    res.json({ twoFactorEnabled: false });
  });

  router.post('/id/logout', (req: Request, res: Response) => {
    const user = getActiveUserFromRequest(req);
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : undefined;
    const { allDevices = false } = req.body as { allDevices?: boolean };
    const revoked = revokeSession(user.id, token, Boolean(allDevices));
    res.json({ loggedOut: true, revokedSessions: revoked });
  });

  // ============================================================================
  // 2. OMNIX PREMIUM — SUBSCRIPTIONS, ENTITLEMENTS, CHECKOUT, WEBHOOKS, INVOICES
  // ============================================================================
  router.get('/billing/overview', (req: Request, res: Response) => {
    const user = getActiveUserFromRequest(req);
    const db = getDb();
    const summary = getUserSubscriptionSummary(user.id);
    const plans = db.prepare(`SELECT * FROM SubscriptionPlans WHERE active = 1 ORDER BY price_usd ASC`).all();
    const payments = db
      .prepare(`SELECT * FROM Payments WHERE user_id = ? ORDER BY created_at DESC LIMIT 20`)
      .all(user.id);
    const invoices = db
      .prepare(`SELECT * FROM Invoices WHERE user_id = ? ORDER BY created_at DESC LIMIT 20`)
      .all(user.id);
    const history = db
      .prepare(`SELECT * FROM SubscriptionHistory WHERE user_id = ? ORDER BY created_at DESC LIMIT 20`)
      .all(user.id);
    const webhookLogs = db
      .prepare(`SELECT * FROM PaymentWebhookLogs ORDER BY created_at DESC LIMIT 15`)
      .all();

    res.json({ summary, plans, payments, invoices, history, webhookLogs });
  });

  router.post('/billing/checkout', (req: Request, res: Response) => {
    const user = getActiveUserFromRequest(req);
    const { mode = 'sandbox' } = req.body as { mode?: 'stripe' | 'sandbox' };
    const checkout = createCheckoutSession(user.id, mode);
    res.status(201).json(checkout);
  });

  router.post('/billing/webhook', (req: Request, res: Response) => {
    const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    const signatureHeader = String(req.headers['x-omnix-signature'] || req.headers['stripe-signature'] || '');
    const result = processSignedWebhook({ rawBody, signatureHeader });
    res.status(result.status).json(result);
  });

  router.post('/billing/subscription/action', (req: Request, res: Response) => {
    const user = getActiveUserFromRequest(req);
    const { action, paymentId } = req.body as {
      action?: 'cancel' | 'expire_now' | 'refund' | 'fail_test';
      paymentId?: string;
    };
    const summary = getUserSubscriptionSummary(user.id);
    const db = getDb();
    const sub = db
      .prepare(`SELECT id FROM Subscriptions WHERE user_id = ? ORDER BY created_at DESC LIMIT 1`)
      .get(user.id) as { id: string } | undefined;
    if (!sub) {
      res.status(404).json({ error: 'No subscription record found for user.' });
      return;
    }

    const eventTypeMap = {
      cancel: 'subscription_cancelled',
      expire_now: 'subscription_expired',
      refund: 'refund_issued',
      fail_test: 'payment_failed',
    } as const;
    if (!action || !eventTypeMap[action]) {
      res.status(400).json({ error: 'Invalid subscription lifecycle action.' });
      return;
    }

    const rawBody = JSON.stringify({
      eventId: `evt_act_${crypto.randomUUID().slice(0, 10)}`,
      eventType: eventTypeMap[action],
      provider: summary.provider,
      userId: user.id,
      subscriptionId: sub.id,
      paymentId,
    });
    const sig = signWebhookPayload(rawBody);
    const result = processSignedWebhook({ rawBody, signatureHeader: sig });
    res.json({ ...result, summary: getUserSubscriptionSummary(user.id) });
  });

  router.get('/billing/invoices/:id/download', (req: Request, res: Response) => {
    try {
      const user = getActiveUserFromRequest(req);
      const { fileName, html } = renderInvoiceHtml(req.params.id, user.id);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      res.send(html);
    } catch (err) {
      res.status(404).json({ error: err instanceof Error ? err.message : 'Invoice unavailable' });
    }
  });

  // ============================================================================
  // 3. OMNI CODEX — SOFTWARE ENGINEERING INTELLIGENCE
  // ============================================================================
  router.get('/codex/overview', (req: Request, res: Response) => {
    const user = getActiveUserFromRequest(req);
    const workspaceId = String(req.query.workspaceId || 'ws-primary');
    const db = getDb();
    const analyses = db
      .prepare(`SELECT id, target_name, summary_json, created_at FROM codex_analyses WHERE workspace_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT 10`)
      .all(workspaceId, user.id);
    const patches = db
      .prepare(`SELECT id, file_path, finding_id, unified_diff, status, created_at FROM codex_patches WHERE workspace_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT 15`)
      .all(workspaceId, user.id);
    const sandboxRuns = db
      .prepare(`SELECT * FROM codex_sandbox_runs WHERE workspace_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT 12`)
      .all(workspaceId, user.id);
    res.json({ analyses, patches, sandboxRuns });
  });

  router.post('/codex/analyze', (req: Request, res: Response) => {
    const user = getActiveUserFromRequest(req);
    const { workspaceId = 'ws-primary', customFiles, targetName } = req.body as {
      workspaceId?: string;
      customFiles?: FileInput[];
      targetName?: string;
    };
    const out = runCodexProjectScan({ workspaceId, userId: user.id, customFiles, targetName });
    res.json(out);
  });

  router.get('/codex/file', (req: Request, res: Response) => {
    try {
      const rel = String(req.query.path || '');
      if (!rel) {
        res.status(400).json({ error: 'File path required.' });
        return;
      }
      const full = resolveSafeWorkspacePath(rel);
      if (!fs.existsSync(full)) {
        res.status(404).json({ error: 'File not found.' });
        return;
      }
      const content = fs.readFileSync(full, 'utf8');
      res.json({ path: rel, content });
    } catch (err) {
      res.status(403).json({ error: err instanceof Error ? err.message : 'Invalid file path' });
    }
  });

  router.post('/codex/patch', (req: Request, res: Response) => {
    const user = getActiveUserFromRequest(req);
    if (!enforceEntitlement(user.id, 'ADVANCED_CODEX_INTELLIGENCE', res)) return;
    try {
      const { workspaceId = 'ws-primary', finding, customSource, persistToDisk = false } = req.body as {
        workspaceId?: string;
        finding: CodexFinding;
        customSource?: string;
        persistToDisk?: boolean;
      };
      const out = previewOrApplyCodexPatch({
        workspaceId,
        userId: user.id,
        finding,
        applyToCustomSource: customSource,
        persistToDisk,
      });
      res.json(out);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Patch error' });
    }
  });

  router.post('/codex/patch/:id/rollback', (req: Request, res: Response) => {
    try {
      const user = getActiveUserFromRequest(req);
      const out = rollbackCodexPatch(req.params.id, user.id);
      res.json(out);
    } catch (err) {
      res.status(404).json({ error: err instanceof Error ? err.message : 'Rollback failed' });
    }
  });

  router.post('/codex/generate', async (req: Request, res: Response) => {
    const user = getActiveUserFromRequest(req);
    const { workspaceId = 'ws-primary', prompt, language = 'TypeScript', artifactType = 'api' } = req.body as {
      workspaceId?: string;
      prompt?: string;
      language?: SupportedCodexLanguage;
      artifactType?: 'api' | 'model' | 'class' | 'test' | 'config' | 'docs';
    };
    if (!prompt?.trim()) {
      res.status(400).json({ error: 'Prompt is required for code synthesis.' });
      return;
    }
    const out = await generateCodexCode({ workspaceId, prompt: prompt.trim(), language, artifactType });
    res.json(out);
  });

  router.post('/codex/sandbox', (req: Request, res: Response) => {
    const user = getActiveUserFromRequest(req);
    const { workspaceId = 'ws-primary', language = 'JavaScript', code = '' } = req.body as {
      workspaceId?: string;
      language?: string;
      code?: string;
    };
    const out = runCodexSandbox({ workspaceId, userId: user.id, language, code });
    res.json(out);
  });

  router.get('/codex/git', async (_req: Request, res: Response) => {
    const summary = await getGitWorkspaceSummary();
    res.json(summary);
  });

  router.post('/codex/tests/run', async (req: Request, res: Response) => {
    const user = getActiveUserFromRequest(req);
    if (!enforceEntitlement(user.id, 'ADVANCED_CODEX_INTELLIGENCE', res)) return;
    try {
      const { stdout, stderr } = await execFileAsync(
        'npx',
        ['--yes', 'tsx', '--test', 'tests/dataEngine.test.ts', 'tests/mathSandbox.test.ts', 'tests/physicsEngine.test.ts'],
        { cwd: process.cwd(), timeout: 15000 }
      );
      res.json({ passed: true, stdout, stderr });
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string; message?: string };
      res.json({ passed: false, stdout: e.stdout || '', stderr: e.stderr || e.message || 'Tests failed' });
    }
  });

  // ============================================================================
  // 4. OMNI GENOME — UNIVERSAL PROJECT DIGITAL DNA
  // ============================================================================
  router.get('/genome', (req: Request, res: Response) => {
    const user = getActiveUserFromRequest(req);
    const workspaceId = String(req.query.workspaceId || 'ws-primary');
    const db = getDb();
    const dna = generateCurrentWorkspaceDNA(workspaceId, user.id);
    const snapshots = db
      .prepare(`SELECT id, label, health_json, created_at FROM genome_snapshots WHERE workspace_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT 15`)
      .all(workspaceId, user.id);
    res.json({ dna, snapshots });
  });

  router.post('/genome/snapshot', (req: Request, res: Response) => {
    const user = getActiveUserFromRequest(req);
    const { workspaceId = 'ws-primary', label = 'Manual Restore Point' } = req.body as {
      workspaceId?: string;
      label?: string;
    };
    const out = createGenomeSnapshot({ workspaceId, userId: user.id, label });
    res.status(201).json(out);
  });

  router.post('/genome/impact', (req: Request, res: Response) => {
    const user = getActiveUserFromRequest(req);
    if (!enforceEntitlement(user.id, 'PROJECT_DIGITAL_DNA_PRO', res)) return;
    try {
      const { workspaceId = 'ws-primary', targetNodeId } = req.body as {
        workspaceId?: string;
        targetNodeId?: string;
      };
      if (!targetNodeId) {
        res.status(400).json({ error: 'targetNodeId is required.' });
        return;
      }
      const impact = computeWorkspaceImpact(workspaceId, user.id, targetNodeId);
      res.json(impact);
    } catch (err) {
      res.status(404).json({ error: err instanceof Error ? err.message : 'Node not found' });
    }
  });

  // ============================================================================
  // 5. OMNI LAB — VIRTUAL SCIENTIFIC & ENGINEERING LABORATORY
  // ============================================================================
  router.get('/lab/overview', (req: Request, res: Response) => {
    const user = getActiveUserFromRequest(req);
    const workspaceId = String(req.query.workspaceId || 'ws-primary');
    const db = getDb();
    const experiments = db
      .prepare(`SELECT * FROM lab_experiments WHERE workspace_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT 30`)
      .all(workspaceId, user.id);
    res.json({ materials: REFERENCE_MATERIALS, experiments });
  });

  router.post('/lab/run', (req: Request, res: Response) => {
    try {
      const user = getActiveUserFromRequest(req);
      const body = req.body as {
        workspaceId?: string;
        domain: 'numerical' | 'physics' | 'materials' | 'engineering';
        title?: string;
        params: Record<string, unknown>;
        save?: boolean;
      };
      const workspaceId = body.workspaceId || 'ws-primary';
      const p = body.params || {};

      // Advanced multi-variable sweeps / ODE models gate with OMNI_LAB_PROFESSIONAL
      if (body.domain === 'numerical' && p.mode === 'ode' && !hasEntitlement(user.id, 'OMNI_LAB_PROFESSIONAL')) {
        enforceEntitlement(user.id, 'OMNI_LAB_PROFESSIONAL', res);
        return;
      }

      let results: Record<string, unknown> = {};
      let equations: string[] = [];

      if (body.domain === 'numerical') {
        const mode = String(p.mode || 'linear_system');
        if (mode === 'ode') {
          const ode = solveOdeModel({
            model: (p.model as 'damped_oscillator' | 'exponential_decay' | 'logistic_growth' | 'rc_charging') || 'damped_oscillator',
            y0: Number(p.y0 ?? 1),
            v0: Number(p.v0 ?? 0),
            paramA: Number(p.paramA ?? 2.5),
            paramB: Number(p.paramB ?? 0.2),
            tEnd: Number(p.tEnd ?? 10),
          });
          results = { ...ode };
          equations = [ode.equation];
        } else if (mode === 'stats') {
          const xs = (Array.isArray(p.xs) ? p.xs : [1, 2, 3, 4, 5]).map(Number);
          const ys = Array.isArray(p.ys) ? p.ys.map(Number) : undefined;
          results = computeStatisticsAndRegression(xs, ys);
          equations = ['y = m·x + b', 'R² = 1 - SS_res / SS_tot'];
        } else {
          const A = (Array.isArray(p.matrixA) ? p.matrixA : [[3, 1], [1, 2]]) as number[][];
          const b = (Array.isArray(p.vectorB) ? p.vectorB : [9, 8]) as number[];
          const B = Array.isArray(p.matrixB) ? (p.matrixB as number[][]) : null;
          results = {
            determinant: matrixDeterminant(A),
            solution: solveLinearSystem(A, b),
            ...(B ? { product: multiplyMatrices(A, B) } : {}),
          };
          equations = ['A·x = b (Gaussian Elimination with Partial Pivoting)', 'det(A)'];
        }
      } else if (body.domain === 'physics') {
        const phys = runPhysicsExperiment({
          experimentType: (p.experimentType as 'projectile' | 'collision_1d' | 'thermodynamics_carnot' | 'harmonic_pendulum') || 'projectile',
          v0: p.v0 !== undefined ? Number(p.v0) : undefined,
          angleDeg: p.angleDeg !== undefined ? Number(p.angleDeg) : undefined,
          gravity: p.gravity !== undefined ? Number(p.gravity) : undefined,
          dragCoeff: p.dragCoeff !== undefined ? Number(p.dragCoeff) : undefined,
          mass: p.mass !== undefined ? Number(p.mass) : undefined,
          mass2: p.mass2 !== undefined ? Number(p.mass2) : undefined,
          v2: p.v2 !== undefined ? Number(p.v2) : undefined,
          restitution: p.restitution !== undefined ? Number(p.restitution) : undefined,
          tHotK: p.tHotK !== undefined ? Number(p.tHotK) : undefined,
          tColdK: p.tColdK !== undefined ? Number(p.tColdK) : undefined,
          heatInJ: p.heatInJ !== undefined ? Number(p.heatInJ) : undefined,
          lengthM: p.lengthM !== undefined ? Number(p.lengthM) : undefined,
        });
        results = { ...phys };
        equations = phys.equations;
      } else if (body.domain === 'materials') {
        const mat = analyzeMaterialStress({
          materialId: p.materialId ? String(p.materialId) : 'mat-steel-a36',
          customMaterial: p.customMaterial as Record<string, never> | undefined,
          appliedForceN: Number(p.appliedForceN ?? 25000),
          crossSectionAreaMm2: Number(p.crossSectionAreaMm2 ?? 150),
        });
        results = { ...mat };
        equations = mat.equations;
      } else {
        const eng = runEngineeringAnalysis({
          analysisType: (p.analysisType as 'beam_bending' | 'thermal_conduction') || 'beam_bending',
          lengthM: Number(p.lengthM ?? 3.0),
          loadN: p.loadN !== undefined ? Number(p.loadN) : undefined,
          widthMm: p.widthMm !== undefined ? Number(p.widthMm) : undefined,
          heightMm: p.heightMm !== undefined ? Number(p.heightMm) : undefined,
          youngsModulusGPa: p.youngsModulusGPa !== undefined ? Number(p.youngsModulusGPa) : undefined,
          yieldStrengthMPa: p.yieldStrengthMPa !== undefined ? Number(p.yieldStrengthMPa) : undefined,
          beamSupport: (p.beamSupport as 'simply_supported' | 'cantilever') || 'simply_supported',
          areaM2: p.areaM2 !== undefined ? Number(p.areaM2) : undefined,
          tempHotC: p.tempHotC !== undefined ? Number(p.tempHotC) : undefined,
          tempColdC: p.tempColdC !== undefined ? Number(p.tempColdC) : undefined,
          thermalConductivityWmK: p.thermalConductivityWmK !== undefined ? Number(p.thermalConductivityWmK) : undefined,
        });
        results = { ...eng };
        equations = eng.equations;
      }

      let experimentId: string | undefined;
      if (body.save !== false) {
        const db = getDb();
        experimentId = `exp-${crypto.randomUUID().slice(0, 8)}`;
        db.prepare(
          `INSERT INTO lab_experiments (id, workspace_id, user_id, domain, title, variables_json, equations_json, results_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          experimentId,
          workspaceId,
          user.id,
          body.domain,
          body.title || `${body.domain.toUpperCase()} Run`,
          JSON.stringify(p),
          JSON.stringify(equations),
          JSON.stringify(results)
        );
      }

      res.json({ experimentId, domain: body.domain, equations, results });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Experiment failed' });
    }
  });

  // ============================================================================
  // 6. OMNI RADAR — GLOBAL INTELLIGENCE & OPPORTUNITY RADAR
  // ============================================================================
  router.get('/radar/overview', (req: Request, res: Response) => {
    const user = getActiveUserFromRequest(req);
    const workspaceId = String(req.query.workspaceId || 'ws-primary');
    const db = getDb();
    const monitors = db
      .prepare(`SELECT * FROM radar_monitors WHERE workspace_id = ? AND user_id = ? ORDER BY created_at DESC`)
      .all(workspaceId, user.id);
    const signals = db
      .prepare(`SELECT * FROM radar_signals WHERE workspace_id = ? ORDER BY collected_at DESC LIMIT 40`)
      .all(workspaceId);
    const reports = db
      .prepare(`SELECT * FROM radar_reports WHERE workspace_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT 12`)
      .all(workspaceId, user.id);
    res.json({ monitors, signals, reports });
  });

  router.post('/radar/monitors', (req: Request, res: Response) => {
    const user = getActiveUserFromRequest(req);
    const { workspaceId = 'ws-primary', name, monitorType = 'topic', keywords = [], sourceUrl = '' } = req.body as {
      workspaceId?: string;
      name?: string;
      monitorType?: 'topic' | 'competitor' | 'source';
      keywords?: string[];
      sourceUrl?: string;
    };
    if (!name?.trim()) {
      res.status(400).json({ error: 'Monitor name is required.' });
      return;
    }
    const db = getDb();
    const id = `mon-${crypto.randomUUID().slice(0, 8)}`;
    db.prepare(
      `INSERT INTO radar_monitors (id, workspace_id, user_id, name, monitor_type, keywords_json, source_url)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(id, workspaceId, user.id, name.trim(), monitorType, JSON.stringify(keywords), sourceUrl.trim());
    res.status(201).json({ id });
  });

  router.post('/radar/collect', async (req: Request, res: Response) => {
    const user = getActiveUserFromRequest(req);
    if (!enforceEntitlement(user.id, 'GLOBAL_RADAR_INTELLIGENCE', res)) return;
    const { workspaceId = 'ws-primary', query = 'AI engineering' } = req.body as {
      workspaceId?: string;
      query?: string;
    };
    const out = await collectLivePublicSignals({ workspaceId, query });
    res.json(out);
  });

  router.post('/radar/report', async (req: Request, res: Response) => {
    const user = getActiveUserFromRequest(req);
    if (!enforceEntitlement(user.id, 'GLOBAL_RADAR_INTELLIGENCE', res)) return;
    const { workspaceId = 'ws-primary', topic = 'AI & Engineering Trends' } = req.body as {
      workspaceId?: string;
      topic?: string;
    };
    const report = await generateRadarBriefingReport({ workspaceId, userId: user.id, topic });
    res.status(201).json(report);
  });

  // ============================================================================
  // 7. OMNI TRANSLATOR — MULTIMODAL TRANSLATION ENGINE
  // ============================================================================
  router.get('/translator/overview', (req: Request, res: Response) => {
    const user = getActiveUserFromRequest(req);
    const workspaceId = String(req.query.workspaceId || 'ws-primary');
    const db = getDb();
    const glossaries = db
      .prepare(`SELECT * FROM translator_glossaries WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 60`)
      .all(workspaceId);
    const memory = db
      .prepare(`SELECT * FROM translator_memory WHERE workspace_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT 40`)
      .all(workspaceId, user.id);
    const jobs = db
      .prepare(`SELECT * FROM translator_jobs WHERE workspace_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT 25`)
      .all(workspaceId, user.id);
    res.json({ glossaries, memory, jobs });
  });

  router.post('/translator/translate', async (req: Request, res: Response) => {
    const user = getActiveUserFromRequest(req);
    const {
      workspaceId = 'ws-primary',
      text,
      sourceLang = 'en',
      targetLang = 'ar',
      tone = 'Technical',
      domain = 'Software Engineering',
      jobType = 'text',
      runBackTranslation = false,
    } = req.body as {
      workspaceId?: string;
      text?: string;
      sourceLang?: string;
      targetLang?: string;
      tone?: 'Technical' | 'Academic' | 'Legal' | 'Business' | 'Literary' | 'Formal' | 'Casual';
      domain?: 'General' | 'Software Engineering' | 'Physics & Science' | 'Medicine' | 'Law' | 'Finance' | 'Marketing' | 'Academic';
      jobType?: 'text' | 'document' | 'voice' | 'subtitle';
      runBackTranslation?: boolean;
    };
    if (!text?.trim()) {
      res.status(400).json({ error: 'Source text is required.' });
      return;
    }
    if ((jobType === 'document' || runBackTranslation) && !hasEntitlement(user.id, 'OMNI_TRANSLATOR_PRO')) {
      enforceEntitlement(user.id, 'OMNI_TRANSLATOR_PRO', res);
      return;
    }
    const result = await translateContextual({
      workspaceId,
      userId: user.id,
      text,
      sourceLang,
      targetLang,
      tone,
      domain,
      jobType,
      runBackTranslation,
    });
    res.json(result);
  });

  router.post('/translator/subtitles', async (req: Request, res: Response) => {
    const user = getActiveUserFromRequest(req);
    if (!enforceEntitlement(user.id, 'OMNI_TRANSLATOR_PRO', res)) return;
    try {
      const { workspaceId = 'ws-primary', subtitleContent = '', sourceLang = 'en', targetLang = 'ar', domain = 'General' } = req.body as {
        workspaceId?: string;
        subtitleContent?: string;
        sourceLang?: string;
        targetLang?: string;
        domain?: 'General' | 'Software Engineering' | 'Physics & Science' | 'Medicine' | 'Law' | 'Finance' | 'Marketing' | 'Academic';
      };
      const out = await translateSubtitlesContent({ workspaceId, userId: user.id, subtitleContent, sourceLang, targetLang, domain });
      res.json(out);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Subtitle translation failed' });
    }
  });

  router.post('/translator/glossaries', (req: Request, res: Response) => {
    const user = getActiveUserFromRequest(req);
    if (!enforceEntitlement(user.id, 'OMNI_TRANSLATOR_PRO', res)) return;
    const { workspaceId = 'ws-primary', domain = 'General', sourceLang = 'en', targetLang = 'ar', sourceTerm, targetTerm } = req.body as {
      workspaceId?: string;
      domain?: string;
      sourceLang?: string;
      targetLang?: string;
      sourceTerm?: string;
      targetTerm?: string;
    };
    if (!sourceTerm?.trim() || !targetTerm?.trim()) {
      res.status(400).json({ error: 'sourceTerm and targetTerm are required.' });
      return;
    }
    const db = getDb();
    const id = `gl-${crypto.randomUUID().slice(0, 8)}`;
    db.prepare(
      `INSERT INTO translator_glossaries (id, workspace_id, user_id, domain, source_lang, target_lang, source_term, target_term)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, workspaceId, user.id, domain, sourceLang, targetLang, sourceTerm.trim(), targetTerm.trim());
    res.status(201).json({ id });
  });

  // ============================================================================
  // 8. OMNI AUTOBUILD — AUTONOMOUS APPLICATION & SOFTWARE FACTORY
  // ============================================================================
  router.get('/autobuild/projects', (req: Request, res: Response) => {
    const user = getActiveUserFromRequest(req);
    const workspaceId = String(req.query.workspaceId || 'ws-primary');
    const db = getDb();
    const projects = db
      .prepare(`SELECT * FROM autobuild_projects WHERE workspace_id = ? AND user_id = ? ORDER BY updated_at DESC LIMIT 20`)
      .all(workspaceId, user.id);
    res.json({ projects });
  });

  router.post('/autobuild/build', (req: Request, res: Response) => {
    const user = getActiveUserFromRequest(req);
    if (!enforceEntitlement(user.id, 'OMNI_AUTOBUILD_FACTORY', res)) return;
    const { workspaceId = 'ws-primary', prompt } = req.body as { workspaceId?: string; prompt?: string };
    if (!prompt?.trim()) {
      res.status(400).json({ error: 'Application prompt description is required.' });
      return;
    }
    const created = createAutoBuildProject({ workspaceId, userId: user.id, prompt: prompt.trim() });
    res.status(201).json(created);
  });

  router.post('/autobuild/:id/edit', (req: Request, res: Response) => {
    const user = getActiveUserFromRequest(req);
    if (!enforceEntitlement(user.id, 'OMNI_AUTOBUILD_FACTORY', res)) return;
    try {
      const { instruction } = req.body as { instruction?: string };
      if (!instruction?.trim()) {
        res.status(400).json({ error: 'Edit instruction is required.' });
        return;
      }
      const updated = applyAutoBuildLiveEdit({
        projectId: req.params.id,
        userId: user.id,
        instruction: instruction.trim(),
      });
      res.json(updated);
    } catch (err) {
      res.status(404).json({ error: err instanceof Error ? err.message : 'Live edit failed' });
    }
  });

  router.get('/autobuild/:id/export', (req: Request, res: Response) => {
    try {
      const user = getActiveUserFromRequest(req);
      const { fileName, buffer } = exportAutoBuildZip(req.params.id, user.id);
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      res.send(buffer);
    } catch (err) {
      res.status(404).json({ error: err instanceof Error ? err.message : 'Export failed' });
    }
  });

  // ============================================================================
  // 9. OMNI MEMORY VAULT & OMNI AUTOMATION PRO (Premium Entitlements 08 & 09)
  // ============================================================================
  router.get('/memory/vault', (req: Request, res: Response) => {
    const user = getActiveUserFromRequest(req);
    const workspaceId = String(req.query.workspaceId || 'ws-primary');
    const db = getDb();
    const rules = db
      .prepare(`SELECT * FROM memory_rules WHERE workspace_id = ? AND user_id = ? ORDER BY created_at DESC`)
      .all(workspaceId, user.id);
    res.json({ rules });
  });

  router.post('/memory/vault', (req: Request, res: Response) => {
    const user = getActiveUserFromRequest(req);
    if (!enforceEntitlement(user.id, 'OMNI_MEMORY_VAULT', res)) return;
    const { workspaceId = 'ws-primary', ruleTitle, ruleContent, linkedFileId = null, linkedConversationId = null } = req.body as {
      workspaceId?: string;
      ruleTitle?: string;
      ruleContent?: string;
      linkedFileId?: string | null;
      linkedConversationId?: string | null;
    };
    if (!ruleTitle?.trim() || !ruleContent?.trim()) {
      res.status(400).json({ error: 'ruleTitle and ruleContent are required.' });
      return;
    }
    const db = getDb();
    const id = `mrl-${crypto.randomUUID().slice(0, 8)}`;
    db.prepare(
      `INSERT INTO memory_rules (id, workspace_id, user_id, rule_title, rule_content, linked_file_id, linked_conversation_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(id, workspaceId, user.id, ruleTitle.trim(), ruleContent.trim(), linkedFileId, linkedConversationId);
    res.status(201).json({ id });
  });

  router.get('/automation/workflows', (req: Request, res: Response) => {
    const user = getActiveUserFromRequest(req);
    const workspaceId = String(req.query.workspaceId || 'ws-primary');
    const db = getDb();
    const workflows = db
      .prepare(`SELECT * FROM automation_workflows WHERE workspace_id = ? AND user_id = ? ORDER BY created_at DESC`)
      .all(workspaceId, user.id);
    const runs = db
      .prepare(`SELECT * FROM automation_runs WHERE user_id = ? ORDER BY executed_at DESC LIMIT 20`)
      .all(user.id);
    res.json({ workflows, runs });
  });

  router.post('/automation/workflows', (req: Request, res: Response) => {
    const user = getActiveUserFromRequest(req);
    if (!enforceEntitlement(user.id, 'OMNI_AUTOMATION_PRO', res)) return;
    const { workspaceId = 'ws-primary', name, triggerType = 'manual', triggerConfig = '', steps = [] } = req.body as {
      workspaceId?: string;
      name?: string;
      triggerType?: 'manual' | 'schedule' | 'webhook' | 'event';
      triggerConfig?: string;
      steps?: Array<{ toolName: string; args: Record<string, unknown> }>;
    };
    if (!name?.trim() || !Array.isArray(steps) || steps.length === 0) {
      res.status(400).json({ error: 'Workflow name and at least one step are required.' });
      return;
    }
    const db = getDb();
    const id = `wf-${crypto.randomUUID().slice(0, 8)}`;
    db.prepare(
      `INSERT INTO automation_workflows (id, workspace_id, user_id, name, trigger_type, trigger_config, steps_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(id, workspaceId, user.id, name.trim(), triggerType, triggerConfig, JSON.stringify(steps));
    res.status(201).json({ id });
  });

  router.post('/automation/workflows/:id/run', async (req: Request, res: Response) => {
    const user = getActiveUserFromRequest(req);
    if (!enforceEntitlement(user.id, 'OMNI_AUTOMATION_PRO', res)) return;
    const db = getDb();
    const wf = db
      .prepare(`SELECT * FROM automation_workflows WHERE id = ? AND user_id = ?`)
      .get(req.params.id, user.id) as
      | { id: string; workspace_id: string; name: string; steps_json: string }
      | undefined;
    if (!wf) {
      res.status(404).json({ error: 'Workflow not found or access denied.' });
      return;
    }
    const steps = JSON.parse(wf.steps_json || '[]') as Array<{ toolName: string; args: Record<string, unknown> }>;
    const logs: Array<{ step: number; toolName: string; status: string; detail: string }> = [];
    const t0 = performance.now();
    let failed = false;

    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      try {
        const out = await runToolAction(s.toolName, s.args || {}, {
          workspaceId: wf.workspace_id,
          userId: user.id,
        });
        logs.push({ step: i + 1, toolName: s.toolName, status: 'ok', detail: JSON.stringify(out).slice(0, 220) });
      } catch (err) {
        failed = true;
        logs.push({ step: i + 1, toolName: s.toolName, status: 'error', detail: err instanceof Error ? err.message : 'Failed' });
      }
    }

    const durationMs = Math.round(performance.now() - t0);
    const runId = `wfr-${crypto.randomUUID().slice(0, 8)}`;
    db.prepare(
      `INSERT INTO automation_runs (id, workflow_id, user_id, status, logs_json, duration_ms)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(runId, wf.id, user.id, failed ? 'failed' : 'completed', JSON.stringify(logs), durationMs);
    db.prepare(`UPDATE automation_workflows SET last_run_at = datetime('now') WHERE id = ?`).run(wf.id);

    logAuditEvent({
      workspaceId: wf.workspace_id,
      userId: user.id,
      action: 'automation_workflow_run',
      resourceType: 'workflow',
      resourceId: wf.id,
      status: failed ? 'error' : 'allowed',
    });

    res.json({ runId, status: failed ? 'failed' : 'completed', logs, durationMs });
  });

  return router;
}
