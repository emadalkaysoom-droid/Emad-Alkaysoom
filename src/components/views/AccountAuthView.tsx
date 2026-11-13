import React, { useCallback, useEffect, useState } from 'react';
import { KeyRound, LogOut, ShieldCheck, Smartphone, UserCheck, UserPlus } from 'lucide-react';
import { useOmnix } from '../../contexts/OmnixContext';
import { apiFetch } from '../../lib/apiClient';

export function AccountAuthView() {
  const { user, subscription, language, setLanguage, refreshSession, triggerRefresh, setActiveView } = useOmnix();
  const isAr = language === 'ar';

  const [mode, setMode] = useState<'profile' | 'login' | 'register' | 'recovery'>('profile');
  const [sessions, setSessions] = useState<Array<{ session_prefix: string; device_label: string; ip_address: string; created_at: string; revoked_at: string | null }>>([]);
  const [stats, setStats] = useState<{ conversations: number; codexRuns: number; labExperiments: number; autobuildProjects: number } | null>(null);
  const [googleOAuthConfigured, setGoogleOAuthConfigured] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Login form
  const [loginIdent, setLoginIdent] = useState('');
  const [loginPass, setLoginPass] = useState('');
  const [loginTotp, setLoginTotp] = useState('');

  // Register form
  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPass, setRegPass] = useState('');
  const [regConfirm, setRegConfirm] = useState('');
  const [country, setCountry] = useState('US');
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [verifyTokenHint, setVerifyTokenHint] = useState('');
  const [verifyInput, setVerifyInput] = useState('');

  // Recovery form
  const [recEmail, setRecEmail] = useState('');
  const [recToken, setRecToken] = useState('');
  const [recNewPass, setRecNewPass] = useState('');

  // Profile & 2FA
  const [editName, setEditName] = useState('');
  const [editCountry, setEditCountry] = useState('US');
  const [totpSetup, setTotpSetup] = useState<{ secret: string; otpauthUri: string; sampleCode: string } | null>(null);
  const [totpVerifyCode, setTotpVerifyCode] = useState('');

  const loadProfile = useCallback(async () => {
    const res = await apiFetch('/api/id/profile');
    if (res.ok) {
      const data = await res.json();
      setSessions(data.sessions || []);
      setStats(data.stats || null);
      setGoogleOAuthConfigured(Boolean(data.googleOAuthConfigured));
      setEditName(data.user?.full_name || data.user?.name || '');
      setEditCountry(data.user?.country || 'US');
    }
  }, []);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile, user?.id]);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setMsg(null);
    const res = await fetch('/api/id/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fullName,
        username,
        email: regEmail,
        password: regPass,
        confirmPassword: regConfirm,
        country,
        preferredLanguage: language,
        termsAccepted,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setErr(data.error || 'Registration failed');
      return;
    }
    localStorage.setItem('omnix_token', data.token);
    setVerifyTokenHint(data.verificationToken || '');
    setMsg(`Account created & signed in as ${data.user.username} (FREE_USER). ${data.emailNotice}`);
    await refreshSession();
    triggerRefresh();
    setMode('profile');
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setMsg(null);
    const res = await fetch('/api/id/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: loginIdent, password: loginPass, totpCode: loginTotp || undefined }),
    });
    const data = await res.json();
    if (!res.ok) {
      setErr(data.error || 'Sign in failed');
      return;
    }
    localStorage.setItem('omnix_token', data.token);
    setMsg(data.suspiciousAlert ? `Signed in. Security notice: ${data.suspiciousAlert}` : `Signed in as ${data.user.email}`);
    await refreshSession();
    triggerRefresh();
    setMode('profile');
  };

  const verifyEmail = async () => {
    setErr(null);
    const res = await apiFetch('/api/id/verify-email', {
      method: 'POST',
      body: JSON.stringify({ token: verifyInput }),
    });
    const data = await res.json();
    if (!res.ok) {
      setErr(data.error || 'Verification failed');
      return;
    }
    setMsg('Email verified successfully.');
    setVerifyTokenHint('');
    await refreshSession();
  };

  const saveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await apiFetch('/api/id/profile', {
      method: 'PUT',
      body: JSON.stringify({ fullName: editName, country: editCountry, preferredLanguage: language }),
    });
    if (res.ok) {
      setMsg('Profile updated.');
      await refreshSession();
    }
  };

  const logout = async (allDevices = false) => {
    await apiFetch('/api/id/logout', { method: 'POST', body: JSON.stringify({ allDevices }) });
    localStorage.removeItem('omnix_token');
    setMsg(allDevices ? 'Signed out across all connected devices.' : 'Signed out.');
    await refreshSession();
    triggerRefresh();
  };

  const setup2FA = async () => {
    const res = await apiFetch('/api/id/2fa/setup', { method: 'POST' });
    if (res.ok) setTotpSetup(await res.json());
  };

  const enable2FA = async () => {
    setErr(null);
    const res = await apiFetch('/api/id/2fa/enable', {
      method: 'POST',
      body: JSON.stringify({ code: totpVerifyCode }),
    });
    const data = await res.json();
    if (!res.ok) {
      setErr(data.error || 'Invalid 2FA code');
      return;
    }
    setMsg('Two-Factor Authentication (TOTP) enabled.');
    setTotpSetup(null);
    await refreshSession();
  };

  const disable2FA = async () => {
    await apiFetch('/api/id/2fa/disable', { method: 'POST' });
    setMsg('Two-Factor Authentication disabled.');
    await refreshSession();
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-4">
        <div>
          <h1 className="font-display text-xl font-bold text-slate-100 flex items-center gap-2">
            <UserCheck className="h-5 w-5 text-sky-400" />
            <span>OMNIX ID · {isAr ? 'نظام الحسابات والهوية والأمان' : 'Universal Account & Identity'}</span>
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            {isAr
              ? 'تسجيل حسابات مستقلة، إدارة الجلسات والأجهزة، التحقق من البريد، استعادة كلمة المرور، والمصادقة الثنائية 2FA.'
              : 'Independent human accounts, bcrypt credential hashing, email verification, device session control, password recovery, and TOTP 2FA.'}
          </p>
        </div>

        <div className="flex rounded-md border border-slate-800 bg-[#0F141F] p-0.5 text-xs">
          {([
            ['profile', isAr ? 'الملف الشخصي' : 'Profile & Security'],
            ['login', isAr ? 'تسجيل الدخول' : 'Sign In'],
            ['register', isAr ? 'إنشاء حساب' : 'Create Account'],
            ['recovery', isAr ? 'استعادة كلمة المرور' : 'Reset Password'],
          ] as const).map(([id, lbl]) => (
            <button
              key={id}
              type="button"
              onClick={() => { setMode(id); setErr(null); setMsg(null); }}
              className={`rounded px-3 py-1.5 font-medium ${mode === id ? 'bg-sky-500/20 text-sky-300' : 'text-slate-400 hover:text-slate-200'}`}
            >
              {lbl}
            </button>
          ))}
        </div>
      </div>

      {msg && <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-4 py-2 text-xs text-emerald-200">{msg}</div>}
      {err && <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-4 py-2 text-xs text-rose-200">{err}</div>}

      {mode === 'profile' && user && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 text-xs">
          <div className="rounded-lg border border-slate-800 bg-[#0F141F] p-4 space-y-3">
            <div className="border-b border-slate-800 pb-3">
              <div className="text-sm font-bold text-slate-100">{user.full_name || user.name}</div>
              <div className="text-slate-400 font-mono">@{user.username || 'architect'} · {user.email}</div>
              <div className="mt-2 flex flex-wrap gap-2 font-mono text-[11px]">
                <span className="rounded border border-slate-700 px-2 py-0.5 text-sky-300">{user.account_role || 'FREE_USER'}</span>
                <span className={`rounded border px-2 py-0.5 ${user.email_verified ? 'border-emerald-500/40 text-emerald-300' : 'border-amber-500/40 text-amber-300'}`}>
                  {user.email_verified ? 'Email Verified' : 'Unverified Email'}
                </span>
              </div>
            </div>

            {!user.email_verified && (
              <div className="rounded border border-amber-500/30 bg-amber-500/10 p-2.5 space-y-2">
                <div className="text-amber-200 font-medium">Verify Account Email</div>
                {verifyTokenHint && <div className="font-mono text-[11px] text-amber-300">Token: {verifyTokenHint}</div>}
                <div className="flex gap-1.5">
                  <input value={verifyInput} onChange={(e) => setVerifyInput(e.target.value)} placeholder="Paste verification token" className="flex-1 rounded border border-slate-700 bg-[#0B0F17] px-2 py-1 text-slate-100" />
                  <button type="button" onClick={() => void verifyEmail()} className="rounded bg-amber-600 px-2.5 py-1 font-semibold text-white">Verify</button>
                </div>
              </div>
            )}

            <form onSubmit={(e) => void saveProfile(e)} className="space-y-2.5">
              <div>
                <label className="block text-slate-400 mb-1">Full Name</label>
                <input value={editName} onChange={(e) => setEditName(e.target.value)} className="w-full rounded border border-slate-800 bg-[#0B0F17] px-2.5 py-1.5 text-slate-100" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-slate-400 mb-1">Country</label>
                  <input value={editCountry} onChange={(e) => setEditCountry(e.target.value)} className="w-full rounded border border-slate-800 bg-[#0B0F17] px-2.5 py-1.5 text-slate-100" />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Language</label>
                  <select value={language} onChange={(e) => setLanguage(e.target.value as 'en' | 'ar')} className="w-full rounded border border-slate-800 bg-[#0B0F17] px-2 py-1.5 text-slate-100">
                    <option value="en">English</option>
                    <option value="ar">العربية</option>
                  </select>
                </div>
              </div>
              <button type="submit" className="w-full rounded bg-sky-600 py-1.5 font-semibold text-white hover:bg-sky-500">Save Profile</button>
            </form>

            <div className="border-t border-slate-800 pt-3 flex items-center justify-between">
              <div>
                <div className="text-slate-400">Subscription</div>
                <div className="font-mono font-bold text-slate-100">{subscription?.planCode || 'FREE'} ({subscription?.status})</div>
              </div>
              <button type="button" onClick={() => setActiveView('billing')} className="rounded border border-sky-500/40 bg-sky-500/15 px-3 py-1.5 text-sky-300">
                Manage Plan
              </button>
            </div>
          </div>

          <div className="rounded-lg border border-slate-800 bg-[#0F141F] p-4 space-y-3">
            <h2 className="font-semibold text-slate-200 flex items-center gap-1.5 border-b border-slate-800 pb-2">
              <ShieldCheck className="h-4 w-4 text-sky-400" />
              <span>Two-Factor Authentication (TOTP 2FA)</span>
            </h2>
            <p className="text-slate-400">
              Status: <span className={user.two_factor_enabled ? 'text-emerald-400 font-semibold' : 'text-slate-300'}>{user.two_factor_enabled ? 'Enabled' : 'Disabled'}</span>
            </p>
            {user.two_factor_enabled ? (
              <button type="button" onClick={() => void disable2FA()} className="rounded border border-rose-500/40 bg-rose-500/10 px-3 py-1.5 text-rose-300">
                Disable 2FA
              </button>
            ) : !totpSetup ? (
              <button type="button" onClick={() => void setup2FA()} className="rounded bg-sky-600 px-3 py-1.5 font-semibold text-white">
                Configure Authenticator 2FA
              </button>
            ) : (
              <div className="space-y-2 rounded border border-slate-800 bg-[#0B0F17] p-3">
                <div className="font-mono text-[11px] text-sky-300 break-all">Secret: {totpSetup.secret}</div>
                <div className="font-mono text-[11px] text-emerald-300">Current TOTP Code: {totpSetup.sampleCode}</div>
                <div className="flex gap-2">
                  <input value={totpVerifyCode} onChange={(e) => setTotpVerifyCode(e.target.value)} placeholder="6-digit code" className="flex-1 rounded border border-slate-700 bg-[#0F141F] px-2 py-1 font-mono text-slate-100" />
                  <button type="button" onClick={() => void enable2FA()} className="rounded bg-emerald-600 px-3 py-1 font-semibold text-white">Activate</button>
                </div>
              </div>
            )}

            <div className="border-t border-slate-800 pt-3">
              <div className="font-semibold text-slate-300 mb-1">Google OAuth Status</div>
              <div className="text-slate-400">
                {googleOAuthConfigured ? 'Google OAuth Client configured.' : 'Google OAuth not configured in environment secrets (local OMNIX ID auth active).'}
              </div>
            </div>

            {stats && (
              <div className="border-t border-slate-800 pt-3 grid grid-cols-2 gap-2">
                <div><span className="text-slate-400">Conversations:</span> <span className="font-mono text-slate-100">{stats.conversations}</span></div>
                <div><span className="text-slate-400">Codex Scans:</span> <span className="font-mono text-slate-100">{stats.codexRuns}</span></div>
                <div><span className="text-slate-400">Lab Runs:</span> <span className="font-mono text-slate-100">{stats.labExperiments}</span></div>
                <div><span className="text-slate-400">AutoBuilds:</span> <span className="font-mono text-slate-100">{stats.autobuildProjects}</span></div>
              </div>
            )}
          </div>

          <div className="rounded-lg border border-slate-800 bg-[#0F141F] p-4 space-y-3">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <span className="font-semibold text-slate-200 flex items-center gap-1.5">
                <Smartphone className="h-4 w-4 text-sky-400" />
                <span>Connected Devices</span>
              </span>
              <div className="flex gap-1.5">
                <button type="button" onClick={() => void logout(false)} className="rounded border border-slate-700 px-2 py-1 text-slate-300 hover:bg-slate-800">Logout</button>
                <button type="button" onClick={() => void logout(true)} className="flex items-center gap-1 rounded border border-rose-500/40 px-2 py-1 text-rose-300 hover:bg-rose-500/10">
                  <LogOut className="h-3 w-3" />
                  <span>All</span>
                </button>
              </div>
            </div>
            <div className="divide-y divide-slate-800/80 max-h-72 overflow-y-auto">
              {sessions.length === 0 ? (
                <p className="text-slate-400 py-2">Operating in default workspace session. Sign in or register for isolated personal sessions.</p>
              ) : (
                sessions.map((s) => (
                  <div key={s.session_prefix + s.created_at} className="py-2">
                    <div className="flex justify-between text-slate-200">
                      <span className="truncate max-w-[160px]">{s.device_label}</span>
                      <span className={`font-mono ${s.revoked_at ? 'text-rose-400' : 'text-emerald-400'}`}>{s.revoked_at ? 'Revoked' : 'Active'}</span>
                    </div>
                    <div className="font-mono text-[11px] text-slate-500">{s.ip_address} · {s.created_at}</div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {mode === 'login' && (
        <form onSubmit={(e) => void handleLogin(e)} className="max-w-md rounded-lg border border-slate-800 bg-[#0F141F] p-5 space-y-3 text-xs">
          <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-1.5">
            <KeyRound className="h-4 w-4 text-sky-400" />
            <span>Sign In with OMNIX ID</span>
          </h2>
          <div>
            <label className="block text-slate-400 mb-1">Email or Username</label>
            <input required value={loginIdent} onChange={(e) => setLoginIdent(e.target.value)} className="w-full rounded border border-slate-800 bg-[#0B0F17] px-3 py-2 text-slate-100" />
          </div>
          <div>
            <label className="block text-slate-400 mb-1">Password</label>
            <input required type="password" value={loginPass} onChange={(e) => setLoginPass(e.target.value)} className="w-full rounded border border-slate-800 bg-[#0B0F17] px-3 py-2 text-slate-100" />
          </div>
          <div>
            <label className="block text-slate-400 mb-1">2FA Code (if enabled)</label>
            <input value={loginTotp} onChange={(e) => setLoginTotp(e.target.value)} placeholder="Optional 6-digit code" className="w-full rounded border border-slate-800 bg-[#0B0F17] px-3 py-2 font-mono text-slate-100" />
          </div>
          <button type="submit" className="w-full rounded bg-sky-600 py-2 font-semibold text-white hover:bg-sky-500">Sign In</button>
        </form>
      )}

      {mode === 'register' && (
        <form onSubmit={(e) => void handleRegister(e)} className="max-w-lg rounded-lg border border-slate-800 bg-[#0F141F] p-5 space-y-3 text-xs">
          <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-1.5">
            <UserPlus className="h-4 w-4 text-sky-400" />
            <span>Create Independent OMNIX ID Account</span>
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="reg-full-name" className="block text-slate-400 mb-1">Full Name</label>
              <input id="reg-full-name" required value={fullName} onChange={(e) => setFullName(e.target.value)} className="w-full rounded border border-slate-800 bg-[#0B0F17] px-3 py-2 text-slate-100" />
            </div>
            <div>
              <label htmlFor="reg-username" className="block text-slate-400 mb-1">Username</label>
              <input id="reg-username" required value={username} onChange={(e) => setUsername(e.target.value)} className="w-full rounded border border-slate-800 bg-[#0B0F17] px-3 py-2 text-slate-100" />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="reg-email" className="block text-slate-400 mb-1">Email</label>
              <input id="reg-email" required type="email" value={regEmail} onChange={(e) => setRegEmail(e.target.value)} className="w-full rounded border border-slate-800 bg-[#0B0F17] px-3 py-2 text-slate-100" />
            </div>
            <div>
              <label htmlFor="reg-country" className="block text-slate-400 mb-1">Country</label>
              <input id="reg-country" value={country} onChange={(e) => setCountry(e.target.value)} className="w-full rounded border border-slate-800 bg-[#0B0F17] px-3 py-2 text-slate-100" />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="reg-password" className="block text-slate-400 mb-1">Password (8+ chars, mixed + symbol)</label>
              <input id="reg-password" required type="password" value={regPass} onChange={(e) => setRegPass(e.target.value)} className="w-full rounded border border-slate-800 bg-[#0B0F17] px-3 py-2 text-slate-100" />
            </div>
            <div>
              <label htmlFor="reg-confirm" className="block text-slate-400 mb-1">Confirm Password</label>
              <input id="reg-confirm" required type="password" value={regConfirm} onChange={(e) => setRegConfirm(e.target.value)} className="w-full rounded border border-slate-800 bg-[#0B0F17] px-3 py-2 text-slate-100" />
            </div>
          </div>
          <label className="flex items-center gap-2 text-slate-300">
            <input type="checkbox" checked={termsAccepted} onChange={(e) => setTermsAccepted(e.target.checked)} />
            <span>I accept the OMNIX Security, Privacy & Terms of Service.</span>
          </label>
          <button type="submit" className="w-full rounded bg-sky-600 py-2 font-semibold text-white hover:bg-sky-500">Register Free Account</button>
        </form>
      )}

      {mode === 'recovery' && (
        <div className="max-w-md rounded-lg border border-slate-800 bg-[#0F141F] p-5 space-y-4 text-xs">
          <h2 className="text-sm font-semibold text-slate-100">Password Recovery</h2>
          <div className="space-y-2">
            <input value={recEmail} onChange={(e) => setRecEmail(e.target.value)} placeholder="Account email" className="w-full rounded border border-slate-800 bg-[#0B0F17] px-3 py-2 text-slate-100" />
            <button
              type="button"
              onClick={async () => {
                setErr(null);
                const res = await fetch('/api/id/password-reset/request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: recEmail }) });
                const data = await res.json();
                if (!res.ok) setErr(data.error);
                else { setRecToken(data.resetToken); setMsg(`${data.notice} Token: ${data.resetToken}`); }
              }}
              className="rounded border border-sky-500/40 bg-sky-500/15 px-3 py-1.5 text-sky-300"
            >
              Request Recovery Token
            </button>
          </div>
          <div className="border-t border-slate-800 pt-3 space-y-2">
            <input value={recToken} onChange={(e) => setRecToken(e.target.value)} placeholder="Recovery token" className="w-full rounded border border-slate-800 bg-[#0B0F17] px-3 py-2 font-mono text-slate-100" />
            <input type="password" value={recNewPass} onChange={(e) => setRecNewPass(e.target.value)} placeholder="New strong password" className="w-full rounded border border-slate-800 bg-[#0B0F17] px-3 py-2 text-slate-100" />
            <button
              type="button"
              onClick={async () => {
                setErr(null);
                const res = await fetch('/api/id/password-reset/confirm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: recEmail, token: recToken, newPassword: recNewPass }) });
                const data = await res.json();
                if (!res.ok) setErr(data.error);
                else setMsg('Password reset complete. Sign in with new password.');
              }}
              className="w-full rounded bg-emerald-600 py-2 font-semibold text-white"
            >
              Confirm Password Reset
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
