import crypto from 'node:crypto';
import { getDb } from '../db/schema.ts';
import { invokeModelGateway } from './modelGateway.ts';

export interface RadarSignalItem {
  id: string;
  category: string;
  title: string;
  summary: string;
  source_name: string;
  source_url: string;
  published_at: string;
  collected_at: string;
  signal_kind: 'fact' | 'trend' | 'opportunity' | 'competitor_update';
  confidence: number;
  tags: string[];
}

async function fetchJsonWithTimeout(url: string, timeoutMs = 4500): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'OMNIX-Radar-Monitor/1.0' },
      signal: controller.signal,
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function collectLivePublicSignals(params: {
  workspaceId: string;
  query?: string;
}): Promise<{
  collectedCount: number;
  sourcesChecked: Array<{ source: string; status: 'live' | 'unreachable'; detail: string }>;
  signals: RadarSignalItem[];
}> {
  const db = getDb();
  const q = (params.query || 'artificial intelligence').trim();
  const collected: RadarSignalItem[] = [];
  const sourcesChecked: Array<{ source: string; status: 'live' | 'unreachable'; detail: string }> = [];

  // 1. HackerNews Algolia Public Search API
  try {
    const hnData = (await fetchJsonWithTimeout(
      `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(q)}&tags=story&hitsPerPage=5`
    )) as { hits?: Array<{ objectID: string; title: string; url?: string; created_at: string; points?: number }> };
    const hits = hnData.hits || [];
    for (const h of hits) {
      if (!h.title) continue;
      collected.push({
        id: `sig-hn-${h.objectID}`,
        category: 'Tech & Engineering',
        title: h.title,
        summary: `HackerNews discussion (${h.points ?? 0} points) matching "${q}".`,
        source_name: 'HackerNews Public API',
        source_url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
        published_at: h.created_at || new Date().toISOString(),
        collected_at: new Date().toISOString(),
        signal_kind: (h.points ?? 0) > 120 ? 'trend' : 'fact',
        confidence: 0.9,
        tags: ['hackernews', q.toLowerCase()],
      });
    }
    sourcesChecked.push({ source: 'HackerNews Algolia API', status: 'live', detail: `${hits.length} item(s) collected.` });
  } catch (err) {
    sourcesChecked.push({
      source: 'HackerNews Algolia API',
      status: 'unreachable',
      detail: err instanceof Error ? err.message : 'Network unavailable',
    });
  }

  // 2. GitHub Public Repositories API (unauthenticated public search)
  try {
    const ghData = (await fetchJsonWithTimeout(
      `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=4`
    )) as {
      items?: Array<{
        id: number;
        full_name: string;
        description: string | null;
        html_url: string;
        stargazers_count: number;
        updated_at: string;
        language: string | null;
      }>;
    };
    const items = ghData.items || [];
    for (const repo of items) {
      collected.push({
        id: `sig-gh-${repo.id}`,
        category: 'Open Source',
        title: `${repo.full_name} (${repo.stargazers_count.toLocaleString()} ★)`,
        summary: repo.description || `Active ${repo.language || 'software'} repository.`,
        source_name: 'GitHub Public API',
        source_url: repo.html_url,
        published_at: repo.updated_at || new Date().toISOString(),
        collected_at: new Date().toISOString(),
        signal_kind: 'opportunity',
        confidence: 0.94,
        tags: ['github', (repo.language || 'oss').toLowerCase()],
      });
    }
    sourcesChecked.push({ source: 'GitHub Public API', status: 'live', detail: `${items.length} repository signal(s).` });
  } catch (err) {
    sourcesChecked.push({
      source: 'GitHub Public API',
      status: 'unreachable',
      detail: err instanceof Error ? err.message : 'Network unavailable',
    });
  }

  // 3. Wikipedia Public REST Summary API for factual baseline on query topic
  try {
    const topicSlug = encodeURIComponent(q.replace(/\s+/g, '_'));
    const wiki = (await fetchJsonWithTimeout(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${topicSlug}`
    )) as { title?: string; extract?: string; content_urls?: { desktop?: { page?: string } }; timestamp?: string };
    if (wiki.title && wiki.extract) {
      collected.push({
        id: `sig-wiki-${crypto.createHash('sha1').update(wiki.title).digest('hex').slice(0, 8)}`,
        category: 'Research & Reference',
        title: wiki.title,
        summary: wiki.extract.slice(0, 260),
        source_name: 'Wikipedia REST API',
        source_url: wiki.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${topicSlug}`,
        published_at: wiki.timestamp || new Date().toISOString(),
        collected_at: new Date().toISOString(),
        signal_kind: 'fact',
        confidence: 0.92,
        tags: ['reference', q.toLowerCase()],
      });
    }
    sourcesChecked.push({ source: 'Wikipedia REST API', status: 'live', detail: 'Reference baseline retrieved.' });
  } catch (err) {
    sourcesChecked.push({
      source: 'Wikipedia REST API',
      status: 'unreachable',
      detail: err instanceof Error ? err.message : 'No matching page or network unreachable',
    });
  }

  const upsert = db.prepare(
    `INSERT INTO radar_signals (id, workspace_id, category, title, summary, source_name, source_url, published_at, collected_at, signal_kind, confidence, tags_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET collected_at = excluded.collected_at, summary = excluded.summary`
  );
  for (const s of collected) {
    upsert.run(
      s.id,
      params.workspaceId,
      s.category,
      s.title,
      s.summary,
      s.source_name,
      s.source_url,
      s.published_at,
      s.collected_at,
      s.signal_kind,
      s.confidence,
      JSON.stringify(s.tags)
    );
  }

  return {
    collectedCount: collected.length,
    sourcesChecked,
    signals: collected,
  };
}

export async function generateRadarBriefingReport(params: {
  workspaceId: string;
  userId: string;
  topic: string;
}): Promise<{
  reportId: string;
  title: string;
  facts: Array<{ statement: string; sourceUrl: string; publishedAt: string }>;
  analysis: string;
  predictions: Array<{ statement: string; confidencePct: number; basis: string }>;
}> {
  const db = getDb();
  const signals = db
    .prepare(`SELECT * FROM radar_signals WHERE workspace_id = ? ORDER BY collected_at DESC LIMIT 15`)
    .all(params.workspaceId) as Array<{
    title: string;
    summary: string;
    source_name: string;
    source_url: string;
    published_at: string;
    signal_kind: string;
    confidence: number;
  }>;

  const facts = signals.slice(0, 6).map((s) => ({
    statement: `[${s.source_name}] ${s.title} — ${s.summary}`,
    sourceUrl: s.source_url,
    publishedAt: s.published_at,
  }));

  const gw = await invokeModelGateway({
    workspaceId: params.workspaceId,
    prompt: `Analyze these verified radar signals around "${params.topic}" and separate verifiable analysis from forward-looking predictions:\n${facts
      .map((f) => `- ${f.statement}`)
      .join('\n')}`,
    systemInstruction:
      'You are OMNI RADAR Intelligence Analyst. Clearly distinguish verified Facts, analytical synthesis, and uncertain Predictions.',
    localFallbackHandler: () =>
      facts.length > 0
        ? `Synthesized ${facts.length} collected signal(s) on "${params.topic}". Dominant activity centers around ${signals[0].signal_kind} via ${signals[0].source_name}.`
        : `No live external signals collected yet for "${params.topic}". Add a monitor or run live feed discovery first.`,
  });

  const predictions = [
    {
      statement:
        signals.length >= 3
          ? `Sustained developer momentum around "${params.topic}" based on ${signals.length} active repositories/threads.`
          : `Insufficient signal density (${signals.length} items) for high-confidence trend extrapolation on "${params.topic}".`,
      confidencePct: signals.length >= 5 ? 74 : 42,
      basis: 'Signal frequency & cross-source clustering',
    },
  ];

  const reportId = `rdr-${crypto.randomUUID().slice(0, 8)}`;
  const title = `Radar Briefing: ${params.topic}`;
  db.prepare(
    `INSERT INTO radar_reports (id, workspace_id, user_id, title, facts_json, analysis, predictions_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(reportId, params.workspaceId, params.userId, title, JSON.stringify(facts), gw.text, JSON.stringify(predictions));

  return { reportId, title, facts, analysis: gw.text, predictions };
}
