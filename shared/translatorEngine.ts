export type TranslationTone = 'Technical' | 'Academic' | 'Legal' | 'Business' | 'Literary' | 'Formal' | 'Casual';
export type TranslationDomain = 'General' | 'Software Engineering' | 'Physics & Science' | 'Medicine' | 'Law' | 'Finance' | 'Marketing' | 'Academic';

export interface SubtitleCue {
  index: number;
  startTime: string;
  endTime: string;
  text: string;
}

export interface GlossaryTerm {
  sourceTerm: string;
  targetTerm: string;
  domain: string;
}

export interface TranslationQualityReport {
  glossaryCompliancePct: number;
  glossaryMismatches: Array<{ sourceTerm: string; expectedTarget: string }>;
  placeholderPreserved: boolean;
  lengthRatio: number;
  completenessOk: boolean;
  issues: string[];
}

export function parseSubtitles(content: string): { format: 'srt' | 'vtt'; cues: SubtitleCue[] } {
  const trimmed = content.trim();
  const isVtt = trimmed.startsWith('WEBVTT');
  const clean = isVtt ? trimmed.replace(/^WEBVTT[^\n]*\n+/, '') : trimmed;
  const blocks = clean.split(/\r?\n\r?\n+/);
  const cues: SubtitleCue[] = [];
  let autoIdx = 1;

  for (const block of blocks) {
    const lines = block.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) continue;
    let linePtr = 0;
    let idx = autoIdx;
    if (/^\d+$/.test(lines[0])) {
      idx = Number(lines[0]);
      linePtr = 1;
    }
    const timeLine = lines[linePtr] || '';
    const tm = timeLine.match(/^(\d{2}:\d{2}:\d{2}[.,]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[.,]\d{3})/);
    if (!tm) continue;
    const text = lines.slice(linePtr + 1).join('\n');
    if (text) {
      cues.push({ index: idx, startTime: tm[1], endTime: tm[2], text });
      autoIdx++;
    }
  }
  return { format: isVtt ? 'vtt' : 'srt', cues };
}

export function serializeSubtitles(cues: SubtitleCue[], format: 'srt' | 'vtt'): string {
  if (format === 'vtt') {
    const body = cues
      .map((c) => `${c.startTime.replace(',', '.')} --> ${c.endTime.replace(',', '.')}\n${c.text}`)
      .join('\n\n');
    return `WEBVTT\n\n${body}\n`;
  }
  return (
    cues
      .map((c) => `${c.index}\n${c.startTime.replace('.', ',')} --> ${c.endTime.replace('.', ',')}\n${c.text}`)
      .join('\n\n') + '\n'
  );
}

export function applyGlossaryHints(text: string, glossaries: GlossaryTerm[]): {
  matchedTerms: GlossaryTerm[];
  annotatedPrompt: string;
} {
  const lower = text.toLowerCase();
  const matchedTerms = glossaries.filter((g) => lower.includes(g.sourceTerm.toLowerCase()));
  const hints = matchedTerms
    .map((g) => `"${g.sourceTerm}" => "${g.targetTerm}"`)
    .join(', ');
  return {
    matchedTerms,
    annotatedPrompt: hints ? `Mandatory glossary mappings: ${hints}` : '',
  };
}

export function computeStringSimilarity(a: string, b: string): number {
  const normA = a.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const normB = b.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (normA.length === 0 || normB.length === 0) return 0;
  if (a.toLowerCase().trim() === b.toLowerCase().trim()) return 1;
  const setA = new Set(normA);
  const setB = new Set(normB);
  let overlap = 0;
  for (const w of setA) {
    if (setB.has(w)) overlap++;
  }
  return Number(((2 * overlap) / (setA.size + setB.size)).toFixed(3));
}

export function deterministicTranslateFallback(params: {
  text: string;
  sourceLang: string;
  targetLang: string;
  glossaries: GlossaryTerm[];
  memoryMatches: Array<{ source_text: string; target_text: string }>;
}): { translated: string; usedMemory: boolean } {
  const trimmed = params.text.trim();
  const exactTm = params.memoryMatches.find(
    (m) => m.source_text.trim().toLowerCase() === trimmed.toLowerCase()
  );
  if (exactTm) {
    return { translated: exactTm.target_text, usedMemory: true };
  }

  let output = params.text;
  // Apply exact glossary term substitutions first
  for (const g of params.glossaries) {
    const re = new RegExp(`\\b${g.sourceTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
    output = output.replace(re, g.targetTerm);
  }

  // Built-in core engineering bilingual dictionary for offline resilience
  const enToAr: Array<[RegExp, string]> = [
    [/\bsystem architecture\b/gi, 'البنية المعمارية للنظام'],
    [/\bdatabase\b/gi, 'قاعدة البيانات'],
    [/\bauthentication\b/gi, 'المصادقة'],
    [/\bsecurity\b/gi, 'الأمان'],
    [/\bperformance\b/gi, 'الأداء'],
    [/\banalysis\b/gi, 'التحليل'],
    [/\breport\b/gi, 'تقرير'],
    [/\bproject\b/gi, 'مشروع'],
    [/\buser\b/gi, 'مستخدم'],
    [/\bengineering\b/gi, 'الهندسة'],
  ];
  const arToEn: Array<[RegExp, string]> = [
    [/البنية المعمارية/g, 'system architecture'],
    [/قاعدة البيانات/g, 'database'],
    [/المصادقة/g, 'authentication'],
    [/الأمان/g, 'security'],
    [/الأداء/g, 'performance'],
    [/التحليل/g, 'analysis'],
    [/تقرير/g, 'report'],
    [/مشروع/g, 'project'],
    [/شركة هندسية/g, 'engineering firm'],
  ];

  if (params.targetLang.startsWith('ar')) {
    for (const [pat, rep] of enToAr) output = output.replace(pat, rep);
  } else if (params.targetLang.startsWith('en')) {
    for (const [pat, rep] of arToEn) output = output.replace(pat, rep);
  }

  return { translated: output, usedMemory: false };
}

export function verifyTranslationQuality(params: {
  sourceText: string;
  translatedText: string;
  matchedGlossaryTerms: GlossaryTerm[];
}): TranslationQualityReport {
  const issues: string[] = [];
  const srcTrim = params.sourceText.trim();
  const tgtTrim = params.translatedText.trim();
  const completenessOk = srcTrim.length === 0 || tgtTrim.length > 0;
  if (!completenessOk) issues.push('Translated output is empty.');

  const srcNums = srcTrim.match(/\b\d+(?:\.\d+)?\b/g) || [];
  const missingNums = srcNums.filter((n) => !tgtTrim.includes(n));
  const placeholderPreserved = missingNums.length === 0;
  if (!placeholderPreserved) {
    issues.push(`Numeric values missing in translation: ${missingNums.join(', ')}`);
  }

  const glossaryMismatches: Array<{ sourceTerm: string; expectedTarget: string }> = [];
  for (const g of params.matchedGlossaryTerms) {
    if (!tgtTrim.toLowerCase().includes(g.targetTerm.toLowerCase())) {
      glossaryMismatches.push({ sourceTerm: g.sourceTerm, expectedTarget: g.targetTerm });
    }
  }
  if (glossaryMismatches.length > 0) {
    issues.push(`${glossaryMismatches.length} domain glossary term(s) were not applied strictly.`);
  }

  const glossaryCompliancePct =
    params.matchedGlossaryTerms.length === 0
      ? 100
      : Math.round(
          ((params.matchedGlossaryTerms.length - glossaryMismatches.length) /
            params.matchedGlossaryTerms.length) *
            100
        );

  const lengthRatio = Number((tgtTrim.length / Math.max(1, srcTrim.length)).toFixed(2));
  if (lengthRatio > 3.5 || (srcTrim.length > 20 && lengthRatio < 0.2)) {
    issues.push(`Unusual length ratio (${lengthRatio}x) detected.`);
  }

  return {
    glossaryCompliancePct,
    glossaryMismatches,
    placeholderPreserved,
    lengthRatio,
    completenessOk,
    issues,
  };
}
