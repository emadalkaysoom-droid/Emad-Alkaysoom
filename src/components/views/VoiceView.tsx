import React, { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, Square, Volume2 } from 'lucide-react';
import { useOmnix } from '../../contexts/OmnixContext';

export function VoiceView() {
  const { activeWorkspaceId, triggerRefresh } = useOmnix();
  const [speechLang, setSpeechLang] = useState<'en-US' | 'ar-SA'>('en-US');
  const [rate, setRate] = useState(1.0);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedVoiceURI, setSelectedVoiceURI] = useState('');
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [responseText, setResponseText] = useState('');
  const [vadLevel, setVadLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number>(0);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    const loadVoices = () => {
      if (!('speechSynthesis' in window)) return;
      const list = window.speechSynthesis.getVoices();
      setVoices(list);
      if (list.length > 0 && !selectedVoiceURI) {
        setSelectedVoiceURI(list[0].voiceURI);
      }
    };
    loadVoices();
    if ('speechSynthesis' in window) {
      window.speechSynthesis.onvoiceschanged = loadVoices;
    }
    return () => {
      cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      audioCtxRef.current?.close().catch(() => {});
    };
  }, [selectedVoiceURI]);

  const stopAudioMonitor = () => {
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setVadLevel(0);
  };

  const startVoiceConversation = async () => {
    setError(null);
    // Interrupt any active TTS playback immediately
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      setSpeaking(false);
    }

    // Start Web Audio VAD waveform meter if microphone permission is granted
    try {
      if (navigator.mediaDevices?.getUserMedia) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        streamRef.current = stream;
        const ctx = new AudioContext();
        audioCtxRef.current = ctx;
        const src = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 128;
        src.connect(analyser);
        const data = new Uint8Array(analyser.frequencyBinCount);

        const draw = () => {
          analyser.getByteFrequencyData(data);
          const avg = data.reduce((a, b) => a + b, 0) / data.length;
          setVadLevel(Math.round((avg / 255) * 100));
          const canvas = canvasRef.current;
          if (canvas) {
            const c = canvas.getContext('2d');
            if (c) {
              c.fillStyle = '#0B0F17';
              c.fillRect(0, 0, canvas.width, canvas.height);
              c.fillStyle = '#38bdf8';
              const barW = canvas.width / data.length;
              for (let i = 0; i < data.length; i++) {
                const barH = (data[i] / 255) * canvas.height;
                c.fillRect(i * barW, canvas.height - barH, Math.max(2, barW - 2), barH);
              }
            }
          }
          rafRef.current = requestAnimationFrame(draw);
        };
        draw();
      }
    } catch {
      // Microphone hardware unavailable in headless environments
    }

    const SpeechRec =
      (window as unknown as { SpeechRecognition?: new () => unknown; webkitSpeechRecognition?: new () => unknown })
        .SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: new () => unknown }).webkitSpeechRecognition;

    if (!SpeechRec) {
      setError('SpeechRecognition API is unavailable in this browser. Type a transcript below to test Voice Command & TTS.');
      setListening(false);
      stopAudioMonitor();
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
    rec.lang = speechLang;
    rec.interimResults = false;
    rec.onresult = (ev) => {
      const text = ev.results?.[0]?.[0]?.transcript || '';
      setTranscript(text);
      if (text) void executeVoiceDirective(text);
    };
    rec.onerror = () => {
      setListening(false);
      stopAudioMonitor();
    };
    rec.onend = () => {
      setListening(false);
      stopAudioMonitor();
    };
    setListening(true);
    rec.start();
  };

  const speakText = (text: string) => {
    if (!('speechSynthesis' in window) || !text.trim()) return;
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = /[\u0600-\u06FF]/.test(text) ? 'ar-SA' : speechLang;
    utter.rate = rate;
    const match = voices.find((v) => v.voiceURI === selectedVoiceURI);
    if (match) utter.voice = match;
    utter.onstart = () => setSpeaking(true);
    utter.onend = () => setSpeaking(false);
    utter.onerror = () => setSpeaking(false);
    window.speechSynthesis.speak(utter);
  };

  const interruptSpeech = () => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    setSpeaking(false);
  };

  const executeVoiceDirective = async (textOverride?: string) => {
    const command = (textOverride ?? transcript).trim();
    if (!command) return;
    const res = await fetch('/api/voice/command', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspaceId: activeWorkspaceId,
        transcript: command,
        language: speechLang.startsWith('ar') ? 'ar' : 'en',
      }),
    });
    const data = await res.json();
    if (res.ok) {
      setResponseText(data.answer);
      speakText(data.answer);
      triggerRefresh();
    } else {
      setError(data.error || 'Voice command execution failed');
    }
  };

  return (
    <div className="space-y-6">
      <div className="border-b border-slate-800/80 pb-4">
        <h1 className="font-display text-2xl font-bold text-slate-50">
          OMNI VOICE — Speech Intelligence & Voice Commands
        </h1>
        <p className="mt-1 text-sm text-slate-400">
          Hands-free bilingual STT/TTS conversation, real-time Voice Activity Detection, and
          interruptible synthesis.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-950/20 px-4 py-2.5 text-xs text-amber-200">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="lg:col-span-5 space-y-4 rounded-xl border border-slate-800 bg-[#111724] p-5">
          <h2 className="font-display text-sm font-semibold text-slate-100">Voice & VAD Controls</h2>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="voice-lang" className="block text-xs text-slate-400 mb-1">
                Language
              </label>
              <select
                id="voice-lang"
                value={speechLang}
                onChange={(e) => setSpeechLang(e.target.value as 'en-US' | 'ar-SA')}
                className="w-full rounded-lg border border-slate-800 bg-[#0B0F17] px-3 py-2 text-xs text-slate-100"
              >
                <option value="en-US">English (en-US)</option>
                <option value="ar-SA">العربية (ar-SA)</option>
              </select>
            </div>
            <div>
              <label htmlFor="voice-rate" className="block text-xs text-slate-400 mb-1">
                Speech Rate ({rate.toFixed(1)}x)
              </label>
              <input
                id="voice-rate"
                type="range"
                min={0.6}
                max={1.6}
                step={0.1}
                value={rate}
                onChange={(e) => setRate(Number(e.target.value))}
                className="w-full accent-sky-500 mt-2"
              />
            </div>
          </div>

          {voices.length > 0 && (
            <div>
              <label htmlFor="voice-select" className="block text-xs text-slate-400 mb-1">
                Synthesizer Voice
              </label>
              <select
                id="voice-select"
                value={selectedVoiceURI}
                onChange={(e) => setSelectedVoiceURI(e.target.value)}
                className="w-full rounded-lg border border-slate-800 bg-[#0B0F17] px-3 py-2 text-xs text-slate-100"
              >
                {voices.map((v) => (
                  <option key={v.voiceURI} value={v.voiceURI}>
                    {v.name} ({v.lang})
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>Voice Activity Detection (VAD)</span>
              <span className="font-mono tabular-nums">{vadLevel}%</span>
            </div>
            <canvas
              ref={canvasRef}
              width={400}
              height={72}
              className="w-full rounded-lg border border-slate-800 bg-[#0B0F17]"
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void (listening ? stopAudioMonitor() : startVoiceConversation())}
              className={`flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold ${
                listening
                  ? 'bg-red-500/20 text-red-200 border border-red-500/40'
                  : 'bg-sky-500 text-slate-950 hover:bg-sky-400'
              }`}
            >
              {listening ? <MicOff className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
              <span>{listening ? 'Stop Listening' : 'Start Voice Capture'}</span>
            </button>

            <button
              type="button"
              disabled={!speaking}
              onClick={interruptSpeech}
              className="flex items-center gap-2 rounded-lg border border-slate-700 bg-[#0B0F17] px-3 py-2 text-xs font-medium text-slate-200 hover:border-slate-600 disabled:opacity-40"
            >
              <Square className="h-3.5 w-3.5 text-amber-400" />
              <span>Interrupt Audio</span>
            </button>
          </div>
        </div>

        <div className="lg:col-span-7 space-y-4 rounded-xl border border-slate-800 bg-[#111724] p-5">
          <h2 className="font-display text-sm font-semibold text-slate-100">
            Transcript & Audio Response
          </h2>

          <div>
            <label htmlFor="voice-transcript" className="block text-xs text-slate-400 mb-1">
              Spoken or Typed Command Transcript
            </label>
            <textarea
              id="voice-transcript"
              rows={3}
              value={transcript}
              onChange={(e) => setTranscript(e.target.value)}
              placeholder="Speak into microphone or enter transcript to route to OMNI BRAIN..."
              className="w-full rounded-lg border border-slate-800 bg-[#0B0F17] px-3 py-2 text-xs text-slate-100"
            />
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={!transcript.trim()}
              onClick={() => void executeVoiceDirective()}
              className="rounded-lg bg-sky-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-sky-400 disabled:opacity-40"
            >
              Execute Voice Command
            </button>
            <button
              type="button"
              disabled={!responseText.trim()}
              onClick={() => speakText(responseText)}
              className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-[#0B0F17] px-3 py-2 text-xs font-medium text-slate-200 disabled:opacity-40"
            >
              <Volume2 className="h-3.5 w-3.5 text-sky-400" />
              <span>Speak / Resume Answer</span>
            </button>
          </div>

          {responseText && (
            <div className="rounded-lg border border-slate-800 bg-[#0B0F17] p-4 text-xs text-slate-200 whitespace-pre-wrap leading-relaxed">
              {responseText}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
