import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Camera,
  CheckCircle2,
  Download,
  ImagePlus,
  Mic,
  MicOff,
  Paperclip,
  Plus,
  Send,
  ShieldAlert,
  Smartphone,
  Wrench,
  X,
} from 'lucide-react';
import { useOmnix } from '../../contexts/OmnixContext';
import type { Procedural3DBlueprint, ProceduralWorldBlueprint } from '../../../shared/procedural3d';

interface StepTrace {
  stepNumber: number;
  taskId: string;
  agentName: string;
  title: string;
  toolUsed: string;
  status: 'completed' | 'failed' | 'awaiting_approval';
  durationMs: number;
  verifiedByQa: boolean;
  outputSummary: string;
  approvalId?: string;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  metadata?: {
    intent?: string;
    steps?: StepTrace[];
    provider?: string;
    model?: string;
    latencyMs?: number;
    isFallback?: boolean;
    artifacts?: {
      reportId?: string;
      reportTitle?: string;
      threeDAssetId?: string;
      threeDBlueprint?: Procedural3DBlueprint;
      simulationId?: string;
      worldBlueprint?: ProceduralWorldBlueprint;
    };
  };
}

interface ConversationSummary {
  id: string;
  title: string;
  updated_at: string;
}

export function AssistantView() {
  const {
    activeWorkspaceId,
    activeProjectId,
    activeConversationId,
    setActiveConversationId,
    setActiveView,
    setActiveThreeDBlueprint,
    setActiveWorldBlueprint,
    language,
    t,
    triggerRefresh,
  } = useOmnix();
  const isAr = language === 'ar';

  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [prompt, setPrompt] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [selectedModel, setSelectedModel] = useState<'gemini-4-hydrogen' | 'omnix-local-core'>('gemini-4-hydrogen');
  const [thinkingLevel, setThinkingLevel] = useState<'LOW' | 'MEDIUM' | 'HIGH'>('MEDIUM');
  const [showTools, setShowTools] = useState(false);
  const [showCameraMenu, setShowCameraMenu] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const [attachedFile, setAttachedFile] = useState<{ id: string; name: string } | null>(null);
  const [attachedImage, setAttachedImage] = useState<{ name: string; mimeType: string; data: string; previewUrl: string } | null>(null);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const deviceCameraInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((tr) => tr.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
  }, []);

  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((tr) => tr.stop());
        streamRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!cameraActive || !videoRef.current || !streamRef.current) return;
    const video = videoRef.current;
    video.srcObject = streamRef.current;
    void video.play().catch(() => {});
  }, [cameraActive]);

  useEffect(() => {
    fetch(`/api/conversations?workspaceId=${encodeURIComponent(activeWorkspaceId)}`)
      .then((r) => r.json())
      .then((d) => setConversations(d.conversations || []))
      .catch(() => {});
  }, [activeWorkspaceId, activeConversationId]);

  useEffect(() => {
    if (!activeConversationId) {
      setMessages([]);
      return;
    }
    fetch(`/api/conversations/${encodeURIComponent(activeConversationId)}/messages`)
      .then((r) => r.json())
      .then((d) => {
        const mapped: ChatMessage[] = (d.messages || []).map(
          (m: { id: string; role: 'user' | 'assistant'; content: string; metadata_json: string }) => ({
            id: m.id,
            role: m.role,
            content: m.content,
            metadata: JSON.parse(m.metadata_json || '{}'),
          })
        );
        setMessages(mapped);
      })
      .catch(() => {});
  }, [activeConversationId]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const res = await fetch('/api/files', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspaceId: activeWorkspaceId,
        projectId: activeProjectId,
        name: file.name,
        mimeType: file.type || 'text/plain',
        contentText: text,
      }),
    });
    if (res.ok) {
      const data = await res.json();
      setAttachedFile({ id: data.file.id, name: data.file.name });
      triggerRefresh();
    }
  };

  const handleImageAttach = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const base64 = result.split(',')[1] || '';
      setAttachedImage({
        name: file.name || 'camera-photo.png',
        mimeType: file.type || 'image/png',
        data: base64,
        previewUrl: result,
      });
      setShowCameraMenu(false);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const openLiveCamera = async () => {
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setError(
        isAr
          ? 'الكاميرا المباشرة غير متاحة في هذا المتصفح. يمكنك استخدام "كاميرا الجهاز" أو "رفع صورة".'
          : 'Live camera API unavailable here. Use "Device Camera" or "Upload Image".'
      );
      return;
    }
    try {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        });
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      }
      streamRef.current = stream;
      setCameraActive(true);
      setShowCameraMenu(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      setError(
        isAr
          ? `تعذر فتح الكاميرا (${msg || 'تم رفض الإذن'}). استخدم "كاميرا الجهاز" أو "رفع صورة".`
          : `Could not open camera (${msg || 'permission denied'}). Use "Device Camera" or "Upload Image".`
      );
    }
  };

  const captureLivePhoto = () => {
    const v = videoRef.current;
    if (!v) return;
    const w = v.videoWidth || 640;
    const h = v.videoHeight || 480;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(v, 0, 0, w, h);
    const dataUrl = canvas.toDataURL('image/png');
    const base64 = dataUrl.split(',')[1] || '';
    setAttachedImage({
      name: `capture-${new Date().toISOString().slice(11, 19).replace(/:/g, '-')}.png`,
      mimeType: 'image/png',
      data: base64,
      previewUrl: dataUrl,
    });
    stopCamera();
  };

  const toggleVoiceInput = () => {
    const SpeechRec =
      (window as unknown as { SpeechRecognition?: new () => unknown; webkitSpeechRecognition?: new () => unknown })
        .SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: new () => unknown }).webkitSpeechRecognition;

    if (!SpeechRec) {
      setError('Browser SpeechRecognition API is unavailable in this headless/browser environment.');
      return;
    }

    if (listening) {
      setListening(false);
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
    rec.lang = isAr ? 'ar-SA' : 'en-US';
    rec.interimResults = false;
    rec.onresult = (ev) => {
      const transcript = ev.results?.[0]?.[0]?.transcript || '';
      if (transcript) setPrompt((prev) => (prev ? `${prev} ${transcript}` : transcript));
    };
    rec.onerror = () => setListening(false);
    rec.onend = () => setListening(false);
    setListening(true);
    rec.start();
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((!prompt.trim() && !attachedImage) || submitting) return;
    setSubmitting(true);
    setError(null);

    const userText = prompt.trim() || (isAr ? 'حلل هذه الصورة بالتفصيل.' : 'Analyze this attached image in detail.');
    const tempUserMsg: ChatMessage = { id: `temp-${Date.now()}`, role: 'user', content: userText };
    setMessages((prev) => [...prev, tempUserMsg]);
    setPrompt('');

    try {
      const res = await fetch('/api/brain/orchestrate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceId: activeWorkspaceId,
          projectId: activeProjectId,
          conversationId: activeConversationId,
          prompt: userText,
          fileId: attachedFile?.id,
          preferredModel: selectedModel,
          thinkingLevel,
          imageBase64: attachedImage
            ? { mimeType: attachedImage.mimeType, data: attachedImage.data }
            : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Orchestration error');

      setActiveConversationId(data.conversationId);
      setAttachedImage(null);

      const assistantMsg: ChatMessage = {
        id: data.assistantMessageId,
        role: 'assistant',
        content: data.answer,
        metadata: {
          intent: data.intent,
          steps: data.steps,
          provider: data.gateway.provider,
          model: data.gateway.model,
          latencyMs: data.gateway.latencyMs,
          isFallback: data.gateway.isFallback,
          artifacts: data.artifacts,
        },
      };
      setMessages((prev) => [...prev, assistantMsg]);
      triggerRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setSubmitting(false);
    }
  };

  const downloadGeneratedReport = async (title: string, summary: string) => {
    const res = await fetch('/api/reports/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspaceId: activeWorkspaceId,
        projectId: activeProjectId,
        title,
        format: 'pdf',
        summary,
        sections: [{ heading: 'OMNI BRAIN Verified Execution', body: summary }],
      }),
    });
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'omnix-briefing.pdf';
    a.click();
    URL.revokeObjectURL(url);
  };

  const quickPresets = [
    'Analyze sample telemetry file, detect anomalies, generate a PDF report, and save findings to project memory',
    'Calculate sqrt(144) + 3^4 * 2 and verify numeric output',
    'Build a 3D sports car model and save to workspace assets',
    'حلل ملف البيانات، واستخرج القيم الشاذة، وأنشئ تقريراً، ثم احفظ النتائج في المشروع',
  ];

  return (
    <div className="grid h-[calc(100vh-8rem)] grid-cols-1 gap-5 lg:grid-cols-12">
      {/* Conversation Sidebar */}
      <aside className="hidden lg:flex lg:col-span-3 flex-col rounded-xl border border-slate-800 bg-[#111724] p-4 overflow-hidden">
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <h2 className="font-display text-sm font-semibold text-slate-100">OMNI BRAIN Sessions</h2>
          <button
            type="button"
            onClick={() => setActiveConversationId(null)}
            className="flex items-center gap-1 rounded-md bg-sky-500/15 px-2.5 py-1 text-xs font-medium text-sky-300 hover:bg-sky-500/25"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>New</span>
          </button>
        </div>

        <div className="mt-3 flex-1 space-y-1.5 overflow-y-auto">
          {conversations.length === 0 ? (
            <p className="text-xs text-slate-500 py-4">No persisted sessions yet.</p>
          ) : (
            conversations.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setActiveConversationId(c.id)}
                className={`w-full rounded-lg px-3 py-2 text-start text-xs transition-colors truncate ${
                  activeConversationId === c.id
                    ? 'bg-sky-500/15 text-sky-200 border border-sky-500/30'
                    : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-100'
                }`}
              >
                {c.title}
              </button>
            ))
          )}
        </div>
      </aside>

      {/* Main Workspace */}
      <section className="lg:col-span-9 flex flex-col rounded-xl border border-slate-800 bg-[#111724] overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 px-5 py-3">
          <div>
            <h1 className="font-display text-base font-semibold text-slate-100">
              OMNI BRAIN — Central Intelligence Workspace
            </h1>
            <p className="text-xs text-slate-400">
              Multi-step planning, 12-agent routing, QA verification & Model Gateway
            </p>
          </div>

          <div className="flex items-center gap-2">
            <select
              aria-label="Model Gateway Selection"
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value as 'gemini-4-hydrogen' | 'omnix-local-core')}
              className="rounded-lg border border-slate-700 bg-[#0B0F17] px-2.5 py-1.5 text-xs text-slate-200"
            >
              <option value="gemini-4-hydrogen">Cloud Gemini 4 Hydrogen (Auto Fallback)</option>
              <option value="omnix-local-core">Local Deterministic Engine</option>
            </select>

            <select
              aria-label="Thinking Depth"
              value={thinkingLevel}
              onChange={(e) => setThinkingLevel(e.target.value as 'LOW' | 'MEDIUM' | 'HIGH')}
              className="rounded-lg border border-slate-700 bg-[#0B0F17] px-2.5 py-1.5 text-xs text-slate-200"
            >
              <option value="LOW">Thinking: Low</option>
              <option value="MEDIUM">Thinking: Medium</option>
              <option value="HIGH">Thinking: High</option>
            </select>
          </div>
        </div>

        {/* Messages & Task Execution Area */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {messages.length === 0 ? (
            <div className="max-w-2xl mx-auto py-8 space-y-5">
              <div className="text-center">
                <h2 className="font-display text-xl font-semibold text-slate-100">
                  Issue a Multi-Step Directive
                </h2>
                <p className="mt-1.5 text-sm text-slate-400">
                  OMNI BRAIN decomposes complex requests into verified agent workflows across Data,
                  Math, Memory, 3D, and Reporting engines.
                </p>
              </div>
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                {quickPresets.map((preset, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setPrompt(preset)}
                    className="rounded-xl border border-slate-800 bg-[#0B0F17] p-3.5 text-start text-xs text-slate-300 hover:border-sky-500/40 hover:text-white transition-colors"
                  >
                    {preset}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
              >
                <div
                  className={`max-w-3xl rounded-xl px-4 py-3 text-sm leading-relaxed ${
                    msg.role === 'user'
                      ? 'bg-sky-500/15 text-slate-100 border border-sky-500/30'
                      : 'bg-[#0B0F17] text-slate-200 border border-slate-800 w-full'
                  }`}
                >
                  {msg.role === 'assistant' && msg.metadata?.steps && msg.metadata.steps.length > 0 && (
                    <div className="mb-4 border-b border-slate-800 pb-3">
                      <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
                        <span className="font-semibold text-slate-300">
                          Task Execution Plan ({msg.metadata.intent})
                        </span>
                        <span className="font-mono tabular-nums">
                          {msg.metadata.model} · {msg.metadata.latencyMs} ms
                        </span>
                      </div>
                      <div className="space-y-1.5">
                        {msg.metadata.steps.map((step) => (
                          <div
                            key={step.taskId}
                            className="flex flex-wrap md:flex-nowrap items-start justify-between gap-2.5 rounded-lg bg-[#111724] px-3 py-2 text-xs"
                          >
                            <div className="flex items-start gap-2 min-w-0">
                              {step.status === 'completed' ? (
                                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
                              ) : (
                                <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
                              )}
                              <span className="font-medium text-slate-200 whitespace-nowrap shrink-0">
                                {step.stepNumber}. {step.agentName}
                              </span>
                              <span className="text-slate-500 shrink-0">·</span>
                              <span className="text-slate-400">{step.outputSummary}</span>
                            </div>
                            <span className="font-mono tabular-nums text-slate-500 whitespace-nowrap shrink-0">
                              {step.durationMs} ms · {step.verifiedByQa ? 'QA Verified' : step.status}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="whitespace-pre-wrap">{msg.content}</div>

                  {msg.role === 'assistant' && msg.metadata?.artifacts && (
                    <div className="mt-3 flex flex-wrap gap-2 pt-2 border-t border-slate-800/80">
                      {msg.metadata.artifacts.reportId && (
                        <button
                          type="button"
                          onClick={() =>
                            void downloadGeneratedReport(
                              msg.metadata?.artifacts?.reportTitle || 'OMNIX Report',
                              msg.content
                            )
                          }
                          className="flex items-center gap-1.5 rounded-md bg-emerald-500/15 px-3 py-1.5 text-xs font-medium text-emerald-300 hover:bg-emerald-500/25"
                        >
                          <Download className="h-3.5 w-3.5" />
                          <span>Download Report PDF</span>
                        </button>
                      )}
                      {msg.metadata.artifacts.threeDAssetId && (
                        <button
                          type="button"
                          onClick={() => {
                            if (msg.metadata?.artifacts?.threeDBlueprint) {
                              setActiveThreeDBlueprint(msg.metadata.artifacts.threeDBlueprint);
                            }
                            setActiveView('studio3d');
                          }}
                          className="rounded-md bg-sky-500/15 px-3 py-1.5 text-xs font-medium text-sky-300 hover:bg-sky-500/25"
                        >
                          Inspect in 3D Studio
                        </button>
                      )}
                      {msg.metadata.artifacts.simulationId && (
                        <button
                          type="button"
                          onClick={() => {
                            if (msg.metadata?.artifacts?.worldBlueprint) {
                              setActiveWorldBlueprint(msg.metadata.artifacts.worldBlueprint);
                            }
                            setActiveView('world');
                          }}
                          className="rounded-md bg-sky-500/15 px-3 py-1.5 text-xs font-medium text-sky-300 hover:bg-sky-500/25"
                        >
                          Open in World Builder
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
          {submitting && (
            <div className="rounded-xl border border-slate-800 bg-[#0B0F17] px-4 py-3 text-xs text-sky-300">
              Decomposing directive and executing verified agent steps...
            </div>
          )}
          {error && (
            <div className="rounded-xl border border-red-500/40 bg-red-950/20 px-4 py-3 text-xs text-red-300">
              {error}
            </div>
          )}
        </div>

        {/* Input & Multimodal Toolbar */}
        <form onSubmit={(e) => void handleSend(e)} className="border-t border-slate-800 bg-[#0F141F] p-4 space-y-3">
          {cameraActive && (
            <div className="rounded-xl border border-emerald-500/40 bg-[#0B0F17] p-3 space-y-2.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-emerald-300">
                  {isAr ? 'الكاميرا المباشرة — التقط صورة لإرفاقها' : 'Live Camera — Capture a photo to attach'}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={captureLivePhoto}
                    className="flex items-center gap-1.5 rounded-md bg-emerald-500 px-3 py-1 text-xs font-semibold text-slate-950 hover:bg-emerald-400"
                  >
                    <Camera className="h-3.5 w-3.5" />
                    <span>{isAr ? 'التقاط وإرفاق' : 'Capture Photo'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={stopCamera}
                    aria-label="Close Camera"
                    className="rounded-md border border-slate-700 px-2 py-1 text-slate-300 hover:text-white"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                data-testid="assistant-camera-video"
                className="max-h-56 w-full rounded-lg bg-black object-cover"
              />
            </div>
          )}

          {(attachedFile || attachedImage || showTools || showCameraMenu) && (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {attachedFile && (
                <div className="flex items-center gap-2 rounded-md border border-slate-700 bg-[#111724] px-2.5 py-1 text-slate-200">
                  <span>File: {attachedFile.name}</span>
                  <button
                    type="button"
                    onClick={() => setAttachedFile(null)}
                    className="text-slate-400 hover:text-white"
                  >
                    Remove
                  </button>
                </div>
              )}
              {attachedImage && (
                <div className="flex items-center gap-2 rounded-md border border-sky-500/40 bg-[#111724] px-2 py-1 text-slate-200">
                  <img
                    src={attachedImage.previewUrl}
                    alt={attachedImage.name}
                    className="h-7 w-7 rounded object-cover border border-slate-700"
                  />
                  <span className="max-w-[160px] truncate">{attachedImage.name}</span>
                  <button
                    type="button"
                    onClick={() => setAttachedImage(null)}
                    className="text-slate-400 hover:text-white"
                  >
                    Remove
                  </button>
                </div>
              )}
              {showCameraMenu && (
                <div className="flex flex-wrap items-center gap-2 rounded-md border border-slate-700 bg-[#111724] px-3 py-1.5 text-slate-200">
                  <button
                    type="button"
                    onClick={() => void openLiveCamera()}
                    className="flex items-center gap-1.5 text-emerald-300 hover:underline"
                  >
                    <Camera className="h-3.5 w-3.5" />
                    <span>{isAr ? 'فتح الكاميرا المباشرة' : 'Open Live Camera'}</span>
                  </button>
                  <span className="text-slate-600">·</span>
                  <button
                    type="button"
                    onClick={() => deviceCameraInputRef.current?.click()}
                    className="flex items-center gap-1.5 text-cyan-300 hover:underline"
                  >
                    <Smartphone className="h-3.5 w-3.5" />
                    <span>{isAr ? 'كاميرا الجهاز' : 'Device Camera'}</span>
                  </button>
                  <span className="text-slate-600">·</span>
                  <button
                    type="button"
                    onClick={() => imageInputRef.current?.click()}
                    className="flex items-center gap-1.5 text-sky-300 hover:underline"
                  >
                    <ImagePlus className="h-3.5 w-3.5" />
                    <span>{isAr ? 'رفع صورة' : 'Upload Image'}</span>
                  </button>
                </div>
              )}
              {showTools && (
                <div className="flex flex-wrap items-center gap-2 rounded-md border border-slate-700 bg-[#111724] px-3 py-1.5 text-slate-300">
                  <span>Active Tools:</span>
                  <button
                    type="button"
                    onClick={() => setPrompt('Analyze sample telemetry file and detect anomalies')}
                    className="text-sky-400 hover:underline"
                  >
                    Data Analyzer
                  </button>
                  <span>·</span>
                  <button
                    type="button"
                    onClick={() => setPrompt('Calculate (42 * 18.5) + sqrt(625)')}
                    className="text-sky-400 hover:underline"
                  >
                    Math Engine
                  </button>
                  <span>·</span>
                  <button
                    type="button"
                    onClick={() => setPrompt('Create a 3D drone model')}
                    className="text-sky-400 hover:underline"
                  >
                    3D Synthesizer
                  </button>
                </div>
              )}
            </div>
          )}

          <div className="flex items-end gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.json,.xml,.txt"
              onChange={(e) => void handleFileUpload(e)}
              className="hidden"
            />
            <input
              ref={imageInputRef}
              type="file"
              accept="image/*"
              onChange={handleImageAttach}
              className="hidden"
            />
            <input
              ref={deviceCameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handleImageAttach}
              className="hidden"
            />

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={toggleVoiceInput}
                aria-label={t('voice_input')}
                title={t('voice_input')}
                className={`rounded-lg border p-2.5 transition-colors ${
                  listening
                    ? 'border-red-500/50 bg-red-500/15 text-red-300'
                    : 'border-slate-800 bg-[#0B0F17] text-slate-400 hover:text-white'
                }`}
              >
                {listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
              </button>

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                aria-label={t('attach_file')}
                title={t('attach_file')}
                className="rounded-lg border border-slate-800 bg-[#0B0F17] p-2.5 text-slate-400 hover:text-white"
              >
                <Paperclip className="h-4 w-4" />
              </button>

              <button
                type="button"
                onClick={() => setShowCameraMenu((v) => !v)}
                aria-label={t('attach_image')}
                title={t('attach_image')}
                className={`rounded-lg border p-2.5 transition-colors ${
                  showCameraMenu || cameraActive
                    ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-300'
                    : 'border-slate-800 bg-[#0B0F17] text-slate-400 hover:text-white'
                }`}
              >
                <Camera className="h-4 w-4" />
              </button>

              <button
                type="button"
                onClick={() => setShowTools(!showTools)}
                aria-label={t('tools')}
                title={t('tools')}
                className={`rounded-lg border p-2.5 transition-colors ${
                  showTools
                    ? 'border-sky-500/50 bg-sky-500/15 text-sky-300'
                    : 'border-slate-800 bg-[#0B0F17] text-slate-400 hover:text-white'
                }`}
              >
                <Wrench className="h-4 w-4" />
              </button>
            </div>

            <textarea
              rows={2}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void handleSend(e);
                }
              }}
              placeholder={t('prompt_placeholder')}
              aria-label={t('prompt_placeholder')}
              className="flex-1 resize-none rounded-lg border border-slate-800 bg-[#0B0F17] px-3.5 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-sky-500/60 focus:outline-none"
            />

            <button
              type="submit"
              disabled={submitting || (!prompt.trim() && !attachedImage)}
              className="flex items-center gap-2 rounded-lg bg-sky-500 px-4 py-2.5 text-xs font-semibold text-slate-950 hover:bg-sky-400 disabled:opacity-40 whitespace-nowrap shrink-0"
            >
              <Send className="h-3.5 w-3.5" />
              <span>{t('send_directive')}</span>
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
