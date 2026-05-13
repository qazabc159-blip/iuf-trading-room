/**
 * news-ai-selector.ts — 4-window AI-selected top-10 market news cron
 *
 * Purpose:
 *   Every day at 08:00 / 12:00 / 18:00 / 24:00 TST, pull all raw news rows from
 *   the past 6 hours (tw_announcements + tw_stock_news) and ask gpt-4o-mini to
 *   pick the 10 most representative, impactful, non-redundant items for a Taiwan
 *   equity trader.
 *
 * Fallback:
 *   If OpenAI is unavailable, unanswered, or returns a bad response, fall back to
 *   deterministic score-ranked top-10 (newest + most specific title wins).
 *
 * State:
 *   Stored in-memory only — last selection result + when it runs next.
 *   No new DB table required — compatible with existing tw_announcements /
 *   tw_stock_news tables (both in DRAFT migration 0024, safely skipped if missing).
 *
 * Audit:
 *   On every fire, writes one row to audit_logs with action='news.ai_selection'.
 *   Payload contains: run_id, window_label, selected_count, selection_mode
 *   ('ai' | 'fallback'), input_row_count.
 *
 * Token budget:
 *   Each prompt is capped at 200 input news rows. Each row is truncated to 120
 *   chars of headline. This keeps prompt < 8k tokens comfortably.
 *
 * Hard lines:
 *   - NEVER fake news rows
 *   - NEVER call OpenAI when OPENAI_API_KEY is absent — go straight to fallback
 *   - NEVER throw — all paths emit structured state
 *   - 4xx on stale gate: if last_run > 6h, surface STALE with real reason
 *   - stale_reason propagated to endpoint response
 */

import { randomUUID } from "node:crypto";
import { getDb, isDatabaseMode, auditLogs } from "@iuf-trading-room/db";
import { sql as drizzleSql } from "drizzle-orm";

// ── Constants ─────────────────────────────────────────────────────────────────

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_MODEL_NEWS = "gpt-4o-mini";
const MAX_INPUT_ROWS = 200;
const MAX_TOKENS_RESPONSE = 2000;
const CALL_TIMEOUT_MS = 20_000;
// A "window" is 6h wide (covers the gap between any two consecutive 4-window fires).
const WINDOW_HOURS = 6;
// How many top-10 items to return
const TOP_N = 10;
// Consider selection stale if last run was > 7h ago (1h grace on 6h window)
const STALE_AFTER_MS = 7 * 60 * 60 * 1000;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface NewsAiItem {
  /** Stable ID — matches source row id when available, otherwise synthetic */
  id: string;
  /** Headline text */
  headline: string;
  /** ISO date string of the news item (YYYY-MM-DD or full ISO) */
  date: string;
  /** Stock ticker if known (e.g. "2330"), otherwise undefined */
  ticker?: string;
  /** Company name if known */
  companyName?: string;
  /** Source table / system */
  source: "twse_announcements" | "finmind_stock_news" | "mixed";
  /** Original URL if available */
  url?: string;
  // ── AI-enriched fields (null when selection_mode='fallback') ──
  /** One sentence from AI explaining why this matters to a TW trader */
  why_matters: string | null;
  /** AI-assigned impact tier */
  impact_tier: "HIGH" | "MID" | "LOW" | null;
  /** AI-assigned tags (sector, theme, etc.) */
  tags: string[];
  /** Rank within the AI selection (1 = most important) */
  rank: number;
}

export type SelectionMode = "ai" | "fallback";

export interface NewsTop10Result {
  /** Unique run identifier */
  run_id: string;
  /** ISO timestamp of when this selection was made */
  as_of: string;
  /** ISO timestamp of the next scheduled refresh */
  next_refresh_at: string;
  /** The 4-window label that triggered this run */
  window_label: "08:00" | "12:00" | "18:00" | "24:00";
  /** How the selection was made */
  selection_mode: SelectionMode;
  /** Selected items, ranked highest-impact first */
  items: NewsAiItem[];
  /** How many raw rows were fed to the selector */
  input_row_count: number;
  /** Whether OpenAI was called successfully */
  ai_call_success: boolean;
  /** Non-null when result is stale */
  stale_reason: string | null;
}

// ── In-memory state ───────────────────────────────────────────────────────────

let _lastResult: NewsTop10Result | null = null;
let _lastRunAt: Date | null = null;

/** Export for tests — reset in-memory state */
export function _resetNewsAiSelectorState(): void {
  _lastResult = null;
  _lastRunAt = null;
}

/** Returns the in-memory last result, or null if never run */
export function getLastNewsTop10(): NewsTop10Result | null {
  return _lastResult;
}

/** Returns the Date of last run, or null */
export function getLastNewsRunAt(): Date | null {
  return _lastRunAt;
}

// ── TST window logic ──────────────────────────────────────────────────────────

type WindowLabel = "08:00" | "12:00" | "18:00" | "24:00";

const WINDOW_HOURS_TST: Record<WindowLabel, number> = {
  "08:00": 8,
  "12:00": 12,
  "18:00": 18,
  "24:00": 0  // midnight = hour 0 of the next day
};

function getTaipeiHour(): number {
  const now = new Date();
  const formatted = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    hour: "2-digit",
    hour12: false
  }).format(now);
  return parseInt(formatted, 10);
}

/**
 * Returns the nearest "target" window label for the current TST hour.
 * - 06:00–10:00 → "08:00"
 * - 10:00–14:00 → "12:00"
 * - 14:00–20:00 → "18:00"
 * - 20:00–06:00 → "24:00"
 */
function getCurrentWindowLabel(): WindowLabel {
  const h = getTaipeiHour();
  if (h >= 6 && h < 10) return "08:00";
  if (h >= 10 && h < 14) return "12:00";
  if (h >= 14 && h < 20) return "18:00";
  return "24:00";
}

/**
 * Returns whether now is within ±30min of a window trigger point.
 * Trigger points: 08:00, 12:00, 18:00, 24:00 TST.
 */
export function isWithinNewsWindowTrigger(): boolean {
  const h = getTaipeiHour();
  const now = new Date();
  const mins = now.getUTCMinutes(); // approx; using hour boundaries is fine

  // Allow ±30min around each trigger hour.
  // 08:00 window: h=7 (last 30min) or h=8 (first 30min)
  // 12:00 window: h=11 or h=12
  // 18:00 window: h=17 or h=18
  // 24:00 window: h=23 or h=0
  const triggerHours = new Set([7, 8, 11, 12, 17, 18, 23, 0]);
  if (!triggerHours.has(h)) return false;

  // Avoid double-fire: if already ran in last 45min, skip
  if (_lastRunAt) {
    const elapsedMs = Date.now() - _lastRunAt.getTime();
    if (elapsedMs < 45 * 60 * 1000) return false;
  }
  void mins; // suppress unused-var lint
  return true;
}

/**
 * Compute the ISO timestamp of the next scheduled window refresh from now.
 * Advance TST to the next trigger hour (08, 12, 18, 00) after current.
 */
export function computeNextRefreshAt(): string {
  const now = new Date();
  // Get current TST hour
  const tst = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(now);
  const [hStr] = tst.split(":");
  const h = parseInt(hStr ?? "0", 10);

  const triggerHours = [8, 12, 18, 24]; // 24 = midnight next day
  const nextH = triggerHours.find((t) => t > h) ?? 8; // wrap to next-day 08:00

  // Build a Date for next trigger in TST
  const next = new Date(now);
  // Calculate TST offset: UTC+8 means TST = UTC+8
  // Compute UTC time for next TST trigger
  const nowTstHour = h;
  let hoursToAdd = nextH - nowTstHour;
  if (hoursToAdd <= 0) hoursToAdd += 24;
  next.setTime(now.getTime() + hoursToAdd * 60 * 60 * 1000);
  next.setUTCMinutes(0, 0, 0);
  return next.toISOString();
}

// ── Raw news row fetch ────────────────────────────────────────────────────────

interface RawNewsRow {
  id: string | null;
  ticker: string | null;
  company_name: string | null;
  date: string | null;
  title: string | null;
  url: string | null;
  source: "twse_announcements" | "finmind_stock_news";
}

function readRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  return ((result as { rows?: T[] })?.rows) ?? [];
}

/**
 * Pull news rows from the past `windowHours` hours.
 * Pulls from tw_announcements + tw_stock_news (both may be absent if 0024 not promoted).
 * Non-fatal: missing tables → returns empty array.
 */
async function fetchRawNewsRows(windowHours: number): Promise<RawNewsRow[]> {
  if (!isDatabaseMode()) return [];
  const db = getDb();
  if (!db) return [];

  const rows: RawNewsRow[] = [];
  const sinceTs = new Date(Date.now() - windowHours * 60 * 60 * 1000).toISOString();

  // tw_announcements (TWSE public disclosures)
  try {
    const result = await db.execute(drizzleSql`
      SELECT
        a.id::text AS id,
        a.ticker_symbol AS ticker,
        c.name AS company_name,
        a.announced_at::text AS date,
        a.title AS title,
        COALESCE(
          a.source_url,
          CASE
            WHEN a.ticker_symbol IS NOT NULL AND a.ticker_symbol <> ''
            THEN 'https://mops.twse.com.tw/mops/web/t05st02_sii?TYPEK=sii&code=' || a.ticker_symbol
            ELSE NULL
          END
        ) AS url,
        'twse_announcements' AS source
      FROM tw_announcements a
      LEFT JOIN companies c ON c.ticker = a.ticker_symbol
      WHERE a.announced_at >= ${sinceTs}::timestamptz
      ORDER BY a.announced_at DESC
      LIMIT ${MAX_INPUT_ROWS}
    `);
    rows.push(...readRows<RawNewsRow>(result));
  } catch {
    // tw_announcements absent or query failed — non-fatal, continue
  }

  // tw_stock_news (FinMind)
  if (rows.length < MAX_INPUT_ROWS) {
    try {
      const remaining = MAX_INPUT_ROWS - rows.length;
      const result = await db.execute(drizzleSql`
        SELECT
          n.id::text AS id,
          n.stock_id AS ticker,
          c.name AS company_name,
          COALESCE(n.published_at, n.fetched_at::text) AS date,
          n.title AS title,
          n.url AS url,
          'finmind_stock_news' AS source
        FROM tw_stock_news n
        LEFT JOIN companies c ON c.ticker = n.stock_id
        WHERE n.fetched_at >= ${sinceTs}::timestamptz
        ORDER BY n.fetched_at DESC
        LIMIT ${remaining}
      `);
      rows.push(...readRows<RawNewsRow>(result));
    } catch {
      // tw_stock_news absent — non-fatal
    }
  }

  return rows;
}

// ── Deterministic fallback ranker ─────────────────────────────────────────────

/**
 * Score-based fallback when AI is unavailable.
 * Score heuristics (additive):
 *   +3 if source is twse_announcements (official disclosure > news article)
 *   +2 if title contains 重大 / 公告 / 召開 / 董事會 / 盈餘 / 停牌
 *   +1 for recency (most recent row in window gets +1, decrements by index)
 */
function deterministicTop10(rows: RawNewsRow[]): NewsAiItem[] {
  const keywords = ["重大", "公告", "召開", "董事會", "盈餘", "停牌", "減資", "增資", "合併", "下市"];

  const scored = rows.map((row, idx) => {
    let score = 0;
    if (row.source === "twse_announcements") score += 3;
    const title = row.title ?? "";
    for (const kw of keywords) {
      if (title.includes(kw)) { score += 2; break; }
    }
    // Recency bonus (max 1.0 for first row, decays)
    score += Math.max(0, 1 - idx / rows.length);
    return { row, score, idx };
  });

  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, TOP_N).map((s, rank) => ({
    id: s.row.id ?? `fallback-${s.idx}`,
    headline: s.row.title ?? "(no title)",
    date: s.row.date ?? new Date().toISOString().slice(0, 10),
    ticker: s.row.ticker ?? undefined,
    companyName: s.row.company_name ?? undefined,
    source: s.row.source as "twse_announcements" | "finmind_stock_news",
    url: s.row.url ?? undefined,
    why_matters: null,
    impact_tier: null,
    tags: [],
    rank: rank + 1
  }));
}

// ── OpenAI AI selector ────────────────────────────────────────────────────────

interface AiNewsSelectionItem {
  id: string;
  rank: number;
  why_matters: string;
  impact_tier: "HIGH" | "MID" | "LOW";
  tags: string[];
}

interface AiNewsSelectionResponse {
  selected: AiNewsSelectionItem[];
}

function buildNewsPrompt(rows: RawNewsRow[]): string {
  const truncated = rows.slice(0, MAX_INPUT_ROWS);
  const numbered = truncated.map((row, i) => {
    const headline = (row.title ?? "").slice(0, 120);
    const ticker = row.ticker ? `[${row.ticker}] ` : "";
    const src = row.source === "twse_announcements" ? "(官方公告)" : "(新聞)";
    return `${i + 1}. id="${row.id ?? `row-${i}`}" ${ticker}${src} ${headline}`;
  });

  return `你是一位台股操盤手的即時市場助理。以下是最近 6 小時內的 ${truncated.length} 條台股新聞和公告：

${numbered.join("\n")}

請從中選出 ${TOP_N} 條對當前台股操盤者「最有代表性、最有具體影響、不重複」的新聞，按重要性由高到低排序。

回傳格式（嚴格 JSON，不要多餘文字）：
{
  "selected": [
    {
      "id": "<原始 id>",
      "rank": 1,
      "why_matters": "<一句話說明對操盤者的具體影響>",
      "impact_tier": "HIGH",
      "tags": ["類股", "主題"]
    }
  ]
}

規則：
- impact_tier 只能是 "HIGH" / "MID" / "LOW"
- tags 最多 3 個，每個 ≤ 8 字
- why_matters ≤ 60 字
- 嚴格選 ${TOP_N} 條，若新聞不足則選全部
- 不要解釋、不要前言，只輸出 JSON`;
}

async function callOpenAiNewsSelector(prompt: string): Promise<AiNewsSelectionResponse | null> {
  const apiKey = process.env["OPENAI_API_KEY"];
  if (!apiKey) return null;

  let res: Response;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CALL_TIMEOUT_MS);
    res = await fetch(OPENAI_API_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: OPENAI_MODEL_NEWS,
        messages: [{ role: "user", content: prompt }],
        max_tokens: MAX_TOKENS_RESPONSE,
        temperature: 0.2
      })
    });
    clearTimeout(timeout);
  } catch (e) {
    console.warn("[news-ai-selector] OpenAI call failed:", e instanceof Error ? e.message : String(e));
    return null;
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "(no body)");
    console.warn(`[news-ai-selector] OpenAI HTTP ${res.status}: ${body.slice(0, 120)}`);
    return null;
  }

  let data: { choices?: Array<{ message?: { content?: string } }> };
  try {
    data = await res.json();
  } catch {
    console.warn("[news-ai-selector] OpenAI response not JSON");
    return null;
  }

  const rawContent = data.choices?.[0]?.message?.content ?? null;
  if (!rawContent) {
    console.warn("[news-ai-selector] OpenAI returned empty content");
    return null;
  }

  // Strip possible markdown code fences
  const cleaned = rawContent
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();

  try {
    const parsed = JSON.parse(cleaned) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "selected" in parsed &&
      Array.isArray((parsed as AiNewsSelectionResponse).selected)
    ) {
      return parsed as AiNewsSelectionResponse;
    }
    console.warn("[news-ai-selector] Unexpected AI response shape");
    return null;
  } catch {
    console.warn("[news-ai-selector] Could not parse AI response JSON");
    return null;
  }
}

// ── Audit log writer (system-level, no user session) ──────────────────────────

async function writeNewsAuditLog(params: {
  workspaceId: string;
  runId: string;
  windowLabel: WindowLabel;
  selectionMode: SelectionMode;
  inputRowCount: number;
  selectedCount: number;
  selectionSummary: string;
}): Promise<void> {
  if (!isDatabaseMode()) return;
  const db = getDb();
  if (!db) return;
  try {
    await db.insert(auditLogs).values({
      workspaceId: params.workspaceId,
      actorId: null,
      action: "news.ai_selection" as string,
      entityType: "market_news",
      entityId: params.runId,
      payload: {
        run_id: params.runId,
        window_label: params.windowLabel,
        selection_mode: params.selectionMode,
        input_row_count: params.inputRowCount,
        selected_count: params.selectedCount,
        selection_summary: params.selectionSummary
      }
    });
  } catch (err) {
    console.warn("[news-ai-selector] audit log write failed:", err instanceof Error ? err.message : String(err));
  }
}

// ── Main selection run ────────────────────────────────────────────────────────

/**
 * Run the AI news selector for the current 6h window.
 * Called by the cron scheduler at 08:00 / 12:00 / 18:00 / 24:00 TST.
 * Also available as a direct call (e.g. manual trigger endpoint).
 *
 * @param workspaceId - Required for audit log attribution
 * @param forcedWindowLabel - Override window label (for manual triggers / tests)
 */
export async function runNewsAiSelection(params: {
  workspaceId: string;
  forcedWindowLabel?: WindowLabel;
}): Promise<NewsTop10Result> {
  const runId = randomUUID();
  const asOf = new Date().toISOString();
  const windowLabel = params.forcedWindowLabel ?? getCurrentWindowLabel();
  const nextRefreshAt = computeNextRefreshAt();

  // 1. Fetch raw news rows from last 6h
  const rawRows = await fetchRawNewsRows(WINDOW_HOURS);
  const inputRowCount = rawRows.length;

  let items: NewsAiItem[];
  let aiCallSuccess = false;
  let selectionMode: SelectionMode = "fallback";

  if (rawRows.length === 0) {
    // No source rows available — return empty result
    items = [];
  } else {
    // 2. Try AI selection
    const prompt = buildNewsPrompt(rawRows);
    const aiResponse = await callOpenAiNewsSelector(prompt);

    if (aiResponse && aiResponse.selected.length > 0) {
      // Map AI selection back to full row data
      const rowById = new Map(rawRows.map((r, idx) => [r.id ?? `row-${idx}`, r]));

      // Map AI-selected ids back to the original row data.
      // If the AI hallucinated an id that doesn't exist in rawRows, skip that item
      // rather than storing a "(id not found: …)" placeholder in the persistent state.
      // After filtering out bad ids, fill any remaining slots with deterministic-ranked
      // rows that were NOT already selected, so we always try to surface TOP_N items.
      const aiMappedItems: NewsAiItem[] = [];
      const aiSelectedIds = new Set<string>();

      for (let idx = 0; idx < aiResponse.selected.length && aiMappedItems.length < TOP_N; idx++) {
        const sel = aiResponse.selected[idx]!;
        const row = rowById.get(sel.id);
        if (!row) {
          // AI returned an id that doesn't match any fetched row — skip silently.
          // Log for debugging but do NOT surface "(id not found: …)" to the client.
          console.warn(`[news-ai-selector] AI returned unknown id="${sel.id}" — skipping`);
          continue;
        }
        aiSelectedIds.add(sel.id);
        aiMappedItems.push({
          id: row.id ?? sel.id,
          headline: row.title ?? "(no title)",
          date: row.date ?? asOf.slice(0, 10),
          ticker: row.ticker ?? undefined,
          companyName: row.company_name ?? undefined,
          source: row.source as "twse_announcements" | "finmind_stock_news",
          url: row.url ?? undefined,
          why_matters: sel.why_matters ?? null,
          impact_tier: (["HIGH", "MID", "LOW"].includes(sel.impact_tier ?? "") ? sel.impact_tier : null) as "HIGH" | "MID" | "LOW" | null,
          tags: Array.isArray(sel.tags) ? sel.tags.slice(0, 3) : [],
          rank: sel.rank ?? idx + 1
        });
      }

      // If AI hallucination left us short of TOP_N, pad with deterministic fallback items
      // that were not already selected by AI.
      if (aiMappedItems.length < TOP_N) {
        const deterministic = deterministicTop10(rawRows);
        for (const fallbackItem of deterministic) {
          if (aiMappedItems.length >= TOP_N) break;
          if (aiSelectedIds.has(fallbackItem.id)) continue;
          aiMappedItems.push({
            ...fallbackItem,
            rank: aiMappedItems.length + 1,
            // Clear AI-enriched fields since this is a fallback item
            why_matters: null,
            impact_tier: null,
            tags: []
          });
        }
      }

      items = aiMappedItems;

      aiCallSuccess = true;
      selectionMode = "ai";
    } else {
      // 3. Fallback to deterministic ranking
      items = deterministicTop10(rawRows);
      selectionMode = "fallback";
    }
  }

  const result: NewsTop10Result = {
    run_id: runId,
    as_of: asOf,
    next_refresh_at: nextRefreshAt,
    window_label: windowLabel,
    selection_mode: selectionMode,
    items,
    input_row_count: inputRowCount,
    ai_call_success: aiCallSuccess,
    stale_reason: null
  };

  // 4. Persist in-memory
  _lastResult = result;
  _lastRunAt = new Date();

  // 5. Write audit log (non-fatal)
  const selectionSummary = items.slice(0, 3).map((i) => i.headline.slice(0, 40)).join(" | ");
  await writeNewsAuditLog({
    workspaceId: params.workspaceId,
    runId,
    windowLabel,
    selectionMode,
    inputRowCount,
    selectedCount: items.length,
    selectionSummary
  });

  console.log(
    `[news-ai-selector] run_id=${runId} window=${windowLabel} mode=${selectionMode} ` +
    `input=${inputRowCount} selected=${items.length} ai_success=${aiCallSuccess}`
  );

  return result;
}

/**
 * Returns the last result with a staleness check.
 * If last_run > STALE_AFTER_MS, attaches stale_reason.
 */
export function getNewsTop10WithStaleness(): NewsTop10Result | null {
  if (!_lastResult) return null;

  const ageMs = _lastRunAt ? Date.now() - _lastRunAt.getTime() : Infinity;
  if (ageMs > STALE_AFTER_MS) {
    return {
      ..._lastResult,
      stale_reason: `last_run_over_${Math.round(ageMs / (60 * 60 * 1000))}h_ago`
    };
  }
  return _lastResult;
}

/**
 * Cron tick function — called from startSchedulers.
 * Only fires when within a valid TST window trigger.
 * workspaceId is required for audit log attribution.
 */
export async function runNewsAiSelectionTick(workspaceId: string): Promise<void> {
  if (!isWithinNewsWindowTrigger()) {
    // Outside trigger window — skip silently
    return;
  }
  await runNewsAiSelection({ workspaceId });
}

/**
 * Boot-recovery runner — fires unconditionally on server start (no window gate).
 * Called once with a short delay after startup so the endpoint is never stale_reason=never_run
 * for long stretches outside the 4 trigger windows.
 *
 * Unlike runNewsAiSelectionTick, this bypasses isWithinNewsWindowTrigger().
 * It still respects the 45-min double-fire guard (_lastRunAt).
 */
export async function runNewsAiSelectionBootRecovery(workspaceId: string): Promise<void> {
  // Skip if already ran in the last 45 minutes (e.g. server restarted near a window)
  if (_lastRunAt) {
    const elapsedMs = Date.now() - _lastRunAt.getTime();
    if (elapsedMs < 45 * 60 * 1000) return;
  }
  await runNewsAiSelection({ workspaceId });
}
