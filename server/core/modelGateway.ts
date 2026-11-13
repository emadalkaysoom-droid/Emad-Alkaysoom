import crypto from 'node:crypto';
import { GoogleGenAI, ThinkingLevel, type FunctionDeclaration } from '@google/genai';
import { getDb } from '../db/schema.ts';

export interface GatewayCallResult {
  text: string;
  provider: 'cloud-gemini' | 'local-deterministic';
  model: string;
  latencyMs: number;
  tokensIn: number;
  tokensOut: number;
  isFallback: boolean;
  fallbackReason?: string;
  functionCalls?: Array<{ name: string; args: Record<string, unknown> }>;
}

let cachedClient: GoogleGenAI | null = null;

export function isGeminiConfigured(): boolean {
  const key = process.env.GEMINI_API_KEY;
  return Boolean(key && key.trim().length > 8 && key !== 'MY_GEMINI_API_KEY');
}

export function getGeminiClient(): GoogleGenAI | null {
  if (!isGeminiConfigured()) return null;
  if (!cachedClient) {
    cachedClient = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return cachedClient;
}

export function recordUsageMetric(params: {
  workspaceId: string;
  modelId: string;
  provider: string;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
}): void {
  const db = getDb();
  const cost =
    params.provider === 'cloud-gemini'
      ? Number((((params.tokensIn + params.tokensOut) / 1_000_000) * 0.15).toFixed(6))
      : 0;
  db.prepare(
    `INSERT INTO usage_metrics (id, workspace_id, model_id, provider, tokens_in, tokens_out, latency_ms, estimated_cost_usd)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    `usage-${crypto.randomUUID().slice(0, 8)}`,
    params.workspaceId,
    params.modelId,
    params.provider,
    params.tokensIn,
    params.tokensOut,
    Math.round(params.latencyMs),
    cost
  );
}

export async function invokeModelGateway(params: {
  workspaceId: string;
  prompt: string;
  systemInstruction?: string;
  preferredModel?: string;
  thinkingLevel?: 'LOW' | 'MEDIUM' | 'HIGH';
  imageBase64?: { mimeType: string; data: string };
  tools?: FunctionDeclaration[];
  responseMimeType?: string;
  temperature?: number;
  localFallbackHandler: () => string;
}): Promise<GatewayCallResult> {
  const start = performance.now();
  const client = getGeminiClient();
  const requestedModel = params.preferredModel || 'gemini-4-hydrogen';

  if (client && requestedModel !== 'omnix-local-core') {
    try {
      const contents = params.imageBase64
        ? {
            parts: [
              {
                inlineData: {
                  mimeType: params.imageBase64.mimeType,
                  data: params.imageBase64.data,
                },
              },
              { text: params.prompt },
            ],
          }
        : params.prompt;

      const thinkingMap: Record<string, ThinkingLevel> = {
        LOW: ThinkingLevel.LOW,
        MEDIUM: ThinkingLevel.MEDIUM,
        HIGH: ThinkingLevel.HIGH,
      };

      const response = await client.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents,
        config: {
          systemInstruction: params.systemInstruction,
          ...(params.responseMimeType ? { responseMimeType: params.responseMimeType } : {}),
          ...(typeof params.temperature === 'number' ? { temperature: params.temperature } : {}),
          thinkingConfig: {
            thinkingLevel: thinkingMap[params.thinkingLevel || 'MEDIUM'] ?? ThinkingLevel.MEDIUM,
          },
          ...(params.tools && params.tools.length > 0
            ? { tools: [{ functionDeclarations: params.tools }] }
            : {}),
        },
      });

      const latencyMs = Math.round(performance.now() - start);
      const text = response.text || '';
      const tokensIn = response.usageMetadata?.promptTokenCount ?? Math.ceil(params.prompt.length / 4);
      const tokensOut = response.usageMetadata?.candidatesTokenCount ?? Math.ceil(text.length / 4);
      const functionCalls = response.functionCalls?.map((fc) => ({
        name: fc.name || 'unknown',
        args: (fc.args || {}) as Record<string, unknown>,
      }));

      recordUsageMetric({
        workspaceId: params.workspaceId,
        modelId: 'gemini-4-hydrogen',
        provider: 'cloud-gemini',
        tokensIn,
        tokensOut,
        latencyMs,
      });

      return {
        text,
        provider: 'cloud-gemini',
        model: 'gemini-4-hydrogen',
        latencyMs,
        tokensIn,
        tokensOut,
        isFallback: false,
        functionCalls,
      };
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'Cloud Gemini request failed';
      const localText = params.localFallbackHandler();
      const latencyMs = Math.round(performance.now() - start);
      const tokensIn = Math.ceil(params.prompt.length / 4);
      const tokensOut = Math.ceil(localText.length / 4);
      recordUsageMetric({
        workspaceId: params.workspaceId,
        modelId: 'omnix-local-core',
        provider: 'local-deterministic',
        tokensIn,
        tokensOut,
        latencyMs,
      });
      return {
        text: localText,
        provider: 'local-deterministic',
        model: 'omnix-local-core',
        latencyMs,
        tokensIn,
        tokensOut,
        isFallback: true,
        fallbackReason: reason,
      };
    }
  }

  const localText = params.localFallbackHandler();
  const latencyMs = Math.round(performance.now() - start);
  const tokensIn = Math.ceil(params.prompt.length / 4);
  const tokensOut = Math.ceil(localText.length / 4);
  recordUsageMetric({
    workspaceId: params.workspaceId,
    modelId: 'omnix-local-core',
    provider: 'local-deterministic',
    tokensIn,
    tokensOut,
    latencyMs,
  });

  return {
    text: localText,
    provider: 'local-deterministic',
    model: 'omnix-local-core',
    latencyMs,
    tokensIn,
    tokensOut,
    isFallback: requestedModel !== 'omnix-local-core',
    fallbackReason:
      requestedModel !== 'omnix-local-core'
        ? 'Cloud GEMINI_API_KEY not configured in runtime secrets; executed via local deterministic hybrid engine.'
        : undefined,
  };
}
