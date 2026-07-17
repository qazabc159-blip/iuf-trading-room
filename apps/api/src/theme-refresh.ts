/**
 * theme-refresh.ts — server-side theme content refresh (Elva 2026-06-11)
 *
 * Yang ruling 6/11 (option b): themes content had NO server-side update path —
 * it relied on the local OpenAlice runner (idle since May) or the admin
 * manual-update endpoint, so the themes page froze at 2026-05-18 (audit P2,
 * incl. leo-satellite mojibake and core/observation counts stuck at 0 while
 * the theme has 55 linked members).
 *
 * What a refresh does, per theme:
 *   1. Loads linked member companies (company_theme_links → companies).
 *   2. Marks members to market with the shared TWSE STOCK_DAY_ALL cache
 *      (latest published trading day — TWSE publishes with a lag, the prompt
 *      carries the data's own date and never claims "today").
 *   3. Asks a cheap LLM (default gpt-4o-mini via llm-gateway, budget-guarded)
 *      to update thesis / whyNow / bottleneck in 繁體中文.
 *   4. Validates the output (forbidden trading-advice wording, length, JSON
 *      shape) and writes the themes row. Validation failure = keep old text.
 *   5. Recomputes core/observation pool counts from company_theme_links.
 *
 * Hard lines:
 *   - lifecycle / priority / marketState are governance fields — never touched.
 *   - No buy/sell advice, no target price, no hallucinated numbers.
 *   - Per-run LLM cost cap; daily cron fires once per Taipei date (retry-capped).
 */

import { and, eq, sql as drizzleSql } from "drizzle-orm";
import { companies, companyThemeLinks, getDb, isDatabaseMode, themes, workspaces } from "@iuf-trading-room/db";
import { callLlm } from "./llm/llm-gateway.js";
import { parseRocEodDateIso } from "./lib/roc-date.js";

// ── Config ────────────────────────────────────────────────────────────────────

const THEME_REFRESH_MODEL = process.env["OPENAI_MODEL_THEME_REFRESH"] ?? "gpt-4o-mini";
const THEME_REFRESH_RUN_COST_CAP_USD = 1.0;
const THEME_REFRESH_MAX_MEMBERS_IN_PROMPT = 30;

// Forbidden wording — output containing any of these is rejected (old text kept).
const FORBIDDEN_PATTERNS = [
  /買進|買入|賣出|加碼|減碼|出脫|進場|目標價|停利|停損價/,
  /保證|穩賺|必漲|必跌|勝率/,
  /approved|alpha confirmed|live-ready|可以跟單/i,
];

// ── Status (read by admin status endpoint) ────────────────────────────────────

export interface ThemeRefreshStatus {
  running: boolean;
  lastRunAt: string | null;
  lastRunResult: string | null;
  lastRunThemesUpdated: number;
  lastRunThemesSkipped: number;
  lastRunCostUsd: number;
  lastError: string | null;
  successDate: string | null;
  attemptsToday: number;
}

const _status: ThemeRefreshStatus = {
  running: false,
  lastRunAt: null,
  lastRunResult: null,
  lastRunThemesUpdated: 0,
  lastRunThemesSkipped: 0,
  lastRunCostUsd: 0,
  lastError: null,
  successDate: null,
  attemptsToday: 0,
};

export function getThemeRefreshStatus(): ThemeRefreshStatus {
  return { ..._status };
}

/** Taipei calendar date (YYYY-MM-DD). */
export function themeRefreshTaipeiDate(nowMs = Date.now()): string {
  return new Date(nowMs + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** Daily cron window: 17:30–18:30 TST weekdays (post-close, before evening data jobs). */
export function isThemeRefreshCronWindowAt(nowMs = Date.now()): boolean {
  const taipei = new Date(nowMs + 8 * 60 * 60 * 1000);
  const day = taipei.getUTCDay();
  if (day === 0 || day === 6) return false;
  const hhmm = taipei.getUTCHours() * 100 + taipei.getUTCMinutes();
  return hhmm >= 1730 && hhmm <= 1830;
}

// ── Output validation ─────────────────────────────────────────────────────────

export interface ThemeRefreshLlmPayload {
  thesis: string;
  whyNow: string;
  bottleneck: string;
}

/**
 * Parses and validates the LLM JSON output. Returns null when the payload is
 * unusable (bad JSON / empty fields / forbidden wording / mojibake markers) —
 * callers keep the existing text in that case.
 */
export function parseThemeRefreshOutput(raw: string | null | undefined): ThemeRefreshLlmPayload | null {
  if (!raw) return null;
  const stripped = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const obj = parsed as Record<string, unknown>;
  const fields = ["thesis", "whyNow", "bottleneck"] as const;
  const out: Record<string, string> = {};
  for (const field of fields) {
    const value = obj[field];
    if (typeof value !== "string") return null;
    const text = value.trim();
    if (text.length < 20 || text.length > 600) return null;
    if (text.includes("�")) return null; // mojibake marker
    for (const pattern of FORBIDDEN_PATTERNS) {
      if (pattern.test(text)) return null;
    }
    out[field] = text;
  }
  return { thesis: out["thesis"]!, whyNow: out["whyNow"]!, bottleneck: out["bottleneck"]! };
}

// ── Member data ───────────────────────────────────────────────────────────────

interface ThemeMemberRow {
  ticker: string;
  name: string;
  beneficiaryTier: string;
  changePct: number | null;
}

async function loadThemeMembers(themeId: string): Promise<ThemeMemberRow[]> {
  const db = getDb();
  if (!db) return [];
  const rows = await db
    .select({
      ticker: companies.ticker,
      name: companies.name,
      beneficiaryTier: companies.beneficiaryTier,
    })
    .from(companyThemeLinks)
    .innerJoin(companies, eq(companies.id, companyThemeLinks.companyId))
    .where(eq(companyThemeLinks.themeId, themeId))
    .catch(() => [] as Array<{ ticker: string; name: string; beneficiaryTier: string }>);

  // Mark to market from the shared STOCK_DAY_ALL cache (latest published EOD)
  let changeByTicker = new Map<string, number>();
  try {
    const { getStockDayAllRows, parseTwseNumber } = await import("./data-sources/twse-openapi-client.js");
    const { isPlausibleChangePct } = await import("./kgi-heatmap-enricher.js");
    const stockRows = await getStockDayAllRows();
    changeByTicker = new Map(
      stockRows
        .map((r) => {
          // 2026-07-17 P1 fix (Pete review, PR #1295 🔴#2): same
          // comma-truncation bug as the kgi-core heatmap — bare parseFloat()
          // on ClosingPrice truncates at TWSE's thousands-comma for
          // >=1,000-priced theme members, corrupting the changePct fed into
          // the theme's LLM narrative prompt below.
          const close = parseTwseNumber(r.ClosingPrice);
          const chg = parseTwseNumber(r.Change);
          const prev = close !== null && close > 0 && chg !== null && close - chg !== 0 ? close - chg : null;
          const pct = prev !== null ? Math.round((chg! / prev) * 10000) / 100 : null;
          // Defense-in-depth: drop an implausible computed pct entirely
          // rather than feeding a garbage % move into the LLM prompt.
          const safePct = pct !== null && isPlausibleChangePct(pct) ? pct : null;
          return [r.Code?.trim() ?? "", safePct] as const;
        })
        .filter((entry): entry is readonly [string, number] => Boolean(entry[0]) && entry[1] !== null)
    );
  } catch {
    // mark-to-market is best-effort
  }

  return rows.map((r) => ({
    ticker: r.ticker,
    name: r.name,
    beneficiaryTier: r.beneficiaryTier,
    changePct: changeByTicker.get(r.ticker) ?? null,
  }));
}

/**
 * Pure: derive the EOD date label from a STOCK_DAY_ALL row's raw ROC `Date`
 * field, or "未知" if unparseable. Exported for direct testing. Delegates to
 * the shared lib/roc-date.ts parser (2026-07-10 sweep — see
 * reports/ledger_stall_20260709/); the original inline parser here only
 * handled the compact 7-digit shape with no slash fallback — the opposite
 * asymmetry from the bugs found elsewhere in this sweep, but still a
 * duplicate implementation of the same concern.
 */
export function _deriveEodDateLabel(rawDate: string | undefined): string {
  return parseRocEodDateIso(rawDate) ?? "未知";
}

async function latestEodDateLabel(): Promise<string> {
  try {
    const { getStockDayAllRows } = await import("./data-sources/twse-openapi-client.js");
    const rows = await getStockDayAllRows();
    return _deriveEodDateLabel(rows[0]?.Date);
  } catch {
    return "未知";
  }
}

// ── Prompt ────────────────────────────────────────────────────────────────────

function buildThemeRefreshPrompt(input: {
  themeName: string;
  currentThesis: string;
  currentWhyNow: string;
  currentBottleneck: string;
  members: ThemeMemberRow[];
  eodDateLabel: string;
}): string {
  const memberLines = input.members
    .slice(0, THEME_REFRESH_MAX_MEMBERS_IN_PROMPT)
    .map((m) => `- ${m.ticker} ${m.name}（${m.beneficiaryTier}）${m.changePct !== null ? `最近交易日漲跌 ${m.changePct}%` : ""}`)
    .join("\n");
  const up = input.members.filter((m) => (m.changePct ?? 0) > 0).length;
  const down = input.members.filter((m) => (m.changePct ?? 0) < 0).length;

  return `你是台股投資主題研究員。請更新主題「${input.themeName}」的三段內容（繁體中文）。

現有內容（可能過時，請依最新成員表現更新；若仍正確可保留並微調語句）：
- thesis（主題論點）: ${input.currentThesis || "（空）"}
- whyNow（為何現在）: ${input.currentWhyNow || "（空）"}
- bottleneck（瓶頸/風險）: ${input.currentBottleneck || "（空）"}

成員現況（${input.members.length} 檔，資料日期 ${input.eodDateLabel}，上漲 ${up} / 下跌 ${down}）：
${memberLines || "（無成員資料）"}

硬規則：
1. 只能輸出 JSON：{"thesis":"...","whyNow":"...","bottleneck":"..."}，不加 markdown。
2. 每段 60-250 字，敘事段落。
3. 禁止買賣建議、目標價、勝率、報酬承諾字眼。
4. 數字只能來自上方成員資料；沒有的數字不要編。
5. 資料日期是 ${input.eodDateLabel}，描述行情時要說「最近交易日」不可說「今日」。`;
}

// ── Pool counts ───────────────────────────────────────────────────────────────

/**
 * Recomputes core/observation pool counts for all themes in the workspace from
 * company_theme_links (audit:「核心 0 觀察 0」 vs 55 members contradiction).
 * Core pool = Core + Direct tiers; observation pool = Indirect + Observation.
 */
export async function recomputeThemePoolCounts(workspaceId: string): Promise<number> {
  const db = getDb();
  if (!db) return 0;
  try {
    const result = await db.execute(drizzleSql`
      UPDATE themes t
      SET core_pool_count = sub.core_count,
          observation_pool_count = sub.obs_count
      FROM (
        SELECT l.theme_id,
               COUNT(*) FILTER (WHERE c.beneficiary_tier IN ('Core', 'Direct'))::int AS core_count,
               COUNT(*) FILTER (WHERE c.beneficiary_tier IN ('Indirect', 'Observation'))::int AS obs_count
        FROM company_theme_links l
        JOIN companies c ON c.id = l.company_id
        GROUP BY l.theme_id
      ) sub
      WHERE t.id = sub.theme_id AND t.workspace_id = ${workspaceId}
    `);
    const rowCount = (result as { rowCount?: number }).rowCount ?? 0;
    return rowCount;
  } catch (e) {
    console.warn("[theme-refresh] recomputeThemePoolCounts failed:", e instanceof Error ? e.message : e);
    return 0;
  }
}

// ── Main run ──────────────────────────────────────────────────────────────────

export async function runThemeRefresh(opts: {
  trigger: "cron" | "manual";
  themeSlug?: string;
} = { trigger: "manual" }): Promise<{ updated: number; skipped: number; costUsd: number; error: string | null }> {
  if (_status.running) {
    return { updated: 0, skipped: 0, costUsd: 0, error: "already_running" };
  }
  if (!isDatabaseMode()) {
    return { updated: 0, skipped: 0, costUsd: 0, error: "memory_mode" };
  }
  const db = getDb();
  if (!db) {
    return { updated: 0, skipped: 0, costUsd: 0, error: "no_db" };
  }

  _status.running = true;
  _status.lastRunAt = new Date().toISOString();
  let updated = 0;
  let skipped = 0;
  let costUsd = 0;
  let runError: string | null = null;

  try {
    const [workspace] = await db.select({ id: workspaces.id }).from(workspaces).limit(1);
    if (!workspace) throw new Error("no_workspace");

    const conditions = [eq(themes.workspaceId, workspace.id)];
    if (opts.themeSlug) conditions.push(eq(themes.slug, opts.themeSlug));
    const themeRows = await db
      .select()
      .from(themes)
      .where(and(...conditions))
      .orderBy(themes.priority);

    const eodLabel = await latestEodDateLabel();

    for (const theme of themeRows) {
      if (costUsd >= THEME_REFRESH_RUN_COST_CAP_USD) {
        console.warn(`[theme-refresh] run cost cap $${THEME_REFRESH_RUN_COST_CAP_USD} reached — ${themeRows.length - updated - skipped} themes deferred to next run`);
        break;
      }

      const members = await loadThemeMembers(theme.id);
      const prompt = buildThemeRefreshPrompt({
        themeName: theme.name,
        currentThesis: theme.thesis,
        currentWhyNow: theme.whyNow,
        currentBottleneck: theme.bottleneck,
        members,
        eodDateLabel: eodLabel,
      });

      const llmResult = await callLlm(
        [{ role: "user", content: prompt }],
        {
          callerModule: "theme_refresh",
          taskType: "generation",
          modelKey: THEME_REFRESH_MODEL,
          workspaceId: workspace.id,
          maxTokens: 1200,
          temperature: 0.3,
          timeoutMs: 45_000,
        }
      );

      if (!llmResult) {
        skipped++;
        continue;
      }
      costUsd += llmResult.costUsd;

      const payload = parseThemeRefreshOutput(llmResult.content);
      if (!payload) {
        console.warn(`[theme-refresh] theme=${theme.slug}: LLM output rejected (validation) — keeping existing text`);
        skipped++;
        continue;
      }

      await db
        .update(themes)
        .set({
          thesis: payload.thesis,
          whyNow: payload.whyNow,
          bottleneck: payload.bottleneck,
          updatedAt: new Date(),
        })
        .where(eq(themes.id, theme.id));
      updated++;
      console.info(`[theme-refresh] theme=${theme.slug} updated (cost so far $${costUsd.toFixed(4)})`);
    }

    await recomputeThemePoolCounts(workspace.id);

    _status.lastRunResult = "ok";
    _status.lastError = null;
  } catch (e) {
    runError = e instanceof Error ? e.message : String(e);
    _status.lastRunResult = "error";
    _status.lastError = runError;
    console.error("[theme-refresh] run failed:", runError);
  } finally {
    _status.running = false;
    _status.lastRunThemesUpdated = updated;
    _status.lastRunThemesSkipped = skipped;
    _status.lastRunCostUsd = costUsd;
  }

  return { updated, skipped, costUsd, error: runError };
}

// ── Cron gate (mirrors the v3 cron pattern: success consumes the day, bounded retries) ──

const THEME_REFRESH_MAX_ATTEMPTS_PER_DAY = 2;
let _attemptDate: string | null = null;

export async function runThemeRefreshCronTick(): Promise<void> {
  if (!isThemeRefreshCronWindowAt()) return;
  if (_status.running) return;

  const today = themeRefreshTaipeiDate();
  if (_status.successDate === today) return;
  if (_attemptDate !== today) {
    _attemptDate = today;
    _status.attemptsToday = 0;
  }
  if (_status.attemptsToday >= THEME_REFRESH_MAX_ATTEMPTS_PER_DAY) return;
  _status.attemptsToday++;

  console.info(`[theme-refresh-cron] firing for date=${today} attempt=${_status.attemptsToday}/${THEME_REFRESH_MAX_ATTEMPTS_PER_DAY}`);
  const result = await runThemeRefresh({ trigger: "cron" });
  if (result.error === null && result.updated > 0) {
    _status.successDate = today;
  }
}

// Re-export for tests
export const _themeRefreshInternals = { FORBIDDEN_PATTERNS, THEME_REFRESH_RUN_COST_CAP_USD };
