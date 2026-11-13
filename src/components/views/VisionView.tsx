import React, { useState } from 'react';
import { Eye, ImagePlus, Layers, Smartphone } from 'lucide-react';
import { useOmnix } from '../../contexts/OmnixContext';
import { CameraCapture } from '../vision/CameraCapture';

interface PixelTelemetry {
  width: number;
  height: number;
  meanLuminance: number;
  edgeDensity: number;
}

function measureCanvasTelemetry(img: HTMLImageElement): PixelTelemetry {
  const canvas = document.createElement('canvas');
  const w = Math.min(320, img.naturalWidth || 320);
  const h = Math.min(240, img.naturalHeight || 240);
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return { width: img.naturalWidth, height: img.naturalHeight, meanLuminance: 0, edgeDensity: 0 };
  ctx.drawImage(img, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);

  let lumSum = 0;
  let edgeHits = 0;
  const pxCount = w * h;
  const lum = new Float32Array(pxCount);

  for (let i = 0; i < pxCount; i++) {
    const idx = i * 4;
    const y = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
    lum[i] = y;
    lumSum += y;
  }

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = y * w + x;
      const gx = Math.abs(lum[idx + 1] - lum[idx - 1]);
      const gy = Math.abs(lum[idx + w] - lum[idx - w]);
      if (gx + gy > 48) edgeHits++;
    }
  }

  return {
    width: img.naturalWidth,
    height: img.naturalHeight,
    meanLuminance: Math.round(lumSum / pxCount),
    edgeDensity: Number((edgeHits / pxCount).toFixed(4)),
  };
}

export function VisionView() {
  const { activeWorkspaceId, language } = useOmnix();
  const isAr = language === 'ar';

  const [mode, setMode] = useState<'vqa' | 'ocr' | 'diff'>('vqa');
  const [question, setQuestion] = useState(
    'What objects and components are visible in this image? Report confidence and limitations.'
  );
  const [primaryImg, setPrimaryImg] = useState<{ src: string; mimeType: string; telemetry?: PixelTelemetry } | null>(
    null
  );
  const [compareImg, setCompareImg] = useState<{ src: string; mimeType: string } | null>(null);
  const [diffSummary, setDiffSummary] = useState<{ changedPercent: number; diffDataUrl: string } | null>(null);
  const [result, setResult] = useState<{ analysis: string; confidenceNote: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const attachPrimaryDataUrl = (src: string, mimeType: string) => {
    setError(null);
    const img = new Image();
    img.onload = () => {
      const telemetry = measureCanvasTelemetry(img);
      setPrimaryImg({ src, mimeType, telemetry });
      setResult(null);
    };
    img.src = src;
  };

  const loadImageFile = (file: File, target: 'primary' | 'compare') => {
    setError(null);
    const reader = new FileReader();
    reader.onload = () => {
      const src = String(reader.result || '');
      if (target === 'primary') {
        attachPrimaryDataUrl(src, file.type || 'image/png');
      } else {
        setCompareImg({ src, mimeType: file.type || 'image/png' });
      }
    };
    reader.readAsDataURL(file);
  };

  const runChangeDetection = () => {
    if (!primaryImg || !compareImg) return;
    const imgA = new Image();
    const imgB = new Image();
    imgA.onload = () => {
      imgB.onload = () => {
        const w = 320;
        const h = 240;
        const cA = document.createElement('canvas');
        const cB = document.createElement('canvas');
        const cOut = document.createElement('canvas');
        cA.width = cB.width = cOut.width = w;
        cA.height = cB.height = cOut.height = h;
        const ctxA = cA.getContext('2d')!;
        const ctxB = cB.getContext('2d')!;
        const ctxOut = cOut.getContext('2d')!;
        ctxA.drawImage(imgA, 0, 0, w, h);
        ctxB.drawImage(imgB, 0, 0, w, h);
        const dA = ctxA.getImageData(0, 0, w, h).data;
        const dB = ctxB.getImageData(0, 0, w, h).data;
        const out = ctxOut.createImageData(w, h);
        let changed = 0;

        for (let i = 0; i < w * h; i++) {
          const idx = i * 4;
          const diff =
            Math.abs(dA[idx] - dB[idx]) +
            Math.abs(dA[idx + 1] - dB[idx + 1]) +
            Math.abs(dA[idx + 2] - dB[idx + 2]);
          if (diff > 75) {
            changed++;
            out.data[idx] = 244;
            out.data[idx + 1] = 63;
            out.data[idx + 2] = 94;
            out.data[idx + 3] = 255;
          } else {
            out.data[idx] = Math.round(dA[idx] * 0.35);
            out.data[idx + 1] = Math.round(dA[idx + 1] * 0.35);
            out.data[idx + 2] = Math.round(dA[idx + 2] * 0.35);
            out.data[idx + 3] = 255;
          }
        }
        ctxOut.putImageData(out, 0, 0);
        setDiffSummary({
          changedPercent: Number(((changed / (w * h)) * 100).toFixed(2)),
          diffDataUrl: cOut.toDataURL('image/png'),
        });
      };
      imgB.src = compareImg.src;
    };
    imgA.src = primaryImg.src;
  };

  const analyzePrimary = async () => {
    if (!primaryImg) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/vision/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceId: activeWorkspaceId,
          mode,
          question,
          imageBase64: primaryImg.src,
          mimeType: primaryImg.mimeType,
          imageMeta: primaryImg.telemetry,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Vision analysis failed');
      setResult({ analysis: data.analysis, confidenceNote: data.confidenceNote });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Vision request failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-800/80 pb-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-50">
            OMNI VISION — Visual Question Answering & Change Detection
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Inspect images, extract OCR text, capture live camera photos, and run pixel-level change detection.
          </p>
        </div>

        <div className="flex items-center gap-1 rounded-lg bg-[#111724] p-1 border border-slate-800">
          {([
            ['vqa', 'Visual Q&A'],
            ['ocr', 'Document OCR'],
            ['diff', 'Change Detection'],
          ] as const).map(([m, label]) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                mode === m ? 'bg-sky-500/20 text-sky-300' : 'text-slate-400 hover:text-slate-100'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div role="alert" className="rounded-lg border border-red-500/40 bg-red-950/20 px-4 py-2.5 text-xs text-red-300">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="lg:col-span-6 space-y-4 rounded-xl border border-slate-800 bg-[#111724] p-5">
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-700 bg-[#0B0F17] px-3 py-2 text-xs font-medium text-slate-200 hover:border-slate-600">
              <ImagePlus className="h-3.5 w-3.5 text-sky-400" />
              <span>{isAr ? 'رفع صورة' : 'Upload Image'}</span>
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) loadImageFile(f, 'primary');
                  e.target.value = '';
                }}
              />
            </label>

            <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-700 bg-[#0B0F17] px-3 py-2 text-xs font-medium text-slate-200 hover:border-slate-600">
              <Smartphone className="h-3.5 w-3.5 text-cyan-400" />
              <span>{isAr ? 'كاميرا الجهاز' : 'Device Camera'}</span>
              <input
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) loadImageFile(f, 'primary');
                  e.target.value = '';
                }}
              />
            </label>

            {mode === 'diff' && (
              <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-700 bg-[#0B0F17] px-3 py-2 text-xs font-medium text-slate-200 hover:border-slate-600">
                <Layers className="h-3.5 w-3.5 text-amber-400" />
                <span>{isAr ? 'صورة المقارنة' : 'Comparison Image'}</span>
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) loadImageFile(f, 'compare');
                    e.target.value = '';
                  }}
                />
              </label>
            )}
          </div>

          <CameraCapture
            isAr={isAr}
            onFrameCaptured={({ src, mimeType }) => attachPrimaryDataUrl(src, mimeType)}
            onFallbackFile={(file) => loadImageFile(file, 'primary')}
          />

          {primaryImg ? (
            <div className="space-y-2">
              <img
                src={primaryImg.src}
                alt="Primary visual input"
                className="max-h-72 w-full rounded-lg border border-slate-800 object-contain bg-[#0B0F17]"
              />
              {primaryImg.telemetry && (
                <p className="font-mono text-xs tabular-nums text-slate-400">
                  {primaryImg.telemetry.width}×{primaryImg.telemetry.height} px · Mean Luminance:{' '}
                  {primaryImg.telemetry.meanLuminance}/255 · Edge Density:{' '}
                  {(primaryImg.telemetry.edgeDensity * 100).toFixed(1)}%
                </p>
              )}
            </div>
          ) : (
            <div className="flex h-48 items-center justify-center rounded-lg border border-dashed border-slate-700 bg-[#0B0F17] px-4 text-center text-xs text-slate-500">
              {isAr
                ? 'ارفع صورة أو افتح الكاميرا لالتقاط صورة وإرفاقها للتحليل'
                : 'Upload an image or open the camera above to capture and attach a frame for inspection'}
            </div>
          )}

          {mode === 'diff' && diffSummary && (
            <div className="space-y-2 pt-2 border-t border-slate-800">
              <p className="font-mono text-xs tabular-nums text-rose-300">
                Measured Spatial Change: {diffSummary.changedPercent}% of pixels shifted
              </p>
              <img
                src={diffSummary.diffDataUrl}
                alt="Pixel change heatmap"
                className="max-h-56 w-full rounded-lg border border-slate-800 object-contain bg-black"
              />
            </div>
          )}
        </div>

        <div className="lg:col-span-6 space-y-4 rounded-xl border border-slate-800 bg-[#111724] p-5">
          <h2 className="font-display text-sm font-semibold text-slate-100">
            {mode === 'diff' ? 'Two-Image Change Detection' : 'Visual Question Answering Prompt'}
          </h2>

          {mode !== 'diff' ? (
            <>
              <textarea
                rows={3}
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                aria-label="Visual question"
                className="w-full rounded-lg border border-slate-800 bg-[#0B0F17] px-3 py-2 text-xs text-slate-100"
              />
              <button
                type="button"
                disabled={!primaryImg || loading}
                onClick={() => void analyzePrimary()}
                className="flex items-center gap-2 rounded-lg bg-sky-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-sky-400 disabled:opacity-40"
              >
                <Eye className="h-3.5 w-3.5" />
                <span>{loading ? (isAr ? 'جاري التحليل...' : 'Analyzing...') : isAr ? 'تحليل الصورة المرفقة' : 'Analyze Image'}</span>
              </button>
            </>
          ) : (
            <button
              type="button"
              disabled={!primaryImg || !compareImg}
              onClick={runChangeDetection}
              className="flex items-center gap-2 rounded-lg bg-sky-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-sky-400 disabled:opacity-40"
            >
              <Layers className="h-3.5 w-3.5" />
              <span>Compute Change Diff</span>
            </button>
          )}

          {result && (
            <div className="rounded-lg border border-slate-800 bg-[#0B0F17] p-4 space-y-2 text-xs">
              <p className="font-medium text-sky-400">{result.confidenceNote}</p>
              <div className="whitespace-pre-wrap text-slate-200 leading-relaxed">
                {result.analysis}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
