import React, { useEffect, useState } from 'react';
import { Save } from 'lucide-react';
import { useOmnix } from '../../contexts/OmnixContext';

interface AIModelInfo {
  id: string;
  name: string;
  provider: string;
  modality: string;
  is_local: number;
  requires_api_key: number;
}

export function SettingsView() {
  const { language, setLanguage } = useOmnix();
  const [settings, setSettings] = useState<Record<string, unknown>>({});
  const [models, setModels] = useState<AIModelInfo[]>([]);
  const [geminiConfigured, setGeminiConfigured] = useState(false);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/settings')
      .then((r) => r.json())
      .then((d) => {
        setSettings(d.settings || {});
        setModels(d.models || []);
        setGeminiConfigured(Boolean(d.geminiConfigured));
      })
      .catch(() => {});
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...settings, language }),
    });
    if (res.ok) {
      setSavedNotice('Unified platform settings persisted to SQLite.');
    }
  };

  return (
    <div className="space-y-6">
      <div className="border-b border-slate-800/80 pb-4">
        <h1 className="font-display text-2xl font-bold text-slate-50">
          Unified System Settings & Model Gateway Policy
        </h1>
        <p className="mt-1 text-sm text-slate-400">
          Configure localization (LTR/RTL), local/cloud model routing, safety approvals, and
          adaptive memory preferences.
        </p>
      </div>

      {savedNotice && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-950/20 px-4 py-2.5 text-xs text-emerald-200">
          {savedNotice}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <form
          onSubmit={(e) => void handleSave(e)}
          className="lg:col-span-6 rounded-xl border border-slate-800 bg-[#111724] p-5 space-y-4 text-xs"
        >
          <h2 className="font-display text-sm font-semibold text-slate-100">
            Interface & Execution Defaults
          </h2>

          <div>
            <label htmlFor="set-lang" className="block text-slate-400 mb-1">
              Interface Language & Direction
            </label>
            <select
              id="set-lang"
              value={language}
              onChange={(e) => setLanguage(e.target.value as 'en' | 'ar')}
              className="w-full rounded-lg border border-slate-800 bg-[#0B0F17] px-3 py-2 text-slate-100"
            >
              <option value="en">English (LTR)</option>
              <option value="ar">العربية (RTL)</option>
            </select>
          </div>

          <div>
            <label htmlFor="set-model" className="block text-slate-400 mb-1">
              Default Model Gateway Target
            </label>
            <select
              id="set-model"
              value={String(settings.preferredModelId || 'gemini-4-hydrogen')}
              onChange={(e) => setSettings({ ...settings, preferredModelId: e.target.value })}
              className="w-full rounded-lg border border-slate-800 bg-[#0B0F17] px-3 py-2 text-slate-100"
            >
              <option value="gemini-4-hydrogen">Gemini 4 Hydrogen (Cloud + Auto Local Fallback)</option>
              <option value="omnix-local-core">OMNIX Local Deterministic Engine Only</option>
            </select>
          </div>

          <label className="flex items-center justify-between rounded-lg border border-slate-800 bg-[#0B0F17] p-3">
            <span className="text-slate-200">Require explicit approval for destructive actions</span>
            <input
              type="checkbox"
              checked={Boolean(settings.requireApprovalForDeletes ?? true)}
              onChange={(e) =>
                setSettings({ ...settings, requireApprovalForDeletes: e.target.checked })
              }
              className="h-4 w-4 accent-sky-500"
            />
          </label>

          <button
            type="submit"
            className="flex items-center gap-2 rounded-lg bg-sky-500 px-4 py-2 font-semibold text-slate-950 hover:bg-sky-400"
          >
            <Save className="h-3.5 w-3.5" />
            <span>Save Settings</span>
          </button>
        </form>

        <section className="lg:col-span-6 rounded-xl border border-slate-800 bg-[#111724] p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <h2 className="font-display text-sm font-semibold text-slate-100">
              Unified Model Gateway Registry
            </h2>
            <span
              className={`font-mono text-xs ${
                geminiConfigured ? 'text-emerald-400' : 'text-amber-400'
              }`}
            >
              Cloud Key: {geminiConfigured ? 'Configured (Server-Side)' : 'Not Configured'}
            </span>
          </div>

          <div className="space-y-2.5">
            {models.map((m) => (
              <div key={m.id} className="rounded-lg border border-slate-800/80 bg-[#0B0F17] p-3 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-100">{m.name}</span>
                  <span className="font-mono text-slate-400">
                    {m.is_local ? 'Local' : 'Cloud'} · {m.modality}
                  </span>
                </div>
                <p className="mt-1 text-slate-400">
                  Provider: {m.provider} ·{' '}
                  {m.requires_api_key
                    ? 'Requires runtime GEMINI_API_KEY secret (auto-falls back to local engine if absent)'
                    : 'Zero external key required'}
                </p>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
