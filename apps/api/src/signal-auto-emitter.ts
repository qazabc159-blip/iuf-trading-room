/**
 * signal-auto-emitter.ts — 3-source automatic signal cron
 *
 * Source 1 — strategy.cont_liq_v36  (daily 14:00 TST, after Taiwan market close)
 *   Fetches cont_liq_v36 snapshot from Lab GitHub, extracts top picks,
 *   emits one signal per pick. confidence mapped from Bonferroni p-value.
 *   Source tag: "strategy.cont_liq_v36"
 *
 * Source 2 — news.<window_label>  (4-window, synced with news_top10 cron)
 *   Reads the in-memory getLastNewsTop10() result.
 *   For each item with impact_tier=HIGH and a ticker in tags,
 *   calls OpenAI to confirm ticker + direction (bullish/bearish).
 *   Source tag: "news.08:00" | "news.12:00" | "news.18:00" | "news.24:00"
 *
 * Source 3 — quote.breakout  (every 30min, intraday 09:00–13:30 TST)
 *   Reads market quotes for watchlist symbols.
 *   Rule: close > 5d SMA AND volume > 5d avg volume × 2 → bullish breakout.
 *   Source tag: "quote.breakout"
 *
 * All sources:
 *   - INSERT into signals table via Drizzle
 *   - Write audit log row: action='signal.auto_emit'
 *   - Dedup guard: do NOT re-emit same symbol+source in the same calendar day (TST)
 *   - Never fake — skip if real data unavailable, log reason
 *
 * Hard lines:
 *   - No broker write / no risk-engine import / no web page edit
 *   - OpenAI calls capped: news path max 10 calls per window fire
 *   - If DATABASE_URL absent → memory-mode → skip INSERT, log only
 *   - All errors caught internally — cron must not crash server
 *
 * Lane: backend strategy (Jason). Do not modify broker / risk / migration / web.
 */

import { randomUUID } from "node:crypto";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import {
  auditLogs,
  companiesOhlcv,
  signals,
  workspaces,
  getDb,
  isDatabaseMode
} from "@iuf-trading-room/db";
import { fetchStrategySnapshot } from "./lab-strategy-snapshot-fetcher.js";
import { getLastNewsTop10 } from "./news-ai-selector.js";
import { listMarketQuotes } from "./market-data.js";

// ── Constants ──────────────────────────────────────────────────────────────────

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_MODEL = "gpt-4o-mini";
const OPENAI_TIMEOUT_MS = 15_000;
// OpenAI daily budget: max 10 calls per news window fire
const MAX_OPENAI_CALLS_PER_NEWS_FIRE = 10;

// ── Types ──────────────────────────────────────────────────────────────────────

type SignalSource =
  | "strategy.cont_liq_v36"
  | "news.08:00"
  | "news.12:00"
  | "news.18:00"
  | "news.24:00"
  | "quote.breakout";

type EmitResult = {
  emitted: number;
  skipped: number;
  errors: number;
  reason_skip?: string;
};

// ── Dedup guard (in-process, day-scoped in TST) ───────────────────────────────

/**
 * Key: "<symbol>|<source>|<YYYY-MM-DD in TST>"
 * Prevents double-emit within the same trading day for the same source.
 */
const _dedupSet = new Set<string>();

function getTstDateStr(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function dedupKey(symbol: string, source: SignalSource): string {
  return `${symbol}|${source}|${getTstDateStr()}`;
}

function isDuplicate(symbol: string, source: SignalSource): boolean {
  return _dedupSet.has(dedupKey(symbol, source));
}

function markEmitted(symbol: string, source: SignalSource): void {
  _dedupSet.add(dedupKey(symbol, source));
}

/** Reset dedup state (for tests) */
export function _resetSignalEmitterState(): void {
  _dedupSet.clear();
}

// ── Workspace resolver ────────────────────────────────────────────────────────

let _cachedWorkspaceId: string | null = null;
let _cachedWorkspaceSlug: string | null = null;

async function resolveWorkspace(): Promise<{ id: string; slug: string } | null> {
  if (_cachedWorkspaceId && _cachedWorkspaceSlug) {
    return { id: _cachedWorkspaceId, slug: _cachedWorkspaceSlug };
  }
  const db = getDb();
  if (!db) return null;
  try {
    const [ws] = await db
      .select({ id: workspaces.id, slug: workspaces.slug })
      .from(workspaces)
      .limit(1);
    if (!ws) return null;
    _cachedWorkspaceId = ws.id;
    _cachedWorkspaceSlug = ws.slug;
    return { id: ws.id, slug: ws.slug };
  } catch (e) {
    console.warn("[signal-emitter] workspace resolve failed:", e instanceof Error ? e.message : e);
    return null;
  }
}

/** Reset workspace cache (for tests) */
export function _resetWorkspaceCache(): void {
  _cachedWorkspaceId = null;
  _cachedWorkspaceSlug = null;
}

// ── Signal INSERT helper ──────────────────────────────────────────────────────

type SignalInsertParams = {
  workspaceId: string;
  symbol: string;
  direction: "bullish" | "bearish" | "neutral";
  confidence: number;  // 1–5
  title: string;
  summary: string;
  source: SignalSource;
};

async function insertSignal(params: SignalInsertParams): Promise<string | null> {
  if (!isDatabaseMode()) {
    console.info(
      `[signal-emitter] memory-mode — skip DB insert: source=${params.source} symbol=${params.symbol}`
    );
    return null;
  }
  const db = getDb();
  if (!db) return null;
  try {
    const [row] = await db
      .insert(signals)
      .values({
        workspaceId: params.workspaceId,
        category: "price",
        direction: params.direction,
        title: params.title,
        summary: params.summary,
        confidence: Math.max(1, Math.min(5, Math.round(params.confidence))),
        companyIds: []
      })
      .returning({ id: signals.id });
    return row?.id ?? null;
  } catch (e) {
    console.error(
      `[signal-emitter] INSERT failed: source=${params.source} symbol=${params.symbol}`,
      e instanceof Error ? e.message : e
    );
    return null;
  }
}

// ── Audit log helper ──────────────────────────────────────────────────────────

async function writeSignalAuditLog(params: {
  workspaceId: string;
  source: SignalSource;
  symbol: string;
  signalId: string | null;
  confidence: number;
  direction: string;
  skipped: boolean;
  skip_reason?: string;
}): Promise<void> {
  if (!isDatabaseMode()) return;
  const db = getDb();
  if (!db) return;
  try {
    await db.insert(auditLogs).values({
      workspaceId: params.workspaceId,
      actorId: null,
      action: "signal.auto_emit" as string,
      entityType: "signal",
      entityId: params.signalId ?? "skipped",
      payload: {
        source: params.source,
        symbol: params.symbol,
        direction: params.direction,
        confidence: params.confidence,
        signal_id: params.signalId,
        skipped: params.skipped,
        skip_reason: params.skip_reason ?? null
      }
    });
  } catch (e) {
    console.warn("[signal-emitter] audit log write failed:", e instanceof Error ? e.message : e);
  }
}

// ── OpenAI call helper ────────────────────────────────────────────────────────

type NewsSignalExtraction = {
  ticker: string;
  direction: "bullish" | "bearish";
  confidence_score: number;  // 0.0–1.0
  rationale: string;
};

async function extractNewsSignalViaOpenAI(
  headline: string,
  why_matters: string | null,
  tags: string[]
): Promise<NewsSignalExtraction | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  // Extract ticker candidate from tags (e.g. "2330", "TSMC")
  const tickerCandidate = tags.find((t) => /^\d{4}$/.test(t) || /^[A-Z]{2,6}$/.test(t)) ?? null;
  if (!tickerCandidate) return null;

  const prompt = `You are a Taiwan equity signal extractor. Given a news headline and context, determine:
1. The primary ticker symbol affected (must be a real stock, not a concept)
2. Whether the impact is bullish or bearish for that stock
3. A confidence score from 0.0 to 1.0
4. One sentence rationale

Headline: "${headline.slice(0, 200)}"
Why it matters: "${(why_matters ?? "").slice(0, 200)}"
Tags: ${tags.join(", ")}

Reply ONLY with valid JSON matching this schema exactly:
{"ticker":"<4-digit TW ticker or US ticker>","direction":"bullish"|"bearish","confidence_score":<0.0-1.0>,"rationale":"<one sentence>"}

If you cannot determine a clear ticker or direction, reply: {"ticker":null,"direction":null,"confidence_score":0,"rationale":"unclear"}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);
  try {
    const res = await fetch(OPENAI_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 200,
        temperature: 0.1
      }),
      signal: controller.signal
    });
    if (!res.ok) {
      console.warn(`[signal-emitter] OpenAI HTTP ${res.status} for news signal extraction`);
      return null;
    }
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = json.choices?.[0]?.message?.content ?? "";
    const parsed = JSON.parse(text.trim()) as NewsSignalExtraction & { ticker: string | null; direction: string | null };
    if (!parsed.ticker || !parsed.direction || parsed.confidence_score < 0.5) return null;
    if (parsed.direction !== "bullish" && parsed.direction !== "bearish") return null;
    return {
      ticker: parsed.ticker,
      direction: parsed.direction as "bullish" | "bearish",
      confidence_score: parsed.confidence_score,
      rationale: parsed.rationale ?? ""
    };
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      console.warn("[signal-emitter] OpenAI timeout for news signal extraction");
    } else {
      console.warn("[signal-emitter] OpenAI error:", e instanceof Error ? e.message : e);
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ── Source 1: strategy.cont_liq_v36 ──────────────────────────────────────────

/**
 * Runs at 14:00 TST daily (after Taiwan market close).
 * Fetches cont_liq_v36 Lab snapshot, extracts top_picks array.
 * Each pick → emit bullish signal.
 */
export async function runStrategySignalEmitterTick(): Promise<EmitResult> {
  const result: EmitResult = { emitted: 0, skipped: 0, errors: 0 };

  const ws = await resolveWorkspace();
  if (!ws) {
    result.skipped++;
    result.reason_skip = "no_workspace";
    return result;
  }

  // Fetch cont_liq_v36 snapshot (uses ETag cache + circuit breaker from lab-snapshot-fetcher)
  let snapshotResult: Awaited<ReturnType<typeof fetchStrategySnapshot>>;
  try {
    snapshotResult = await fetchStrategySnapshot("cont_liq_v36", {
      workspaceId: ws.id,
      actorId: null
    });
  } catch (e) {
    console.error("[signal-emitter/strategy] fetchStrategySnapshot threw:", e instanceof Error ? e.message : e);
    result.errors++;
    return result;
  }

  if (!snapshotResult.ok || !snapshotResult.snapshot) {
    console.info(
      `[signal-emitter/strategy] snapshot unavailable: ${snapshotResult.stale_reason}`
    );
    result.skipped++;
    result.reason_skip = snapshotResult.stale_reason ?? "snapshot_unavailable";
    return result;
  }

  const snapshot = snapshotResult.snapshot;

  // Extract top picks — the Lab snapshot schema has top_picks or top_4 or picks
  // We try multiple field paths to be robust to Lab schema evolution.
  type PickItem = {
    symbol?: string;
    ticker?: string;
    stock_id?: string;
    bonferroni_p?: number;
    p_value?: number;
    confidence?: number;
    side?: string;
    direction?: string;
  };

  const rawPicks: unknown[] =
    (Array.isArray(snapshot["top_picks"]) ? (snapshot["top_picks"] as unknown[]) : null) ??
    (Array.isArray(snapshot["top_4"]) ? (snapshot["top_4"] as unknown[]) : null) ??
    (Array.isArray(snapshot["picks"]) ? (snapshot["picks"] as unknown[]) : null) ??
    [];

  if (rawPicks.length === 0) {
    console.info("[signal-emitter/strategy] snapshot has no top_picks/top_4/picks array");
    result.skipped++;
    result.reason_skip = "no_picks_in_snapshot";
    return result;
  }

  const source: SignalSource = "strategy.cont_liq_v36";

  for (const raw of rawPicks.slice(0, 4)) {
    const pick = raw as PickItem;
    const symbol =
      (pick.symbol ?? pick.ticker ?? pick.stock_id ?? "").toString().trim().toUpperCase();
    if (!symbol) {
      result.skipped++;
      continue;
    }

    if (isDuplicate(symbol, source)) {
      result.skipped++;
      continue;
    }

    // Map Bonferroni p-value to confidence 1–5
    // p < 0.001 → 5, p < 0.01 → 4, p < 0.05 → 3, p < 0.1 → 2, else → 1
    const p = pick.bonferroni_p ?? pick.p_value ?? null;
    let confidence: number;
    if (p === null) {
      confidence = pick.confidence != null ? Math.max(1, Math.min(5, Number(pick.confidence))) : 3;
    } else {
      const pNum = Number(p);
      if (pNum < 0.001) confidence = 5;
      else if (pNum < 0.01) confidence = 4;
      else if (pNum < 0.05) confidence = 3;
      else if (pNum < 0.1) confidence = 2;
      else confidence = 1;
    }

    // Direction from snapshot (default bullish — cont_liq is a long strategy)
    const snapshotSide = (pick.side ?? pick.direction ?? "BUY").toString().toUpperCase();
    const direction: "bullish" | "bearish" = snapshotSide === "SELL" ? "bearish" : "bullish";

    const pStr = p !== null ? `p=${Number(p).toFixed(4)}` : "p=N/A";
    const title = `[Strategy] ${symbol} — cont_liq_v36 pick (${pStr})`;
    const summary =
      `Auto-emitted by cont_liq_v36 Lab strategy (L9 PASS). ` +
      `Bonferroni p: ${pStr}. Confidence: ${confidence}/5. Source: strategy.cont_liq_v36.`;

    const signalId = await insertSignal({
      workspaceId: ws.id,
      symbol,
      direction,
      confidence,
      title,
      summary,
      source
    });

    void writeSignalAuditLog({
      workspaceId: ws.id,
      source,
      symbol,
      signalId,
      confidence,
      direction,
      skipped: false
    });

    markEmitted(symbol, source);
    result.emitted++;
    console.info(
      `[signal-emitter/strategy] emitted: symbol=${symbol} direction=${direction} confidence=${confidence} id=${signalId}`
    );
  }

  return result;
}

// ── Intraday TST window helpers ───────────────────────────────────────────────

function getTstHourMinute(): { hour: number; minute: number } {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Taipei",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(now).split(":");
  return { hour: parseInt(parts[0] ?? "0", 10), minute: parseInt(parts[1] ?? "0", 10) };
}

/** Returns true between 09:00–13:30 TST (Taiwan intraday window) */
export function isIntradayWindow(): boolean {
  const { hour, minute } = getTstHourMinute();
  if (hour < 9 || hour > 13) return false;
  if (hour === 13 && minute > 30) return false;
  return true;
}

/** Returns true between 13:45–14:30 TST (post-close strategy window) */
export function isStrategyEmitWindow(): boolean {
  const { hour, minute } = getTstHourMinute();
  if (hour === 13 && minute >= 45) return true;
  if (hour === 14 && minute <= 30) return true;
  return false;
}

// ── Source 2: news-driven signal ──────────────────────────────────────────────

/**
 * Runs in sync with news_top10 cron windows (08:00/12:00/18:00/24:00 TST).
 * Called with the current window_label to derive the source tag.
 */
export async function runNewsSignalEmitterTick(windowLabel: "08:00" | "12:00" | "18:00" | "24:00"): Promise<EmitResult> {
  const result: EmitResult = { emitted: 0, skipped: 0, errors: 0 };
  const source: SignalSource = `news.${windowLabel}`;

  const ws = await resolveWorkspace();
  if (!ws) {
    result.skipped++;
    result.reason_skip = "no_workspace";
    return result;
  }

  const newsResult = getLastNewsTop10();
  if (!newsResult) {
    result.skipped++;
    result.reason_skip = "news_top10_never_run";
    console.info("[signal-emitter/news] news_top10 never run — skipping");
    return result;
  }

  // Only process HIGH impact items that have a ticker tag
  const highImpactItems = newsResult.items.filter(
    (item) =>
      item.impact_tier === "HIGH" &&
      item.tags.some((t) => /^\d{4}$/.test(t) || /^[A-Z]{2,6}$/.test(t))
  );

  if (highImpactItems.length === 0) {
    result.skipped++;
    result.reason_skip = "no_high_impact_news_with_ticker";
    console.info("[signal-emitter/news] no HIGH impact news with ticker tag — skipping");
    return result;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  let openaiCallsUsed = 0;

  for (const item of highImpactItems.slice(0, MAX_OPENAI_CALLS_PER_NEWS_FIRE)) {
    // Extract ticker from tags
    const tickerFromTag =
      item.ticker ??
      item.tags.find((t) => /^\d{4}$/.test(t) || /^[A-Z]{2,6}$/.test(t)) ??
      null;

    if (!tickerFromTag) {
      result.skipped++;
      continue;
    }

    const symbol = tickerFromTag.toUpperCase();

    if (isDuplicate(symbol, source)) {
      result.skipped++;
      continue;
    }

    let direction: "bullish" | "bearish" | "neutral" = "neutral";
    let confidence = 3;
    let evidenceNote = item.url ?? item.headline.slice(0, 80);

    if (apiKey && openaiCallsUsed < MAX_OPENAI_CALLS_PER_NEWS_FIRE) {
      const extraction = await extractNewsSignalViaOpenAI(
        item.headline,
        item.why_matters,
        item.tags
      );
      openaiCallsUsed++;

      if (extraction) {
        direction = extraction.direction;
        // Map 0.0–1.0 score to 1–5
        confidence = Math.max(1, Math.min(5, Math.round(extraction.confidence_score * 4 + 1)));
        evidenceNote = extraction.rationale;
      } else {
        // OpenAI couldn't determine — skip (hard rule: no fake signals)
        result.skipped++;
        void writeSignalAuditLog({
          workspaceId: ws.id,
          source,
          symbol,
          signalId: null,
          confidence: 0,
          direction: "neutral",
          skipped: true,
          skip_reason: "openai_extraction_failed"
        });
        continue;
      }
    } else if (!apiKey) {
      // No OpenAI key — skip news signals (cannot determine direction without AI)
      result.skipped++;
      result.reason_skip = "openai_api_key_absent";
      continue;
    }

    if (direction === "neutral") {
      result.skipped++;
      continue;
    }

    const title = `[News] ${symbol} — ${item.headline.slice(0, 80)}`;
    const summary =
      `Auto-emitted from news AI selection (window ${windowLabel}). ` +
      `Impact: HIGH. ${evidenceNote.slice(0, 200)}`;

    const signalId = await insertSignal({
      workspaceId: ws.id,
      symbol,
      direction,
      confidence,
      title,
      summary,
      source
    });

    void writeSignalAuditLog({
      workspaceId: ws.id,
      source,
      symbol,
      signalId,
      confidence,
      direction,
      skipped: false
    });

    markEmitted(symbol, source);
    result.emitted++;
    console.info(
      `[signal-emitter/news] emitted: symbol=${symbol} direction=${direction} confidence=${confidence} window=${windowLabel} id=${signalId}`
    );
  }

  return result;
}

// ── Source 3: quote.breakout ──────────────────────────────────────────────────

/**
 * Simple 5d MA + volume breakout detector.
 * Uses OHLCV table from DB (or mock fallback from schema).
 *
 * Rule: close > 5d SMA(close) AND volume > 5d avg(volume) × 2 → bullish breakout.
 *
 * @param workspaceId
 * @param symbols - array of ticker strings (e.g. ["2330","2317"])
 */
async function computeBreakouts(
  workspaceId: string,
  symbols: string[]
): Promise<Array<{ symbol: string; close: number; sma5: number; vol: number; avgVol5: number }>> {
  if (!isDatabaseMode()) return [];
  const db = getDb();
  if (!db) return [];

  const results: Array<{ symbol: string; close: number; sma5: number; vol: number; avgVol5: number }> = [];

  // Query last 6 daily bars per symbol (need 5 for MA + today)
  // We join companies to resolve ticker → company_id
  const sixDaysAgo = new Date();
  sixDaysAgo.setUTCDate(sixDaysAgo.getUTCDate() - 10); // 10 calendar days covers ~6 trading days
  const sixDaysAgoStr = sixDaysAgo.toISOString().slice(0, 10);

  try {
    // Raw SQL approach — join companies on ticker to get company_id
    const query = await db.execute(
      sql`
        SELECT c.ticker, o.dt, CAST(o.close AS float) as close, o.volume
        FROM companies_ohlcv o
        JOIN companies c ON c.id = o.company_id AND c.workspace_id = ${workspaceId}
        WHERE c.workspace_id = ${workspaceId}
          AND o.workspace_id = ${workspaceId}
          AND o.interval = '1d'
          AND o.source != 'mock'
          AND o.dt >= ${sixDaysAgoStr}
          AND c.ticker = ANY(${symbols})
        ORDER BY c.ticker, o.dt DESC
      `
    );

    const rows = (query as { rows?: unknown[] }).rows ?? (Array.isArray(query) ? query : []);

    // Group by ticker
    const byTicker = new Map<string, Array<{ dt: string; close: number; volume: number }>>();
    for (const row of rows) {
      const r = row as { ticker: string; dt: string; close: number; volume: number | string };
      const ticker = String(r.ticker ?? "").toUpperCase();
      if (!ticker) continue;
      if (!byTicker.has(ticker)) byTicker.set(ticker, []);
      byTicker.get(ticker)!.push({
        dt: String(r.dt),
        close: typeof r.close === "string" ? parseFloat(r.close) : Number(r.close),
        volume: typeof r.volume === "string" ? parseInt(r.volume, 10) : Number(r.volume)
      });
    }

    for (const [ticker, bars] of byTicker) {
      if (bars.length < 2) continue; // need at least 2 bars
      // bars are sorted desc (newest first)
      const today = bars[0];
      if (!today) continue;
      const prev = bars.slice(1, 6); // up to 5 prior bars
      if (prev.length < 1) continue;

      const sma5 = (today.close + prev.reduce((acc, b) => acc + b.close, 0)) / (prev.length + 1);
      const avgVol5 = (today.volume + prev.reduce((acc, b) => acc + b.volume, 0)) / (prev.length + 1);

      results.push({
        symbol: ticker,
        close: today.close,
        sma5,
        vol: today.volume,
        avgVol5
      });
    }
  } catch (e) {
    console.warn(
      "[signal-emitter/quote] breakout DB query failed:",
      e instanceof Error ? e.message : e
    );
  }

  return results;
}

/**
 * Runs every 30min during intraday (09:00–13:30 TST).
 * Reads market quotes for available symbols, computes breakout signals.
 */
export async function runQuoteBreakoutEmitterTick(): Promise<EmitResult> {
  const result: EmitResult = { emitted: 0, skipped: 0, errors: 0 };

  if (!isIntradayWindow()) {
    result.skipped++;
    result.reason_skip = "outside_intraday_window";
    return result;
  }

  const ws = await resolveWorkspace();
  if (!ws) {
    result.skipped++;
    result.reason_skip = "no_workspace";
    return result;
  }

  // Get all available market quotes to discover watchlist symbols
  let quoteSymbols: string[] = [];
  try {
    const fakeSession = {
      workspace: { id: ws.id, slug: ws.slug },
      user: { id: "system-cron", role: "Owner" as const }
    };
    const quotes = await listMarketQuotes({
      session: fakeSession as Parameters<typeof listMarketQuotes>[0]["session"],
      includeStale: false,
      limit: 50
    });
    quoteSymbols = [...new Set(quotes.map((q) => q.symbol.toUpperCase()))];
  } catch (e) {
    console.warn(
      "[signal-emitter/quote] listMarketQuotes failed:",
      e instanceof Error ? e.message : e
    );
  }

  if (quoteSymbols.length === 0) {
    result.skipped++;
    result.reason_skip = "no_fresh_quotes";
    console.info("[signal-emitter/quote] no fresh market quotes — skipping");
    return result;
  }

  // Compute breakouts
  const breakouts = await computeBreakouts(ws.id, quoteSymbols);
  if (breakouts.length === 0) {
    result.skipped++;
    result.reason_skip = "no_real_ohlcv_bars";
    console.info("[signal-emitter/quote] no real OHLCV bars in DB — skipping (not faking)");
    return result;
  }

  const source: SignalSource = "quote.breakout";

  for (const { symbol, close, sma5, vol, avgVol5 } of breakouts) {
    // Breakout rule: price > 5d SMA AND volume > 5d avg × 2
    const priceBreakout = close > sma5;
    const volumeBreakout = avgVol5 > 0 && vol > avgVol5 * 2;

    if (!priceBreakout || !volumeBreakout) {
      result.skipped++;
      continue;
    }

    if (isDuplicate(symbol, source)) {
      result.skipped++;
      continue;
    }

    const pctAboveSma = sma5 > 0 ? (((close - sma5) / sma5) * 100).toFixed(1) : "N/A";
    const volRatio = avgVol5 > 0 ? (vol / avgVol5).toFixed(1) : "N/A";

    const title = `[Quote] ${symbol} — price breakout +${pctAboveSma}% above 5d SMA, vol ${volRatio}x`;
    const summary =
      `Auto-emitted: ${symbol} close=${close.toFixed(2)} SMA5=${sma5.toFixed(2)} (+${pctAboveSma}%). ` +
      `Volume ${volRatio}x above 5d average. Source: quote.breakout.`;

    // Confidence: both conditions met → 3; volume extreme (>3×) → 4
    const confidence = vol > avgVol5 * 3 ? 4 : 3;

    const signalId = await insertSignal({
      workspaceId: ws.id,
      symbol,
      direction: "bullish",
      confidence,
      title,
      summary,
      source
    });

    void writeSignalAuditLog({
      workspaceId: ws.id,
      source,
      symbol,
      signalId,
      confidence,
      direction: "bullish",
      skipped: false
    });

    markEmitted(symbol, source);
    result.emitted++;
    console.info(
      `[signal-emitter/quote] breakout: symbol=${symbol} close=${close} sma5=${sma5.toFixed(2)} vol=${vol} avgVol5=${Math.round(avgVol5)} id=${signalId}`
    );
  }

  return result;
}

// ── Boot state summary ────────────────────────────────────────────────────────

export function getSignalEmitterStatus(): {
  dedup_set_size: number;
  workspace_cached: boolean;
} {
  return {
    dedup_set_size: _dedupSet.size,
    workspace_cached: !!_cachedWorkspaceId
  };
}
