export interface OnboardingStepDef {
  id: 'brain' | 'vision' | 'voice' | 'agent' | 'guided_task' | 'ready';
  stepNumber: number;
  titleEn: string;
  titleAr: string;
  systemName: string;
  modalityEn: string;
  modalityAr: string;
  summaryEn: string;
  summaryAr: string;
  targetView: 'assistant' | 'vision' | 'voice' | 'agents' | 'data' | 'integrations';
}

export const ONBOARDING_STEPS: OnboardingStepDef[] = [
  {
    id: 'brain',
    stepNumber: 1,
    titleEn: 'Text Orchestration with OMNI BRAIN',
    titleAr: 'التنسيق النصي عبر OMNI BRAIN',
    systemName: 'OMNI BRAIN',
    modalityEn: 'Text Input',
    modalityAr: 'الإدخال النصي',
    summaryEn:
      'OMNI BRAIN decomposes multi-step natural language directives into verified sequential workflows across Math, Data, 3D, and Memory engines.',
    summaryAr:
      'يقوم OMNI BRAIN بتحليل الأوامر النصية متعددة المراحل وتقسيمها إلى مهام متسلسلة عبر الوكلاء المتخصصين.',
    targetView: 'assistant',
  },
  {
    id: 'vision',
    stepNumber: 2,
    titleEn: 'Visual Inspection with OMNI VISION',
    titleAr: 'التحليل البصري عبر OMNI VISION',
    systemName: 'OMNI VISION',
    modalityEn: 'Image Input',
    modalityAr: 'إدخال الصور',
    summaryEn:
      'Inspect uploaded images or live camera frames, measure pixel luminance and edge density, extract OCR text, and run two-image change detection.',
    summaryAr:
      'فحص الصور المرفوعة أو لقطات الكاميرا، وقياس السطوع والحواف، واستخراج النصوص، وكشف التغييرات بين صورتين.',
    targetView: 'vision',
  },
  {
    id: 'voice',
    stepNumber: 3,
    titleEn: 'Speech Commands with OMNI VOICE',
    titleAr: 'الأوامر الصوتية عبر OMNI VOICE',
    systemName: 'OMNI VOICE',
    modalityEn: 'Voice Input & TTS',
    modalityAr: 'الإدخال الصوتي والنطق',
    summaryEn:
      'Capture spoken commands via browser SpeechRecognition, monitor microphone energy with Web Audio VAD, and synthesize bilingual audio briefings.',
    summaryAr:
      'التقاط الأوامر الصوتية، ومراقبة مستوى الإشارة الصوتية، وتحويل الملخصات إلى صوت ناطق بالعربية والإنجليزية.',
    targetView: 'voice',
  },
  {
    id: 'agent',
    stepNumber: 4,
    titleEn: '12-Agent Execution & Safety Gates',
    titleAr: 'تنفيذ الوكلاء وبوابات الأمان',
    systemName: 'OMNI AGENT',
    modalityEn: 'Autonomous Workflows',
    modalityAr: 'سير العمل الوكيل',
    summaryEn:
      'Route specialized tasks across 12 domain agents with isolated VM sandboxing, Quality Assurance verification, and explicit approval queues for sensitive actions.',
    summaryAr:
      'توجيه المهام عبر 12 وكيلاً متخصصاً مع بيئة تنفيذ معزولة والتحقق من الجودة وبوابات الموافقة الأمنية.',
    targetView: 'agents',
  },
  {
    id: 'guided_task',
    stepNumber: 5,
    titleEn: 'Guided Task: OMNI VISION to OMNI DATA Report',
    titleAr: 'تطبيق عملي: تحليل صورة وإنشاء تقرير',
    systemName: 'OMNI VISION + OMNI DATA',
    modalityEn: 'End-to-End Pipeline',
    modalityAr: 'مسار متكامل',
    summaryEn:
      'Follow a live 3-step engineering pipeline: inspect an equipment image with OMNI VISION, correlate telemetry in OMNI DATA, and compile a downloadable PDF report.',
    summaryAr:
      'نفذ مساراً عملياً من 3 خطوات: فحص صورة معدات عبر OMNI VISION، وتحليل بيانات القياس، وإصدار تقرير PDF.',
    targetView: 'data',
  },
  {
    id: 'ready',
    stepNumber: 6,
    titleEn: 'Workspace Readiness & Next Destinations',
    titleAr: 'جاهزية مساحة العمل والخطوات التالية',
    systemName: 'OMNIX Platform',
    modalityEn: 'Full Workspace',
    modalityAr: 'المنصة الكاملة',
    summaryEn:
      'Your multimodal onboarding checklist is complete. Jump directly into any OMNIX studio or connect external services via OMNI CONNECT plugins.',
    summaryAr:
      'اكتمل الدليل التفاعلي. يمكنك الانتقال مباشرة إلى أي استوديو أو ربط الخدمات عبر إضافات OMNI CONNECT.',
    targetView: 'integrations',
  },
];

export interface OnboardingProgressState {
  completedStepIds: string[];
  guidedVisionDone: boolean;
  guidedDataDone: boolean;
  guidedReportDone: boolean;
  dismissed: boolean;
}

export function createInitialOnboardingProgress(): OnboardingProgressState {
  return {
    completedStepIds: [],
    guidedVisionDone: false,
    guidedDataDone: false,
    guidedReportDone: false,
    dismissed: false,
  };
}

export function markOnboardingStepComplete(
  state: OnboardingProgressState,
  stepId: OnboardingStepDef['id']
): OnboardingProgressState {
  if (state.completedStepIds.includes(stepId)) return state;
  return {
    ...state,
    completedStepIds: [...state.completedStepIds, stepId],
  };
}

export function calculateOnboardingCompletionPercent(state: OnboardingProgressState): number {
  const trackable = ONBOARDING_STEPS.filter((s) => s.id !== 'ready');
  const completedCount = trackable.filter((s) => state.completedStepIds.includes(s.id)).length;
  return Math.round((completedCount / trackable.length) * 100);
}
