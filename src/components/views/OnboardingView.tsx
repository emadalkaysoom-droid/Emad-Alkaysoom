import React, { useEffect, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  CheckCircle2,
  Cpu,
  Download,
  Eye,
  FileSpreadsheet,
  Mic,
  Play,
  Volume2,
} from 'lucide-react';
import { useOmnix } from '../../contexts/OmnixContext';
import {
  ONBOARDING_STEPS,
  calculateOnboardingCompletionPercent,
  createInitialOnboardingProgress,
  markOnboardingStepComplete,
  type OnboardingProgressState,
  type OnboardingStepDef,
} from '../../../shared/onboardingGuide';

function createSyntheticTurbineInspectionImage(): {
  dataUrl: string;
  telemetry: { width: number; height: number; meanLuminance: number; edgeDensity: number };
} {
  const canvas = document.createElement('canvas');
  canvas.width = 480;
  canvas.height = 300;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#0F172A';
  ctx.fillRect(0, 0, 480, 300);

  // Grid backdrop
  ctx.strokeStyle = '#1E293B';
  ctx.lineWidth = 1;
  for (let x = 0; x <= 480; x += 24) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, 300);
    ctx.stroke();
  }
  for (let y = 0; y <= 300; y += 24) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(480, y);
    ctx.stroke();
  }

  // Turbine housing & rotor schematic
  ctx.strokeStyle = '#38BDF8';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(200, 150, 74, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = '#1E293B';
  ctx.fillRect(265, 118, 120, 64);
  ctx.strokeStyle = '#94A3B8';
  ctx.strokeRect(265, 118, 120, 64);

  // Thermal hotspot marker on bearing
  ctx.fillStyle = '#F59E0B';
  ctx.beginPath();
  ctx.arc(275, 150, 14, 0, Math.PI * 2);
  ctx.fill();

  // Engineering labels for OCR/vision inspection
  ctx.fillStyle = '#E2E8F0';
  ctx.font = 'bold 14px monospace';
  ctx.fillText('UNIT: TURBINE-01 BEARING', 24, 34);
  ctx.fillStyle = '#FBBF24';
  ctx.font = '12px monospace';
  ctx.fillText('THERMAL SPIKE: 94.6 C | RPM: 1890', 24, 272);

  const imgData = ctx.getImageData(0, 0, 480, 300).data;
  let lumSum = 0;
  let edgeHits = 0;
  const pxCount = 480 * 300;
  for (let i = 0; i < pxCount; i++) {
    const idx = i * 4;
    lumSum += 0.299 * imgData[idx] + 0.587 * imgData[idx + 1] + 0.114 * imgData[idx + 2];
    if (i > 0 && Math.abs(imgData[idx] - imgData[idx - 4]) > 40) edgeHits++;
  }

  return {
    dataUrl: canvas.toDataURL('image/png'),
    telemetry: {
      width: 480,
      height: 300,
      meanLuminance: Math.round(lumSum / pxCount),
      edgeDensity: Number((edgeHits / pxCount).toFixed(4)),
    },
  };
}

export function OnboardingView() {
  const { activeWorkspaceId, activeProjectId, language, setActiveView, triggerRefresh } = useOmnix();
  const isAr = language === 'ar';

  const [activeIdx, setActiveIdx] = useState(0);
  const [progress, setProgress] = useState<OnboardingProgressState>(createInitialOnboardingProgress);

  // Step 1: Text input demo (OMNI BRAIN)
  const [brainPrompt, setBrainPrompt] = useState('Analyze sample telemetry file and calculate sqrt(144) + 10');
  const [brainLoading, setBrainLoading] = useState(false);
  const [brainResult, setBrainResult] = useState<{
    intent: string;
    answer: string;
    steps: Array<{ stepNumber: number; agentName: string; outputSummary: string; verifiedByQa: boolean }>;
  } | null>(null);

  // Step 2: Image input demo (OMNI VISION)
  const [visionSample, setVisionSample] = useState<{
    dataUrl: string;
    telemetry: { width: number; height: number; meanLuminance: number; edgeDensity: number };
  } | null>(null);
  const [visionPrompt, setVisionPrompt] = useState('Inspect this turbine bearing schematic and report thermal markers and visible text.');
  const [visionLoading, setVisionLoading] = useState(false);
  const [visionOutput, setVisionOutput] = useState<{ analysis: string; confidenceNote: string } | null>(null);

  // Step 3: Voice input demo (OMNI VOICE)
  const [voiceTranscript, setVoiceTranscript] = useState('Analyze sample file and calculate 25 * 4');
  const [voiceLoading, setVoiceLoading] = useState(false);
  const [voiceResponse, setVoiceResponse] = useState<{ answer: string; detectedLanguage: string } | null>(null);
  const [ttsNotice, setTtsNotice] = useState<string | null>(null);

  // Step 4: OMNI AGENT overview
  const [agentCount, setAgentCount] = useState<number>(12);
  const [scheduledTaskMsg, setScheduledTaskMsg] = useState<string | null>(null);

  // Step 5: Guided End-to-End Task (OMNI VISION -> OMNI DATA -> PDF Report)
  const [guidedDataResult, setGuidedDataResult] = useState<{
    fileName: string;
    rowCount: number;
    anomaliesCount: number;
    summary: string;
  } | null>(null);
  const [guidedBusy, setGuidedBusy] = useState<string | null>(null);
  const [guidedReportSuccess, setGuidedReportSuccess] = useState(false);

  const currentStep: OnboardingStepDef = ONBOARDING_STEPS[activeIdx];
  const completionPct = calculateOnboardingCompletionPercent(progress);

  useEffect(() => {
    fetch('/api/settings')
      .then((r) => r.json())
      .then((d) => {
        if (d.settings?.onboardingProgress) {
          setProgress(d.settings.onboardingProgress as OnboardingProgressState);
        }
      })
      .catch(() => {});

    fetch(`/api/agents?workspaceId=${encodeURIComponent(activeWorkspaceId)}`)
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d.agents)) setAgentCount(d.agents.length);
      })
      .catch(() => {});
  }, [activeWorkspaceId]);

  const persistProgress = async (next: OnboardingProgressState) => {
    setProgress(next);
    const pct = calculateOnboardingCompletionPercent(next);
    try {
      await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          onboardingProgress: next,
          onboardingCompleted: pct === 100,
        }),
      });
    } catch {
      // ignore offline transient failure
    }
  };

  const completeStep = (stepId: OnboardingStepDef['id']) => {
    const next = markOnboardingStepComplete(progress, stepId);
    void persistProgress(next);
  };

  const runBrainDemo = async () => {
    if (!brainPrompt.trim()) return;
    setBrainLoading(true);
    try {
      const res = await fetch('/api/brain/orchestrate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceId: activeWorkspaceId,
          projectId: activeProjectId,
          prompt: brainPrompt.trim(),
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setBrainResult({ intent: data.intent, answer: data.answer, steps: data.steps || [] });
        completeStep('brain');
        triggerRefresh();
      }
    } finally {
      setBrainLoading(false);
    }
  };

  const ensureSampleImage = () => {
    const generated = createSyntheticTurbineInspectionImage();
    setVisionSample(generated);
    return generated;
  };

  const handleVisionUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const src = String(reader.result || '');
      const img = new Image();
      img.onload = () => {
        setVisionSample({
          dataUrl: src,
          telemetry: {
            width: img.naturalWidth,
            height: img.naturalHeight,
            meanLuminance: 120,
            edgeDensity: 0.14,
          },
        });
      };
      img.src = src;
    };
    reader.readAsDataURL(file);
  };

  const runVisionDemo = async (markGuided = false) => {
    const sample = visionSample ?? ensureSampleImage();
    setVisionLoading(true);
    try {
      const res = await fetch('/api/vision/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceId: activeWorkspaceId,
          mode: 'vqa',
          question: visionPrompt,
          imageBase64: sample.dataUrl,
          mimeType: 'image/png',
          imageMeta: sample.telemetry,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setVisionOutput({ analysis: data.analysis, confidenceNote: data.confidenceNote });
        let next = markOnboardingStepComplete(progress, 'vision');
        if (markGuided) {
          next = { ...next, guidedVisionDone: true };
        }
        void persistProgress(next);
      }
    } finally {
      setVisionLoading(false);
    }
  };

  const runVoiceDemo = async () => {
    if (!voiceTranscript.trim()) return;
    setVoiceLoading(true);
    try {
      const res = await fetch('/api/voice/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceId: activeWorkspaceId,
          transcript: voiceTranscript.trim(),
          language,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setVoiceResponse({ answer: data.answer, detectedLanguage: data.detectedLanguage });
        completeStep('voice');
        triggerRefresh();
      }
    } finally {
      setVoiceLoading(false);
    }
  };

  const playVoiceSample = () => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(
        isAr
          ? 'مرحباً بك في منصة أومنيكس. يمكنك إصدار أوامر صوتية ونصية متكاملة.'
          : 'Welcome to OMNIX. Voice command routing and audio briefings are ready.'
      );
      utter.lang = isAr ? 'ar-SA' : 'en-US';
      window.speechSynthesis.speak(utter);
      setTtsNotice('SpeechSynthesis audio cue triggered.');
    } else {
      setTtsNotice('Browser SpeechSynthesis is unavailable in this environment; command routing remains active.');
    }
  };

  const scheduleSampleAgentTask = async () => {
    const res = await fetch('/api/tasks/schedule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspaceId: activeWorkspaceId,
        projectId: activeProjectId,
        agentId: 'agent-qa',
        title: 'Onboarding Verification Audit',
        description: 'Verify multimodal workspace readiness.',
      }),
    });
    if (res.ok) {
      const d = await res.json();
      setScheduledTaskMsg(`Scheduled verified task "${d.taskId}" via Quality Assurance Agent.`);
      completeStep('agent');
      triggerRefresh();
    }
  };

  const runGuidedDataAnalysis = async () => {
    setGuidedBusy('data');
    try {
      const res = await fetch('/api/data/parse-and-analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileId: 'file-sample-telemetry' }),
      });
      const data = await res.json();
      if (res.ok) {
        const rpmStat = (data.analysis.stats as Array<{ column: string; mean?: number; max?: number }>).find(
          (s) => s.column === 'rpm'
        );
        setGuidedDataResult({
          fileName: data.fileName,
          rowCount: data.analysis.rowCount,
          anomaliesCount: data.analysis.anomalies.length,
          summary: `Analyzed ${data.analysis.rowCount} rows from ${data.fileName}. Detected ${data.analysis.anomalies.length} Z-score anomalies (peak RPM: ${rpmStat?.max ?? 'N/A'}, mean: ${rpmStat?.mean ?? 'N/A'}).`,
        });
        void persistProgress({ ...progress, guidedDataDone: true });
      }
    } finally {
      setGuidedBusy(null);
    }
  };

  const runGuidedReportExport = async () => {
    setGuidedBusy('report');
    try {
      const sections = [
        {
          heading: '1. OMNI VISION Inspection Findings',
          body: visionOutput?.analysis || 'Sample turbine bearing schematic inspected (480x300 px).',
        },
        {
          heading: '2. OMNI DATA Statistical Telemetry',
          body: guidedDataResult?.summary || 'Turbine telemetry dataset correlated with thermal spike.',
        },
      ];
      const res = await fetch('/api/reports/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceId: activeWorkspaceId,
          projectId: activeProjectId,
          title: 'OMNIX Guided Onboarding Inspection Report',
          format: 'pdf',
          summary: 'Combined multimodal inspection report generated from OMNI VISION and OMNI DATA.',
          sections,
        }),
      });
      if (res.ok) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'omnix-onboarding-inspection-report.pdf';
        a.click();
        URL.revokeObjectURL(url);
        setGuidedReportSuccess(true);
        const next = markOnboardingStepComplete(
          { ...progress, guidedVisionDone: true, guidedDataDone: true, guidedReportDone: true },
          'guided_task'
        );
        void persistProgress(next);
        triggerRefresh();
      }
    } finally {
      setGuidedBusy(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-800/80 pb-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-50">
            {isAr ? 'الدليل التفاعلي لمنصة OMNIX' : 'OMNIX Interactive Onboarding'}
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            {isAr
              ? 'تعرف على الأنظمة الأساسية وجرب المدخلات النصية والصوتية والبصرية خطوة بخطوة.'
              : 'Explore OMNI BRAIN, OMNI VISION, OMNI VOICE, and OMNI AGENT with live multimodal labs.'}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="text-end">
            <p className="text-xs text-slate-400">
              {isAr ? 'نسبة الإنجاز' : 'Walkthrough Progress'}
            </p>
            <p className="font-mono text-sm font-semibold tabular-nums text-sky-400">
              {completionPct}%
            </p>
          </div>
          <div className="h-2 w-28 overflow-hidden rounded-full bg-slate-800">
            <div
              className="h-full bg-sky-500 transition-all"
              style={{ width: `${completionPct}%` }}
            />
          </div>
        </div>
      </div>

      {/* Step Navigator Strip */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
        {ONBOARDING_STEPS.map((step, idx) => {
          const isCurrent = idx === activeIdx;
          const isDone = progress.completedStepIds.includes(step.id);
          return (
            <button
              key={step.id}
              type="button"
              onClick={() => setActiveIdx(idx)}
              className={`rounded-xl border p-3 text-start transition-colors ${
                isCurrent
                  ? 'border-sky-500/60 bg-sky-500/10 text-slate-100'
                  : 'border-slate-800 bg-[#111724] text-slate-400 hover:border-slate-700 hover:text-slate-200'
              }`}
            >
              <div className="flex items-center justify-between text-xs">
                <span className="font-mono tabular-nums text-slate-500">0{step.stepNumber}</span>
                {isDone && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />}
              </div>
              <p className="mt-1.5 text-xs font-semibold text-slate-100 truncate">
                {step.systemName}
              </p>
              <p className="text-[11px] text-slate-400 truncate">
                {isAr ? step.modalityAr : step.modalityEn}
              </p>
            </button>
          );
        })}
      </div>

      {/* Active Step Interactive Workspace */}
      <div className="rounded-xl border border-slate-800 bg-[#111724] p-6 space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-800 pb-4">
          <div className="max-w-2xl">
            <p className="text-xs font-mono text-sky-400">
              Step {currentStep.stepNumber} of {ONBOARDING_STEPS.length} · {currentStep.systemName}
            </p>
            <h2 className="mt-1 font-display text-lg font-semibold text-slate-50">
              {isAr ? currentStep.titleAr : currentStep.titleEn}
            </h2>
            <p className="mt-1.5 text-sm text-slate-400 leading-relaxed">
              {isAr ? currentStep.summaryAr : currentStep.summaryEn}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setActiveView(currentStep.targetView)}
            className="rounded-lg border border-slate-700 bg-[#0B0F17] px-3.5 py-2 text-xs font-medium text-slate-200 hover:border-slate-500 whitespace-nowrap shrink-0"
          >
            {isAr ? 'فتح الأداة الكاملة' : `Open ${currentStep.systemName} Studio`}
          </button>
        </div>

        {/* Step 1: OMNI BRAIN Text Input */}
        {currentStep.id === 'brain' && (
          <div className="space-y-4">
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                type="text"
                aria-label="Onboarding text directive"
                value={brainPrompt}
                onChange={(e) => setBrainPrompt(e.target.value)}
                className="flex-1 rounded-lg border border-slate-800 bg-[#0B0F17] px-3.5 py-2.5 text-xs text-slate-100"
              />
              <button
                type="button"
                disabled={brainLoading}
                onClick={() => void runBrainDemo()}
                className="flex items-center justify-center gap-2 rounded-lg bg-sky-500 px-4 py-2.5 text-xs font-semibold text-slate-950 hover:bg-sky-400 disabled:opacity-40 whitespace-nowrap shrink-0"
              >
                <Cpu className="h-3.5 w-3.5" />
                <span>{brainLoading ? 'Orchestrating...' : 'Run Live Text Directive'}</span>
              </button>
            </div>

            {brainResult && (
              <div className="rounded-lg border border-slate-800 bg-[#0B0F17] p-4 space-y-3 text-xs">
                <div className="flex items-center justify-between text-slate-400">
                  <span className="font-semibold text-emerald-400">
                    Intent Verified: {brainResult.intent}
                  </span>
                  <span className="font-mono">{brainResult.steps.length} agent step(s)</span>
                </div>
                <div className="space-y-1.5">
                  {brainResult.steps.map((s) => (
                    <div key={s.stepNumber} className="flex items-start justify-between gap-2 text-slate-300">
                      <span>
                        {s.stepNumber}. <strong>{s.agentName}</strong> · {s.outputSummary}
                      </span>
                      <span className="font-mono text-emerald-400 shrink-0">
                        {s.verifiedByQa ? 'QA Verified' : 'Checked'}
                      </span>
                    </div>
                  ))}
                </div>
                <p className="border-t border-slate-800 pt-2.5 text-slate-200 whitespace-pre-wrap">
                  {brainResult.answer}
                </p>
              </div>
            )}
          </div>
        )}

        {/* Step 2: OMNI VISION Image Input */}
        {currentStep.id === 'vision' && (
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
            <div className="lg:col-span-5 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => ensureSampleImage()}
                  className="rounded-lg border border-slate-700 bg-[#0B0F17] px-3 py-2 text-xs font-medium text-slate-200 hover:border-slate-500"
                >
                  Generate Sample Inspection Image
                </button>
                <label className="cursor-pointer rounded-lg border border-slate-700 bg-[#0B0F17] px-3 py-2 text-xs font-medium text-slate-200 hover:border-slate-500">
                  <span>Upload Image</span>
                  <input type="file" accept="image/*" className="hidden" onChange={handleVisionUpload} />
                </label>
              </div>

              {visionSample ? (
                <div className="space-y-2">
                  <img
                    src={visionSample.dataUrl}
                    alt="Onboarding turbine inspection sample"
                    className="w-full rounded-lg border border-slate-800 bg-[#0B0F17]"
                  />
                  <p className="font-mono text-[11px] tabular-nums text-slate-400">
                    {visionSample.telemetry.width}×{visionSample.telemetry.height} px · Luminance:{' '}
                    {visionSample.telemetry.meanLuminance}/255 · Edge Density:{' '}
                    {(visionSample.telemetry.edgeDensity * 100).toFixed(1)}%
                  </p>
                </div>
              ) : (
                <div className="flex h-44 items-center justify-center rounded-lg border border-dashed border-slate-700 bg-[#0B0F17] text-xs text-slate-500">
                  Click "Generate Sample Inspection Image" or upload a file
                </div>
              )}
            </div>

            <div className="lg:col-span-7 space-y-3">
              <label htmlFor="onb-vision-prompt" className="block text-xs text-slate-400">
                Visual Question / OCR Prompt
              </label>
              <textarea
                id="onb-vision-prompt"
                rows={2}
                value={visionPrompt}
                onChange={(e) => setVisionPrompt(e.target.value)}
                className="w-full rounded-lg border border-slate-800 bg-[#0B0F17] px-3 py-2 text-xs text-slate-100"
              />
              <button
                type="button"
                disabled={visionLoading}
                onClick={() => void runVisionDemo(false)}
                className="flex items-center gap-2 rounded-lg bg-sky-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-sky-400 disabled:opacity-40"
              >
                <Eye className="h-3.5 w-3.5" />
                <span>{visionLoading ? 'Analyzing Image...' : 'Run OMNI VISION Inspection'}</span>
              </button>

              {visionOutput && (
                <div className="rounded-lg border border-slate-800 bg-[#0B0F17] p-3.5 text-xs space-y-1.5">
                  <p className="font-medium text-sky-400">{visionOutput.confidenceNote}</p>
                  <p className="text-slate-200 whitespace-pre-wrap">{visionOutput.analysis}</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Step 3: OMNI VOICE */}
        {currentStep.id === 'voice' && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={playVoiceSample}
                className="flex items-center gap-2 rounded-lg border border-slate-700 bg-[#0B0F17] px-3.5 py-2 text-xs font-medium text-slate-200 hover:border-slate-500"
              >
                <Volume2 className="h-3.5 w-3.5 text-sky-400" />
                <span>Test TTS Audio Output</span>
              </button>
              <span className="text-xs text-slate-400">
                Supports English & Arabic SpeechRecognition + Web Audio VAD in OMNI VOICE.
              </span>
            </div>
            {ttsNotice && <p className="font-mono text-xs text-sky-300">{ttsNotice}</p>}

            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                type="text"
                aria-label="Simulated voice transcript command"
                value={voiceTranscript}
                onChange={(e) => setVoiceTranscript(e.target.value)}
                className="flex-1 rounded-lg border border-slate-800 bg-[#0B0F17] px-3.5 py-2.5 text-xs text-slate-100"
              />
              <button
                type="button"
                disabled={voiceLoading}
                onClick={() => void runVoiceDemo()}
                className="flex items-center justify-center gap-2 rounded-lg bg-sky-500 px-4 py-2.5 text-xs font-semibold text-slate-950 hover:bg-sky-400 disabled:opacity-40 whitespace-nowrap shrink-0"
              >
                <Mic className="h-3.5 w-3.5" />
                <span>{voiceLoading ? 'Routing...' : 'Route Voice Command'}</span>
              </button>
            </div>

            {voiceResponse && (
              <div className="rounded-lg border border-slate-800 bg-[#0B0F17] p-4 text-xs space-y-1.5">
                <p className="font-mono text-emerald-400">
                  Detected Language: {voiceResponse.detectedLanguage.toUpperCase()}
                </p>
                <p className="text-slate-200 whitespace-pre-wrap">{voiceResponse.answer}</p>
              </div>
            )}
          </div>
        )}

        {/* Step 4: OMNI AGENT */}
        {currentStep.id === 'agent' && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 text-xs">
              <div className="rounded-lg border border-slate-800 bg-[#0B0F17] p-4">
                <p className="text-slate-400">Registered Domain Agents</p>
                <p className="mt-1 font-mono text-xl font-semibold tabular-nums text-slate-100">
                  {agentCount}
                </p>
                <p className="mt-1 text-slate-500">Planning, Data, Vision, Math, 3D, QA, Security</p>
              </div>
              <div className="rounded-lg border border-slate-800 bg-[#0B0F17] p-4">
                <p className="text-slate-400">Execution Isolation</p>
                <p className="mt-1 font-mono text-xl font-semibold text-emerald-400">node:vm</p>
                <p className="mt-1 text-slate-500">500 ms execution cap · zero filesystem/process leak</p>
              </div>
              <div className="rounded-lg border border-slate-800 bg-[#0B0F17] p-4">
                <p className="text-slate-400">Destructive Policy</p>
                <p className="mt-1 font-mono text-xl font-semibold text-amber-400">Approval Gate</p>
                <p className="mt-1 text-slate-500">Queued in OMNI SECURITY before execution</p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => void scheduleSampleAgentTask()}
                className="flex items-center gap-2 rounded-lg bg-sky-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-sky-400"
              >
                <Bot className="h-3.5 w-3.5" />
                <span>Schedule Sample QA Verification Task</span>
              </button>
              {scheduledTaskMsg && (
                <span className="font-mono text-xs text-emerald-400">{scheduledTaskMsg}</span>
              )}
            </div>
          </div>
        )}

        {/* Step 5: Guided End-to-End Sample Task (OMNI VISION -> OMNI DATA -> Report) */}
        {currentStep.id === 'guided_task' && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              {/* Sub-step A */}
              <div className="rounded-lg border border-slate-800 bg-[#0B0F17] p-4 space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-100">A. Inspect Image (OMNI VISION)</span>
                  {progress.guidedVisionDone && <CheckCircle2 className="h-4 w-4 text-emerald-400" />}
                </div>
                <p className="text-xs text-slate-400">
                  Generate and analyze the Turbine-01 bearing schematic to capture visual metrics.
                </p>
                <button
                  type="button"
                  disabled={visionLoading}
                  onClick={() => void runVisionDemo(true)}
                  className="flex w-full items-center justify-center gap-2 rounded-lg border border-sky-500/40 bg-sky-500/15 px-3 py-2 text-xs font-semibold text-sky-300 hover:bg-sky-500/25 disabled:opacity-40"
                >
                  <Eye className="h-3.5 w-3.5" />
                  <span>{visionLoading ? 'Inspecting...' : '1. Analyze Sample Image'}</span>
                </button>
                {visionOutput && (
                  <p className="text-[11px] text-slate-300 line-clamp-3">{visionOutput.analysis}</p>
                )}
              </div>

              {/* Sub-step B */}
              <div className="rounded-lg border border-slate-800 bg-[#0B0F17] p-4 space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-100">B. Correlate Telemetry (OMNI DATA)</span>
                  {progress.guidedDataDone && <CheckCircle2 className="h-4 w-4 text-emerald-400" />}
                </div>
                <p className="text-xs text-slate-400">
                  Parse turbine_telemetry_sample.csv and extract Z-score statistical anomalies.
                </p>
                <button
                  type="button"
                  disabled={guidedBusy === 'data'}
                  onClick={() => void runGuidedDataAnalysis()}
                  className="flex w-full items-center justify-center gap-2 rounded-lg border border-sky-500/40 bg-sky-500/15 px-3 py-2 text-xs font-semibold text-sky-300 hover:bg-sky-500/25 disabled:opacity-40"
                >
                  <FileSpreadsheet className="h-3.5 w-3.5" />
                  <span>{guidedBusy === 'data' ? 'Analyzing CSV...' : '2. Run Telemetry Analysis'}</span>
                </button>
                {guidedDataResult && (
                  <p className="text-[11px] text-slate-300">{guidedDataResult.summary}</p>
                )}
              </div>

              {/* Sub-step C */}
              <div className="rounded-lg border border-slate-800 bg-[#0B0F17] p-4 space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-100">C. Compile Report (PDF)</span>
                  {progress.guidedReportDone && <CheckCircle2 className="h-4 w-4 text-emerald-400" />}
                </div>
                <p className="text-xs text-slate-400">
                  Combine Vision findings and OMNI DATA statistics into a downloadable PDF briefing.
                </p>
                <button
                  type="button"
                  disabled={guidedBusy === 'report'}
                  onClick={() => void runGuidedReportExport()}
                  className="flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-500 px-3 py-2 text-xs font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-40"
                >
                  <Download className="h-3.5 w-3.5" />
                  <span>{guidedBusy === 'report' ? 'Compiling PDF...' : '3. Generate Combined PDF'}</span>
                </button>
                {guidedReportSuccess && (
                  <p className="font-mono text-[11px] text-emerald-400">
                    Compiled & downloaded omnix-onboarding-inspection-report.pdf
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Step 6: Readiness */}
        {currentStep.id === 'ready' && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {([
                ['assistant', 'AI Assistant (OMNI BRAIN)'],
                ['vision', 'OMNI VISION'],
                ['data', 'OMNI DATA & Reports'],
                ['integrations', 'OMNI CONNECT Plugins'],
              ] as const).map(([viewId, label]) => (
                <button
                  key={viewId}
                  type="button"
                  onClick={() => setActiveView(viewId)}
                  className="rounded-lg border border-slate-800 bg-[#0B0F17] p-4 text-start text-xs font-semibold text-slate-200 hover:border-sky-500/40 hover:text-white"
                >
                  <Play className="h-4 w-4 text-sky-400 mb-2" />
                  <span>{label}</span>
                </button>
              ))}
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => {
                  const allIds = ONBOARDING_STEPS.map((s) => s.id);
                  void persistProgress({
                    ...progress,
                    completedStepIds: allIds,
                    dismissed: true,
                  });
                  setActiveView('home');
                }}
                className="rounded-lg bg-sky-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-sky-400"
              >
                Complete Onboarding & Return to Overview
              </button>
            </div>
          </div>
        )}

        {/* Footer Prev / Next Stepper */}
        <div className="flex items-center justify-between border-t border-slate-800 pt-4">
          <button
            type="button"
            disabled={activeIdx === 0}
            onClick={() => setActiveIdx((i) => Math.max(0, i - 1))}
            className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-[#0B0F17] px-3.5 py-2 text-xs font-medium text-slate-200 hover:border-slate-500 disabled:opacity-40"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span>{isAr ? 'السابق' : 'Previous Step'}</span>
          </button>

          <button
            type="button"
            disabled={activeIdx === ONBOARDING_STEPS.length - 1}
            onClick={() => {
              completeStep(currentStep.id);
              setActiveIdx((i) => Math.min(ONBOARDING_STEPS.length - 1, i + 1));
            }}
            className="flex items-center gap-1.5 rounded-lg bg-sky-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-sky-400 disabled:opacity-40"
          >
            <span>{isAr ? 'التالي' : 'Next Step'}</span>
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
