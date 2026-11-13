import crypto from 'node:crypto';
import {
  applyGlossaryHints,
  computeStringSimilarity,
  deterministicTranslateFallback,
  parseSubtitles,
  serializeSubtitles,
  verifyTranslationQuality,
  type GlossaryTerm,
  type TranslationDomain,
  type TranslationQualityReport,
  type TranslationTone,
} from '../../shared/translatorEngine.ts';
import { invokeModelGateway } from './modelGateway.ts';
import { getDb } from '../db/schema.ts';

export async function translateContextual(params: {
  workspaceId: string;
  userId: string;
  text: string;
  sourceLang: string;
  targetLang: string;
  tone: TranslationTone;
  domain: TranslationDomain;
  jobType?: 'text' | 'document' | 'voice' | 'subtitle';
  runBackTranslation?: boolean;
}): Promise<{
  jobId: string;
  translatedText: string;
  usedTranslationMemory: boolean;
  tmMatchScore: number;
  backTranslation?: string;
  quality: TranslationQualityReport;
  provider: string;
}> {
  const db = getDb();
  const glossaries = db
    .prepare(
      `SELECT source_term as sourceTerm, target_term as targetTerm, domain FROM translator_glossaries
       WHERE workspace_id = ? AND source_lang = ? AND target_lang = ?`
    )
    .all(params.workspaceId, params.sourceLang, params.targetLang) as unknown as GlossaryTerm[];

  const tmEntries = db
    .prepare(
      `SELECT source_text, target_text FROM translator_memory
       WHERE workspace_id = ? AND source_lang = ? AND target_lang = ? ORDER BY usage_count DESC LIMIT 50`
    )
    .all(params.workspaceId, params.sourceLang, params.targetLang) as Array<{ source_text: string; target_text: string }>;

  let bestTmScore = 0;
  let exactTmTarget: string | null = null;
  for (const m of tmEntries) {
    const score = computeStringSimilarity(params.text, m.source_text);
    if (score > bestTmScore) bestTmScore = score;
    if (score >= 0.99) exactTmTarget = m.target_text;
  }

  const { matchedTerms, annotatedPrompt } = applyGlossaryHints(params.text, glossaries);
  let translatedText = '';
  let usedTranslationMemory = false;
  let provider = 'translation-memory';

  if (exactTmTarget) {
    translatedText = exactTmTarget;
    usedTranslationMemory = true;
  } else {
    const gw = await invokeModelGateway({
      workspaceId: params.workspaceId,
      prompt: `Translate accurately from ${params.sourceLang} to ${params.targetLang}.
Domain: ${params.domain}
Tone/Style: ${params.tone}
${annotatedPrompt ? `${annotatedPrompt}\n` : ''}
Preserve formatting, numbers, and technical precision. Output ONLY the translated text without commentary.

Source Text:
${params.text}`,
      systemInstruction:
        'You are OMNI TRANSLATOR, an expert technical, legal, and academic translator. Return strictly the target translation.',
      localFallbackHandler: () =>
        deterministicTranslateFallback({
          text: params.text,
          sourceLang: params.sourceLang,
          targetLang: params.targetLang,
          glossaries: matchedTerms,
          memoryMatches: tmEntries,
        }).translated,
    });
    translatedText = gw.text.trim();
    provider = gw.provider;
  }

  let backTranslation: string | undefined;
  if (params.runBackTranslation) {
    const backGw = await invokeModelGateway({
      workspaceId: params.workspaceId,
      prompt: `Translate back literally from ${params.targetLang} to ${params.sourceLang} to verify semantic fidelity. Output ONLY the back-translation.\n\n${translatedText}`,
      localFallbackHandler: () =>
        deterministicTranslateFallback({
          text: translatedText,
          sourceLang: params.targetLang,
          targetLang: params.sourceLang,
          glossaries: [],
          memoryMatches: [],
        }).translated,
    });
    backTranslation = backGw.text.trim();
  }

  const quality = verifyTranslationQuality({
    sourceText: params.text,
    translatedText,
    matchedGlossaryTerms: matchedTerms,
  });

  // Persist into Translation Memory if short/medium segment and non-empty
  if (params.text.trim().length > 2 && params.text.trim().length <= 500 && !exactTmTarget) {
    db.prepare(
      `INSERT INTO translator_memory (id, workspace_id, user_id, source_lang, target_lang, domain, source_text, target_text)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      `tm-${crypto.randomUUID().slice(0, 8)}`,
      params.workspaceId,
      params.userId,
      params.sourceLang,
      params.targetLang,
      params.domain,
      params.text.trim(),
      translatedText
    );
  }

  const jobId = `trj-${crypto.randomUUID().slice(0, 8)}`;
  db.prepare(
    `INSERT INTO translator_jobs (id, workspace_id, user_id, job_type, source_lang, target_lang, tone, domain, source_preview, translated_output, qa_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    jobId,
    params.workspaceId,
    params.userId,
    params.jobType || 'text',
    params.sourceLang,
    params.targetLang,
    params.tone,
    params.domain,
    params.text.slice(0, 400),
    translatedText,
    JSON.stringify({ ...quality, backTranslation })
  );

  return {
    jobId,
    translatedText,
    usedTranslationMemory,
    tmMatchScore: bestTmScore,
    backTranslation,
    quality,
    provider,
  };
}

export async function translateSubtitlesContent(params: {
  workspaceId: string;
  userId: string;
  subtitleContent: string;
  sourceLang: string;
  targetLang: string;
  domain: TranslationDomain;
}): Promise<{ format: 'srt' | 'vtt'; cueCount: number; outputSubtitle: string }> {
  const parsed = parseSubtitles(params.subtitleContent);
  if (parsed.cues.length === 0) {
    throw new Error('No valid .srt or .vtt timestamped subtitle cues found.');
  }

  const joined = parsed.cues.map((c, idx) => `[#${idx + 1}] ${c.text.replace(/\n/g, ' ')}`).join('\n');
  const res = await translateContextual({
    workspaceId: params.workspaceId,
    userId: params.userId,
    text: joined,
    sourceLang: params.sourceLang,
    targetLang: params.targetLang,
    tone: 'Casual',
    domain: params.domain,
    jobType: 'subtitle',
  });

  const translatedLines = res.translatedText.split(/\r?\n/);
  const updatedCues = parsed.cues.map((cue, idx) => {
    const marker = `[#${idx + 1}]`;
    const matchLine = translatedLines.find((l) => l.trim().startsWith(marker)) || translatedLines[idx];
    const cleanText = matchLine ? matchLine.replace(/^\[#\d+\]\s*/, '').trim() : cue.text;
    return { ...cue, text: cleanText || cue.text };
  });

  return {
    format: parsed.format,
    cueCount: updatedCues.length,
    outputSubtitle: serializeSubtitles(updatedCues, parsed.format),
  };
}
