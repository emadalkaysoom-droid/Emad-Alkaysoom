import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { getDb } from '../db/schema.ts';
import { logAuditEvent, sanitizePlainText, type AuthUser } from './security.ts';

export interface PasswordStrengthResult {
  valid: boolean;
  score: number;
  issues: string[];
}

export function validatePasswordStrength(password: string): PasswordStrengthResult {
  const issues: string[] = [];
  if (password.length < 8) issues.push('Password must be at least 8 characters.');
  if (!/[A-Z]/.test(password)) issues.push('Include at least one uppercase letter.');
  if (!/[a-z]/.test(password)) issues.push('Include at least one lowercase letter.');
  if (!/[0-9]/.test(password)) issues.push('Include at least one numeric digit.');
  if (!/[^A-Za-z0-9]/.test(password)) issues.push('Include at least one special character.');
  const score = Math.max(0, 5 - issues.length);
  return { valid: issues.length === 0, score, issues };
}

export function generateTotpSecret(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const bytes = crypto.randomBytes(20);
  let out = '';
  for (const b of bytes) out += chars[b % 32];
  return out;
}

function base32ToBuffer(secret: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const ch of secret.toUpperCase().replace(/=+$/, '')) {
    const idx = alphabet.indexOf(ch);
    if (idx !== -1) bits += idx.toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

export function computeTotpCode(secret: string, windowOffset = 0): string {
  const step = Math.floor(Date.now() / 1000 / 30) + windowOffset;
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(step));
  const key = base32ToBuffer(secret);
  const hmac = crypto.createHmac('sha1', key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code = ((hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).toString().padStart(6, '0');
  return code;
}

export function verifyTotpCode(secret: string, token: string): boolean {
  const clean = token.trim();
  if (!/^\d{6}$/.test(clean)) return false;
  return [-1, 0, 1].some((offset) => computeTotpCode(secret, offset) === clean);
}

export function registerOmnixUser(input: {
  fullName: string;
  username: string;
  email: string;
  password: string;
  confirmPassword: string;
  country?: string;
  preferredLanguage?: 'en' | 'ar';
  termsAccepted: boolean;
  deviceLabel?: string;
  ipAddress?: string;
}): {
  user: AuthUser;
  token: string;
  csrfToken: string;
  verificationToken: string;
  emailNotice: string;
} {
  const db = getDb();
  const fullName = sanitizePlainText(input.fullName || '');
  const username = sanitizePlainText(input.username || '').toLowerCase().replace(/[^a-z0-9_.-]/g, '');
  const email = (input.email || '').trim().toLowerCase();

  if (!fullName || fullName.length < 2) throw new Error('Full name is required (min 2 chars).');
  if (!username || username.length < 3) throw new Error('Username must be at least 3 alphanumeric characters.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Valid email address is required.');
  if (input.password !== input.confirmPassword) throw new Error('Password confirmation does not match.');
  if (!input.termsAccepted) throw new Error('Terms and privacy agreement must be accepted.');

  const strength = validatePasswordStrength(input.password);
  if (!strength.valid) throw new Error(strength.issues.join(' '));

  const dup = db
    .prepare(`SELECT id FROM users WHERE LOWER(email) = ? OR LOWER(username) = ?`)
    .get(email, username);
  if (dup) throw new Error('An account with this email or username already exists.');

  const id = `usr-${crypto.randomUUID().slice(0, 8)}`;
  const passwordHash = bcrypt.hashSync(input.password, 10);
  const verificationToken = `vrf-${crypto.randomBytes(12).toString('hex')}`;
  const lang = input.preferredLanguage === 'ar' ? 'ar' : 'en';
  const country = sanitizePlainText(input.country || 'US').slice(0, 32) || 'US';

  db.prepare(
    `INSERT INTO users (id, email, username, full_name, name, password_hash, role, account_role, preferred_language, country, email_verified, verification_token, terms_accepted_at, last_login_at)
     VALUES (?, ?, ?, ?, ?, ?, 'engineer', 'FREE_USER', ?, ?, 0, ?, datetime('now'), datetime('now'))`
  ).run(id, email, username, fullName, fullName, passwordHash, lang, country, verificationToken);

  // Create default FREE subscription record for the new user
  db.prepare(
    `INSERT INTO Subscriptions (id, user_id, plan_id, status, provider, start_date)
     VALUES (?, ?, 'plan-free', 'FREE', 'omnix-free', datetime('now'))`
  ).run(`sub-${crypto.randomUUID().slice(0, 8)}`, id);

  const token = crypto.randomBytes(24).toString('hex');
  const csrfToken = crypto.randomBytes(16).toString('hex');
  const expiresAt = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
  db.prepare(
    `INSERT INTO sessions (token, user_id, expires_at, device_label, ip_address, csrf_token) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(token, id, expiresAt, input.deviceLabel || 'Primary Browser Session', input.ipAddress || '127.0.0.1', csrfToken);

  logAuditEvent({
    userId: id,
    action: 'omnix_id_register',
    resourceType: 'user',
    resourceId: id,
    status: 'allowed',
    details: { username, country },
  });

  return {
    user: {
      id,
      email,
      username,
      full_name: fullName,
      name: fullName,
      role: 'engineer',
      account_role: 'FREE_USER',
      preferred_language: lang,
      country,
      avatar_url: '',
      email_verified: 0,
      two_factor_enabled: 0,
    },
    token,
    csrfToken,
    verificationToken,
    emailNotice: process.env.SMTP_HOST
      ? 'Verification link dispatched via configured SMTP relay.'
      : 'External SMTP not configured; verify directly using the generated verification token below.',
  };
}

export function loginOmnixUser(input: {
  identifier: string;
  password: string;
  totpCode?: string;
  deviceLabel?: string;
  ipAddress?: string;
  userAgent?: string;
}): { user: AuthUser; token: string; csrfToken: string; suspiciousAlert?: string } {
  const db = getDb();
  const ident = (input.identifier || '').trim().toLowerCase();
  if (!ident || !input.password) throw new Error('Email/username and password are required.');

  const row = db
    .prepare(
      `SELECT id, email, username, full_name, name, password_hash, role, account_role, preferred_language, country, avatar_url, email_verified, two_factor_enabled, two_factor_secret, failed_login_attempts, locked_until, last_login_at
       FROM users WHERE LOWER(email) = ? OR LOWER(username) = ? LIMIT 1`
    )
    .get(ident, ident) as
    | (AuthUser & {
        password_hash: string;
        two_factor_secret: string;
        failed_login_attempts: number;
        locked_until: string | null;
        last_login_at: string | null;
      })
    | undefined;

  if (!row) {
    throw new Error('Invalid credentials.');
  }

  if (row.locked_until && new Date(row.locked_until).getTime() > Date.now()) {
    throw new Error('Account temporarily locked due to repeated failed attempts. Try again later.');
  }

  if (!bcrypt.compareSync(input.password, row.password_hash)) {
    const attempts = (row.failed_login_attempts || 0) + 1;
    const lockUntil = attempts >= 5 ? new Date(Date.now() + 5 * 60 * 1000).toISOString() : null;
    db.prepare(`UPDATE users SET failed_login_attempts = ?, locked_until = ? WHERE id = ?`).run(
      attempts,
      lockUntil,
      row.id
    );
    logAuditEvent({
      userId: row.id,
      action: 'omnix_id_login_failed',
      resourceType: 'user',
      resourceId: row.id,
      status: 'denied',
      details: { attempts, ip: input.ipAddress },
    });
    throw new Error('Invalid credentials.');
  }

  if (row.two_factor_enabled === 1 && row.two_factor_secret) {
    if (!input.totpCode || !verifyTotpCode(row.two_factor_secret, input.totpCode)) {
      const err = new Error('Two-Factor Authentication (2FA) 6-digit code required or invalid.') as Error & {
        requires2FA?: boolean;
      };
      err.requires2FA = true;
      throw err;
    }
  }

  // Detect suspicious new IP vs active sessions
  const priorIp = db
    .prepare(`SELECT ip_address FROM sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 1`)
    .get(row.id) as { ip_address: string } | undefined;
  const suspiciousAlert =
    priorIp && input.ipAddress && priorIp.ip_address !== input.ipAddress
      ? `New sign-in IP (${input.ipAddress}) differs from previous session (${priorIp.ip_address}).`
      : undefined;

  const token = crypto.randomBytes(24).toString('hex');
  const csrfToken = crypto.randomBytes(16).toString('hex');
  const expiresAt = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
  db.prepare(
    `INSERT INTO sessions (token, user_id, expires_at, device_label, ip_address, user_agent, csrf_token)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    token,
    row.id,
    expiresAt,
    sanitizePlainText(input.deviceLabel || 'Web Client').slice(0, 60),
    input.ipAddress || '127.0.0.1',
    (input.userAgent || '').slice(0, 140),
    csrfToken
  );

  db.prepare(`UPDATE users SET failed_login_attempts = 0, locked_until = NULL, last_login_at = datetime('now') WHERE id = ?`).run(
    row.id
  );

  logAuditEvent({
    userId: row.id,
    action: 'omnix_id_login',
    resourceType: 'user',
    resourceId: row.id,
    status: 'allowed',
    details: { suspiciousAlert },
  });

  return {
    user: {
      id: row.id,
      email: row.email,
      username: row.username,
      full_name: row.full_name,
      name: row.name,
      role: row.role,
      account_role: row.account_role,
      preferred_language: row.preferred_language,
      country: row.country,
      avatar_url: row.avatar_url,
      email_verified: row.email_verified,
      two_factor_enabled: row.two_factor_enabled,
    },
    token,
    csrfToken,
    suspiciousAlert,
  };
}

export function verifyEmailWithToken(userId: string, token: string): boolean {
  const db = getDb();
  const row = db
    .prepare(`SELECT verification_token FROM users WHERE id = ?`)
    .get(userId) as { verification_token: string | null } | undefined;
  if (!row || !row.verification_token || row.verification_token !== token.trim()) {
    return false;
  }
  db.prepare(`UPDATE users SET email_verified = 1, verification_token = NULL WHERE id = ?`).run(userId);
  return true;
}

export function initiatePasswordReset(email: string): { resetToken: string; expiresAt: string; notice: string } {
  const db = getDb();
  const row = db.prepare(`SELECT id FROM users WHERE LOWER(email) = ?`).get(email.trim().toLowerCase()) as
    | { id: string }
    | undefined;
  if (!row) throw new Error('No account matches that email address.');
  const resetToken = `rst-${crypto.randomBytes(12).toString('hex')}`;
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  db.prepare(`UPDATE users SET reset_token = ?, reset_expires_at = ? WHERE id = ?`).run(resetToken, expiresAt, row.id);
  return {
    resetToken,
    expiresAt,
    notice: process.env.SMTP_HOST
      ? 'Password recovery email sent.'
      : 'SMTP not configured; use the time-limited recovery token directly in the reset form.',
  };
}

export function completePasswordReset(email: string, token: string, newPassword: string): void {
  const db = getDb();
  const strength = validatePasswordStrength(newPassword);
  if (!strength.valid) throw new Error(strength.issues.join(' '));
  const row = db
    .prepare(`SELECT id, reset_token, reset_expires_at FROM users WHERE LOWER(email) = ?`)
    .get(email.trim().toLowerCase()) as
    | { id: string; reset_token: string | null; reset_expires_at: string | null }
    | undefined;
  if (!row || !row.reset_token || row.reset_token !== token.trim()) {
    throw new Error('Invalid recovery token.');
  }
  if (!row.reset_expires_at || new Date(row.reset_expires_at).getTime() < Date.now()) {
    throw new Error('Recovery token has expired.');
  }
  const hash = bcrypt.hashSync(newPassword, 10);
  db.prepare(
    `UPDATE users SET password_hash = ?, reset_token = NULL, reset_expires_at = NULL, failed_login_attempts = 0, locked_until = NULL WHERE id = ?`
  ).run(hash, row.id);
  // Revoke existing sessions on password reset
  db.prepare(`UPDATE sessions SET revoked_at = datetime('now') WHERE user_id = ?`).run(row.id);
}

export function listUserSessions(userId: string) {
  const db = getDb();
  return db
    .prepare(
      `SELECT substr(token, 1, 10) || '...' as session_prefix, token, device_label, ip_address, created_at, expires_at, revoked_at
       FROM sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 20`
    )
    .all(userId);
}

export function revokeSession(userId: string, token?: string, revokeAll = false): number {
  const db = getDb();
  if (revokeAll) {
    const info = db
      .prepare(`UPDATE sessions SET revoked_at = datetime('now') WHERE user_id = ? AND revoked_at IS NULL`)
      .run(userId);
    return Number(info.changes || 0);
  }
  if (!token) return 0;
  const info = db
    .prepare(`UPDATE sessions SET revoked_at = datetime('now') WHERE user_id = ? AND token = ?`)
    .run(userId, token);
  return Number(info.changes || 0);
}
