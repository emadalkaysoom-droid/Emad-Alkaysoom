import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, RefreshCw, Smartphone, VideoOff } from 'lucide-react';

export type CameraPermissionState = 'unknown' | 'granted' | 'prompt' | 'denied';
export type CameraStreamState = 'idle' | 'requesting' | 'active' | 'denied' | 'unavailable' | 'error';

export interface CameraCaptureProps {
  isAr: boolean;
  onFrameCaptured: (payload: { src: string; mimeType: string }) => void;
  onFallbackFile: (file: File) => void;
}

function classifyCameraError(err: unknown, isAr: boolean): {
  streamState: CameraStreamState;
  message: string;
} {
  const name = err instanceof Error ? err.name : '';
  const msg = err instanceof Error ? err.message : '';

  if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || /permission|denied|policy/i.test(msg)) {
    return {
      streamState: 'denied',
      message: isAr
        ? 'تم رفض إذن الكاميرا في المتصفح أو داخل الإطار. اسمح بالوصول للكاميرا أو استخدم "كاميرا الجهاز".'
        : 'Camera permission was denied by the browser or iframe policy. Allow camera access or use "Device Camera".',
    };
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || /not found|requested device/i.test(msg)) {
    return {
      streamState: 'unavailable',
      message: isAr
        ? 'لم يتم العثور على كاميرا متصلة. استخدم "كاميرا الجهاز" أو "رفع صورة".'
        : 'No camera hardware device detected. Use "Device Camera" or "Upload Image".',
    };
  }
  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return {
      streamState: 'error',
      message: isAr
        ? 'الكاميرا مستخدمة من تطبيق آخر حالياً. أغلق التطبيق الآخر ثم أعد المحاولة.'
        : 'Camera device is currently locked by another application. Close it and retry.',
    };
  }
  return {
    streamState: 'error',
    message: msg || (isAr ? 'تعذر تشغيل بث الكاميرا.' : 'Failed to initialize video stream.'),
  };
}

export function CameraCapture({ isAr, onFrameCaptured, onFallbackFile }: CameraCaptureProps) {
  const [permissionState, setPermissionState] = useState<CameraPermissionState>('unknown');
  const [streamState, setStreamState] = useState<CameraStreamState>('idle');
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [resolution, setResolution] = useState<{ width: number; height: number } | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const stopTracks = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setResolution(null);
  }, []);

  const stopCamera = useCallback(() => {
    stopTracks();
    setStreamState('idle');
    setErrorMessage(null);
  }, [stopTracks]);

  // Query browser camera permission state on mount
  useEffect(() => {
    let cancelled = false;
    let permStatus: PermissionStatus | null = null;
    let handlePermChange: (() => void) | null = null;

    const queryPermissions = async () => {
      if (!navigator.permissions?.query) return;
      try {
        permStatus = await navigator.permissions.query({ name: 'camera' as PermissionName });
        if (cancelled) return;
        const mapState = (s: PermissionState): CameraPermissionState =>
          s === 'granted' || s === 'prompt' || s === 'denied' ? s : 'unknown';
        setPermissionState(mapState(permStatus.state));
        handlePermChange = () => {
          if (permStatus && !cancelled) setPermissionState(mapState(permStatus.state));
        };
        permStatus.addEventListener('change', handlePermChange);
      } catch {
        // Permissions API for 'camera' is unsupported in some browsers
      }
    };

    void queryPermissions();

    return () => {
      cancelled = true;
      if (permStatus && handlePermChange) {
        permStatus.removeEventListener('change', handlePermChange);
      }
      stopTracks();
    };
  }, [stopTracks]);

  // Attach MediaStream only after <video> mounts into the DOM
  useEffect(() => {
    if (streamState !== 'active') return;
    const video = videoRef.current;
    const stream = streamRef.current;
    if (!video || !stream) return;

    video.srcObject = stream;
    const syncResolution = () => {
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        setResolution({ width: video.videoWidth, height: video.videoHeight });
      }
      void video.play().catch(() => {});
    };

    video.addEventListener('loadedmetadata', syncResolution);
    void video
      .play()
      .then(syncResolution)
      .catch(() => {});

    return () => {
      video.removeEventListener('loadedmetadata', syncResolution);
    };
  }, [streamState, facingMode]);

  const startCamera = useCallback(
    async (targetFacing: 'environment' | 'user' = facingMode) => {
      setErrorMessage(null);
      if (!navigator.mediaDevices?.getUserMedia) {
        setStreamState('unavailable');
        setErrorMessage(
          isAr
            ? 'واجهة الكاميرا المباشرة غير مدعومة في هذا المتصفح. استخدم "كاميرا الجهاز".'
            : 'navigator.mediaDevices.getUserMedia is unavailable in this browser context. Use "Device Camera".'
        );
        return;
      }

      stopTracks();
      setStreamState('requesting');

      try {
        let stream: MediaStream;
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: targetFacing }, width: { ideal: 1280 }, height: { ideal: 720 } },
            audio: false,
          });
        } catch (primaryErr) {
          const name = primaryErr instanceof Error ? primaryErr.name : '';
          if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
            throw primaryErr;
          }
          stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        }

        streamRef.current = stream;
        setPermissionState('granted');
        setFacingMode(targetFacing);
        setStreamState('active');
      } catch (err) {
        const classified = classifyCameraError(err, isAr);
        if (classified.streamState === 'denied') setPermissionState('denied');
        setStreamState(classified.streamState);
        setErrorMessage(classified.message);
        stopTracks();
      }
    },
    [facingMode, isAr, stopTracks]
  );

  const switchCamera = () => {
    const nextFacing = facingMode === 'environment' ? 'user' : 'environment';
    void startCamera(nextFacing);
  };

  const captureFrame = () => {
    const video = videoRef.current;
    if (!video) return;
    const width = video.videoWidth || 640;
    const height = video.videoHeight || 480;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, width, height);
    const src = canvas.toDataURL('image/png');
    onFrameCaptured({ src, mimeType: 'image/png' });
    stopCamera();
  };

  const stateLabel: Record<CameraStreamState, string> = {
    idle: isAr ? 'خامل' : 'Idle',
    requesting: isAr ? 'طلب الإذن...' : 'Requesting Access...',
    active: isAr ? 'بث نشط' : 'Stream Active',
    denied: isAr ? 'الإذن مرفوض' : 'Permission Denied',
    unavailable: isAr ? 'لا توجد كاميرا' : 'Unavailable',
    error: isAr ? 'خطأ' : 'Stream Error',
  };

  const stateTone =
    streamState === 'active'
      ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
      : streamState === 'denied' || streamState === 'error'
        ? 'border-rose-500/40 bg-rose-950/30 text-rose-300'
        : streamState === 'requesting'
          ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
          : 'border-slate-700 bg-[#0B0F17] text-slate-400';

  return (
    <div
      data-testid="vision-camera-capture"
      data-stream-state={streamState}
      data-permission-state={permissionState}
      className="space-y-3 rounded-lg border border-slate-800 bg-[#0B0F17] p-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded border px-2 py-0.5 font-mono text-[11px] ${stateTone}`}>
            {stateLabel[streamState]}
          </span>
          <span className="rounded border border-slate-800 bg-[#111724] px-2 py-0.5 font-mono text-[11px] text-slate-400">
            perm: {permissionState}
          </span>
          {resolution && (
            <span className="rounded border border-slate-800 bg-[#111724] px-2 py-0.5 font-mono text-[11px] tabular-nums text-sky-300">
              {resolution.width}×{resolution.height} · {facingMode}
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {streamState !== 'active' ? (
            <button
              type="button"
              disabled={streamState === 'requesting'}
              onClick={() => void startCamera(facingMode)}
              className="flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-3 py-1.5 text-xs font-medium text-emerald-300 hover:bg-emerald-500/25 disabled:opacity-50"
            >
              <Camera className="h-3.5 w-3.5" />
              <span>
                {streamState === 'requesting'
                  ? isAr
                    ? 'جاري الفتح...'
                    : 'Requesting Camera...'
                  : isAr
                    ? 'فتح الكاميرا'
                    : 'Open Camera'}
              </span>
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={captureFrame}
                className="flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-emerald-400"
              >
                <Camera className="h-3.5 w-3.5" />
                <span>{isAr ? 'التقاط وإرفاق' : 'Capture & Attach'}</span>
              </button>
              <button
                type="button"
                onClick={switchCamera}
                aria-label="Switch Camera"
                className="flex items-center gap-1 rounded-lg border border-slate-700 bg-[#111724] px-2.5 py-1.5 text-xs text-slate-300 hover:text-white"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                <span>{isAr ? 'تبديل' : 'Flip'}</span>
              </button>
              <button
                type="button"
                onClick={stopCamera}
                aria-label="Stop Camera"
                className="flex items-center gap-1 rounded-lg border border-slate-700 bg-[#111724] px-2.5 py-1.5 text-xs text-slate-300 hover:text-white"
              >
                <VideoOff className="h-3.5 w-3.5" />
                <span>{isAr ? 'إيقاف' : 'Stop'}</span>
              </button>
            </>
          )}
        </div>
      </div>

      {errorMessage && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-2 rounded border border-rose-500/40 bg-rose-950/25 px-3 py-2 text-xs text-rose-300"
        >
          <span>{errorMessage}</span>
          <label className="flex cursor-pointer items-center gap-1.5 rounded border border-slate-700 bg-[#111724] px-2.5 py-1 text-[11px] font-medium text-cyan-300 hover:border-cyan-500/50">
            <Smartphone className="h-3 w-3" />
            <span>{isAr ? 'كاميرا الجهاز' : 'Device Camera'}</span>
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) onFallbackFile(file);
                e.target.value = '';
              }}
            />
          </label>
        </div>
      )}

      {streamState === 'active' && (
        <div className="space-y-1.5 rounded-lg border border-emerald-500/40 bg-black p-2">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            data-testid="vision-camera-video"
            className="max-h-72 w-full rounded bg-black object-cover"
          />
          <p className="px-1 text-[11px] text-slate-400">
            {resolution
              ? isAr
                ? 'البث المباشر جاهز — اضغط "التقاط وإرفاق" لتثبيت الإطار وإرساله لـ OMNI VISION.'
                : 'Live stream active — click "Capture & Attach" to freeze frame for OMNI VISION analysis.'
              : isAr
                ? 'جاري مزامنة تدفق الفيديو...'
                : 'Synchronizing live video stream...'}
          </p>
        </div>
      )}
    </div>
  );
}
