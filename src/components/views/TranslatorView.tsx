import React, { useCallback, useEffect, useState } from 'react';
import { BookOpen, CheckCircle2, FileUp, Languages, Mic, Subtitles, Volume2 } from 'lucide-react';
import { useOmnix } from '../../contexts/OmnixContext';
import { apiFetch } from '../../lib/apiClient';
import type { TranslationDomain, TranslationTone } from '../../../shared/translatorEngine';

const TONES: TranslationTone[] = ['Technical', 'Academic', 'Legal', 'Business', 'Literary', 'Formal', 'Casual'];
const DOMAINS: TranslationDomain[] = ['Software Engineering', 'Physics & Science', 'Law', 'Medicine', 'Finance', 'Marketing', 'Academic', 'General'];
const LANG_OPTIONS = [
  ['en', 'English'],
  ['ar', 'Arabic (العربية)'],
  ['fr', 'French (Français)'],
  ['es', 'Spanish (Español)'],
  ['de', 'German (Deutsch)'],
  ['zh', 'Chinese (中文)'],
  ['ja', 'Japanese (日本語)'],
];

export function TranslatorView() {
  const { activeWorkspaceId, language, hasEntitlement, setActiveView } = useOmnix();
  const isAr = language === 'ar';

  const [tab, setTab] = useState<'text' | 'voice' | 'subtitles' | 'glossary'>('text');
  const [sourceLang, setSourceLang] = useState('en');
  const [targetLang, setTargetLang] = useState('ar');
  const [tone, setTone] = useState<TranslationTone>('Technical');
  const [domain, setDomain] = useState<TranslationDomain>('Software Engineering');
  const [sourceText, setSourceText] = useState('The Dependency Graph tracks database tables, system architecture, and authentication modules.');
  const [translatedText, setTranslatedText] = useState('');
  const [backTranslation, setBackTranslation] = useState('');
  const [runBackTrans, setRunBackTrans] = useState(true);
  const [qaReport, setQaReport] = useState<{ glossaryCompliancePct: number; issues: string[] } | null>(null);
  const [tmMeta, setTmMeta] = useState<{ used: boolean; score: number; provider: string } | null>(null);

  // Voice conversation
  const [listening, setListening] = useState(false);
  const [voiceNote, setVoiceNote] = useState('');

  // Subtitles
  const [srtInput, setSrtInput] = useState('1\n00:00:01,000 --> 00:00:04,000\nWelcome to OMNIX system architecture overview.\n\n2\n00:00:04,500 --> 00:00:08,000\nAuthentication and database layers are verified.');
  const [srtOutput, setSrtOutput] = useState('');

  // Glossaries & TM
  const [glossaries, setGlossaries] = useState<Array<{ id: string; domain: string; source_term: string; target_term: string }>>([]);
  const [tmList, setTmList] = useState<Array<{ id: string; source_text: string; target_text: string; domain: string }>>([]);
  const [newSrcTerm, setNewSrcTerm] = useState('');
  const [newTgtTerm, setNewTgtTerm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadOverview = useCallback(async () => {
    const res = await apiFetch(`/api/translator/overview?workspaceId=${encodeURIComponent(activeWorkspaceId)}`);
    if (res.ok) {
      const data = await res.json();
      setGlossaries(data.glossaries || []);
      setTmList(data.memory || []);
    }
  }, [activeWorkspaceId]);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  const executeTranslate = async (overrideText?: string, jobType: 'text' | 'document' | 'voice' = 'text') => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch('/api/translator/translate', {
        method: 'POST',
        body: JSON.stringify({
          workspaceId: activeWorkspaceId,
          text: overrideText ?? sourceText,
          sourceLang,
          targetLang,
          tone,
          domain,
          jobType,
          runBackTranslation: runBackTrans && hasEntitlement('OMNI_TRANSLATOR_PRO'),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Translation failed');
      setTranslatedText(data.translatedText);
      setBackTranslation(data.backTranslation || '');
      setQaReport(data.quality);
      setTmMeta({ used: data.usedTranslationMemory, score: data.tmMatchScore, provider: data.provider });
      void loadOverview();
      return data.translatedText as string;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Translation failed');
      return '';
    } finally {
      setLoading(false);
    }
  };

  const handleDocUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setSourceText(text.slice(0, 6000));
    await executeTranslate(text.slice(0, 6000), 'document');
  };

  const translateSubtitles = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch('/api/translator/subtitles', {
        method: 'POST',
        body: JSON.stringify({ workspaceId: activeWorkspaceId, subtitleContent: srtInput, sourceLang, targetLang, domain }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Subtitle translation requires OMNIX PREMIUM');
      setSrtOutput(data.outputSubtitle);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Subtitle error');
    } finally {
      setLoading(false);
    }
  };

  const addGlossary = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSrcTerm.trim() || !newTgtTerm.trim()) return;
    setError(null);
    const res = await apiFetch('/api/translator/glossaries', {
      method: 'POST',
      body: JSON.stringify({ workspaceId: activeWorkspaceId, domain, sourceLang, targetLang, sourceTerm: newSrcTerm, targetTerm: newTgtTerm }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || 'Custom glossaries require OMNIX PREMIUM');
      return;
    }
    setNewSrcTerm('');
    setNewTgtTerm('');
    void loadOverview();
  };

  const startVoiceConversation = () => {
    const SpeechRec = (window as unknown as { SpeechRecognition?: new () => unknown; webkitSpeechRecognition?: new () => unknown }).SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: new () => unknown }).webkitSpeechRecognition;
    if (!SpeechRec) {
      setVoiceNote('Browser Web Speech Recognition API unavailable in this browser; type text below and use Speak Output.');
      return;
    }
    const rec = new SpeechRec() as {
      lang: string;
      interimResults: boolean;
      onresult: (ev: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void;
      onerror: () => void;
      onend: () => void;
      start: () => void;
    };
    rec.lang = sourceLang === 'ar' ? 'ar-SA' : 'en-US';
    rec.interimResults = false;
    setListening(true);
    setVoiceNote('Listening...');
    rec.onresult = async (ev) => {
      const transcript = ev.results[0]?.[0]?.transcript || '';
      setSourceText(transcript);
      const out = await executeTranslate(transcript, 'voice');
      if (out && 'speechSynthesis' in window) {
        const u = new SpeechSynthesisUtterance(out);
        u.lang = targetLang === 'ar' ? 'ar-SA' : 'en-US';
        window.speechSynthesis.speak(u);
      }
      setVoiceNote(`Captured: "${transcript}"`);
    };
    rec.onerror = () => {
      setListening(false);
      setVoiceNote('Microphone capture aborted or permission denied.');
    };
    rec.onend = () => setListening(false);
    rec.start();
  };

  const speakTranslated = () => {
    if (!translatedText || !('speechSynthesis' in window)) return;
    const u = new SpeechSynthesisUtterance(translatedText);
    u.lang = targetLang === 'ar' ? 'ar-SA' : 'en-US';
    window.speechSynthesis.speak(u);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-4">
        <div>
          <h1 className="font-display text-xl font-bold text-slate-100 flex items-center gap-2">
            <Languages className="h-5 w-5 text-sky-400" />
            <span>OMNI TRANSLATOR · {isAr ? 'محرك الترجمة الشامل متعدد الوسائط' : 'Universal Multimodal Translator'}</span>
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            {isAr
              ? 'ترجمة سياقية حسب التخصص والأسلوب، ترجمة المستندات والملفات الصوتية والترجمة الزمنية SRT/VTT مع ذاكرة ترجمة وقواميس.'
              : 'Context/tone-aware translation, document upload, Web Speech conversation mode, .srt/.vtt subtitle sync, Glossaries, TM, and back-translation QA.'}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {!hasEntitlement('OMNI_TRANSLATOR_PRO') && (
            <button
              type="button"
              onClick={() => setActiveView('billing')}
              className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-300"
            >
              {isAr ? 'ترقية لفتح الترجمة الزمنية والقواميس' : 'Unlock Subtitles & Glossaries ($5/3mo)'}
            </button>
          )}
          <div className="flex rounded-md border border-slate-800 bg-[#0F141F] p-0.5 text-xs">
            {([
              ['text', isAr ? 'نصوص ومستندات' : 'Text & Docs'],
              ['voice', isAr ? 'محادثة صوتية' : 'Voice Mode'],
              ['subtitles', isAr ? 'ترجمة الفيديو SRT' : 'Video Subtitles'],
              ['glossary', isAr ? 'القواميس والذاكرة' : 'Glossary & TM'],
            ] as const).map(([id, lbl]) => (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                className={`rounded px-3 py-1.5 font-medium transition-colors ${
                  tab === id ? 'bg-sky-500/20 text-sky-300' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {lbl}
              </button>
            ))}
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-4 py-2 text-xs text-rose-200">{error}</div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
        <div>
          <label className="block text-slate-400 mb-1">Source Language</label>
          <select value={sourceLang} onChange={(e) => setSourceLang(e.target.value)} className="w-full rounded border border-slate-800 bg-[#0F141F] p-2 text-slate-200">
            {LANG_OPTIONS.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-slate-400 mb-1">Target Language</label>
          <select value={targetLang} onChange={(e) => setTargetLang(e.target.value)} className="w-full rounded border border-slate-800 bg-[#0F141F] p-2 text-slate-200">
            {LANG_OPTIONS.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-slate-400 mb-1">Domain</label>
          <select value={domain} onChange={(e) => setDomain(e.target.value as TranslationDomain)} className="w-full rounded border border-slate-800 bg-[#0F141F] p-2 text-slate-200">
            {DOMAINS.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-slate-400 mb-1">Tone / Register</label>
          <select value={tone} onChange={(e) => setTone(e.target.value as TranslationTone)} className="w-full rounded border border-slate-800 bg-[#0F141F] p-2 text-slate-200">
            {TONES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
      </div>

      {(tab === 'text' || tab === 'voice') && (
        <div className="space-y-4">
          {tab === 'voice' && (
            <div className="rounded-lg border border-slate-800 bg-[#0F141F] p-4 flex flex-wrap items-center justify-between gap-3 text-xs">
              <div>
                <div className="font-semibold text-slate-100">Dual-Speaker Live Voice Conversation</div>
                <div className="text-slate-400 mt-0.5">{voiceNote || 'Capture live speech via browser Web Speech API, translate contextually, and play back audio.'}</div>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={startVoiceConversation}
                  className={`flex items-center gap-1.5 rounded-md px-3.5 py-2 font-semibold text-white ${listening ? 'bg-rose-600' : 'bg-sky-600 hover:bg-sky-500'}`}
                >
                  <Mic className="h-3.5 w-3.5" />
                  <span>{listening ? 'Listening...' : 'Speak & Translate'}</span>
                </button>
                <button
                  type="button"
                  onClick={speakTranslated}
                  disabled={!translatedText}
                  className="flex items-center gap-1.5 rounded-md border border-slate-700 px-3 py-2 text-slate-200 hover:bg-slate-800 disabled:opacity-40"
                >
                  <Volume2 className="h-3.5 w-3.5 text-sky-400" />
                  <span>Speak Output</span>
                </button>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="rounded-lg border border-slate-800 bg-[#0F141F] p-4 space-y-2.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-slate-300">Source ({sourceLang.toUpperCase()})</span>
                <label className="flex items-center gap-1.5 cursor-pointer rounded border border-slate-700 px-2.5 py-1 text-slate-300 hover:bg-slate-800">
                  <FileUp className="h-3.5 w-3.5 text-sky-400" />
                  <span>Upload TXT / HTML / CSV</span>
                  <input type="file" accept=".txt,.html,.csv,.md" onChange={(e) => void handleDocUpload(e)} className="hidden" />
                </label>
              </div>
              <textarea
                value={sourceText}
                onChange={(e) => setSourceText(e.target.value)}
                rows={6}
                className="w-full rounded-md border border-slate-800 bg-[#0B0F17] p-3 text-xs text-slate-100 focus:border-sky-500 focus:outline-none"
              />
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 text-xs text-slate-400">
                  <input type="checkbox" checked={runBackTrans} onChange={(e) => setRunBackTrans(e.target.checked)} />
                  <span>Run Back-Translation QA (Pro)</span>
                </label>
                <button
                  type="button"
                  onClick={() => void executeTranslate()}
                  disabled={loading}
                  className="rounded-md bg-sky-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-sky-500 disabled:opacity-50"
                >
                  {loading ? 'Translating...' : isAr ? 'ترجمة الآن' : 'Translate'}
                </button>
              </div>
            </div>

            <div className="rounded-lg border border-slate-800 bg-[#0F141F] p-4 space-y-2.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-slate-300">Translation ({targetLang.toUpperCase()})</span>
                {tmMeta && (
                  <span className="font-mono text-[11px] text-slate-400">
                    {tmMeta.used ? 'TM Exact Hit' : tmMeta.provider} · TM Sim {(tmMeta.score * 100).toFixed(0)}%
                  </span>
                )}
              </div>
              <div
                dir={targetLang === 'ar' ? 'rtl' : 'ltr'}
                className="min-h-[138px] rounded-md border border-slate-800 bg-[#0B0F17] p-3 text-xs text-slate-100 whitespace-pre-wrap"
              >
                {translatedText || <span className="text-slate-500">Translated output appears here...</span>}
              </div>
              {qaReport && (
                <div className="flex items-center justify-between text-[11px] border-t border-slate-800 pt-2">
                  <span className="flex items-center gap-1 text-emerald-400">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    <span>Glossary Compliance: {qaReport.glossaryCompliancePct}%</span>
                  </span>
                  <span className="text-slate-400">{qaReport.issues.length === 0 ? 'QA Clean' : qaReport.issues[0]}</span>
                </div>
              )}
              {backTranslation && (
                <div className="rounded bg-[#0B0F17] p-2 text-[11px] text-slate-400">
                  <strong className="text-slate-300">Back-Translation Check:</strong> {backTranslation}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {tab === 'subtitles' && (
        <div className="rounded-lg border border-slate-800 bg-[#0F141F] p-4 space-y-3 text-xs">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-slate-200 flex items-center gap-1.5">
              <Subtitles className="h-4 w-4 text-sky-400" />
              <span>Timestamp-Synchronized .SRT / .VTT Video Subtitle Translator</span>
            </span>
            <button
              type="button"
              onClick={() => void translateSubtitles()}
              disabled={loading}
              className="rounded bg-sky-600 px-3.5 py-1.5 font-semibold text-white hover:bg-sky-500"
            >
              Translate Subtitles
            </button>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <textarea
              value={srtInput}
              onChange={(e) => setSrtInput(e.target.value)}
              rows={8}
              className="w-full rounded border border-slate-800 bg-[#0B0F17] p-2.5 font-mono text-[11px] text-slate-200"
            />
            <textarea
              readOnly
              value={srtOutput}
              rows={8}
              placeholder="Timestamp-preserved translated .srt / .vtt appears here..."
              className="w-full rounded border border-slate-800 bg-[#0B0F17] p-2.5 font-mono text-[11px] text-emerald-300"
            />
          </div>
        </div>
      )}

      {tab === 'glossary' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 text-xs">
          <div className="rounded-lg border border-slate-800 bg-[#0F141F] p-4 space-y-3">
            <h2 className="font-semibold text-slate-200 flex items-center gap-1.5">
              <BookOpen className="h-4 w-4 text-sky-400" />
              <span>Technical Terminology Glossaries</span>
            </h2>
            <form onSubmit={(e) => void addGlossary(e)} className="flex gap-2">
              <input value={newSrcTerm} onChange={(e) => setNewSrcTerm(e.target.value)} placeholder="Source term" className="flex-1 rounded border border-slate-800 bg-[#0B0F17] px-2.5 py-1.5 text-slate-100" />
              <input value={newTgtTerm} onChange={(e) => setNewTgtTerm(e.target.value)} placeholder="Target term" className="flex-1 rounded border border-slate-800 bg-[#0B0F17] px-2.5 py-1.5 text-slate-100" />
              <button type="submit" className="rounded bg-sky-600 px-3 py-1.5 font-semibold text-white">Add</button>
            </form>
            <div className="divide-y divide-slate-800/80 max-h-60 overflow-y-auto">
              {glossaries.map((g) => (
                <div key={g.id} className="flex justify-between py-2">
                  <span className="text-slate-200">{g.source_term} → {g.target_term}</span>
                  <span className="font-mono text-slate-500">{g.domain}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-slate-800 bg-[#0F141F] p-4 space-y-3">
            <h2 className="font-semibold text-slate-200">Persistent Translation Memory (TM)</h2>
            <div className="divide-y divide-slate-800/80 max-h-72 overflow-y-auto">
              {tmList.length === 0 ? (
                <p className="text-slate-400">Translations automatically build project TM.</p>
              ) : (
                tmList.map((tm) => (
                  <div key={tm.id} className="py-2 space-y-0.5">
                    <div className="text-slate-300 truncate">{tm.source_text}</div>
                    <div className="text-sky-300 truncate">{tm.target_text}</div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
