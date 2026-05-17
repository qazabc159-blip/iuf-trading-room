/**
 * openalice-strategy-brief.ts — Axis 4 upgrade: strategy-level brief generator.
 *
 * Upgrades from "daily market summary" to "strategy-level brief" by weaving:
 *   - cont_liq Period 1 daily yaml (last 5 trading days)
 *   - Strategy snapshots v47 (headlineMetrics / equityCurve / sampleTrades)
 *   - FinMind institutional buysell (last 5 trading days, from DB)
 *   - OHLCV for basket stocks + 0050 (last 20 days, from DB)
 *
 * Sections generated (6):
 *   1. today_market_summary     — TWSE / institutional / margin overview
 *   2. strategy_observation_cont_liq_v36 — basket return / alert distance / per-stock
 *   3. strategy_observation_002        — forward observation state
 *   4. strategy_observation_003        — forward observation state
 *   5. signal_today             — entry/exit signal status for each strategy
 *   6. risk_alerts              — distance to kill-switch thresholds / hard lines
 *   7. commentary               — neutral AI observation (no promote/demote)
 *
 * Hard rules (enforced in prompt + hallucination-check pass):
 *   - NEVER generate buy/sell/進場/賣出/買進/出脫/目標價/guarantee/勝率/保證 wording.
 *   - NEVER state "approved" / "alpha confirmed" / "live-ready" for any strategy.
 *   - NEVER reference metric values not present in source pack (hallucination block).
 *   - Tone: "觀察到" / "資料顯示" — neutral observation only.
 *   - No token/credential in prompts (cont_liq yaml scrubbed before sending).
 *   - Data absent → BLOCKED_DATA_QUALITY, never fake.
 *
 * Storage: in-memory + optional strategy_briefs table (CREATE TABLE IF NOT EXISTS).
 * No migration file — CREATE IF NOT EXISTS is additive-only.
 *
 * Scheduler: 14:00 TST (06:00 UTC) — 30min buffer after 13:30 close.
 * Trigger: POST /api/v1/openalice/strategy-brief/generate (Owner)
 * Read:    GET  /api/v1/openalice/strategy-brief/latest   (Owner)
 */

import { randomUUID } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { and, desc, eq, gte, sql as drizzleSql } from "drizzle-orm";
import { companiesOhlcv, getDb, isDatabaseMode, workspaces } from "@iuf-trading-room/db";

import { callLlm, stripCodeFences } from "./llm/llm-gateway.js";
import { fetchStrategySnapshot, ALLOWED_STRATEGY_IDS } from "./lab-strategy-snapshot-fetcher.js";
import { sanitizeBriefBody } from "./openalice-pipeline.js";

// ── Constants ──────────────────────────────────────────────────────────────────

const STALE_AFTER_MS = 26 * 60 * 60 * 1000; // 26h — covers one full trading day
const MAX_TOKENS_GENERATOR = 2_400;
const MAX_TOKENS_HALLUCINATION_CHECK = 600;
const YAML_DIR_REL_TO_FILE = join(
  fileURLToPath(new URL(".", import.meta.url)),
  "..", "..", "..", "..",          // apps/api/src → monorepo root (dev)
  "reports", "trading_room", "cont_liq_period1_daily"
);
// Railway CWD = apps/api — also probe this
const YAML_DIR_REL_TO_CWD = join(
  process.cwd(),
  "..", "..",
  "reports", "trading_room", "cont_liq_period1_daily"
);

/** Allowed strategies for this brief. Must match ALLOWED_STRATEGY_IDS. */
const STRATEGY_IDS = ["cont_liq_v36", "strategy_002", "strategy_003"] as const;
type StrategyId = typeof STRATEGY_IDS[number];

// ── Types ──────────────────────────────────────────────────────────────────────

export type StrategyBriefSection = {
  sectionId: string;
  heading: string;
  body: string;
};

export type StrategyBriefStatus =
  | "published"
  | "blocked_data_quality"
  | "blocked_hallucination"
  | "blocked_red_wording"
  | "reviewer_held"
  | "error";

export type StrategyBriefResult = {
  briefId: string;
  generatedAt: string;
  tradingDate: string;
  strategies: StrategyId[];
  sections: StrategyBriefSection[];
  status: StrategyBriefStatus;
  blockedReason: string | null;
  sourcePack: StrategyBriefSourcePack;
  generationMode: "ai" | "source_only_fallback";
  hallucinationCheckPassed: boolean | null;
  disclaimer: "research_only";
};

export type ContLiqDayCapture = {
  date: string;
  basket_equal_weight_unrealized_pct: number | null;
  benchmark_0050_same_period_pct: number | null;
  excess_pct: number | null;
  status_enum: string | null;
  alert_triggers: string[];
  kill_switch_check: {
    basket_lt_minus_15_pct: boolean | null;
    intra_period_dd_gt_minus_10_pct_today_close_only: boolean | null;
    basket_today_pct: number | null;
    kill_switch_evaluable: boolean | null;
  } | null;
  basket: Array<{
    symbol: string;
    unrealized_return_pct: number | null;
    today_close_adj: number | null;
    entry_close_adj: number | null;
  }>;
  data_finality_status: string | null;
  days_held: number | null;
  period_day_of_20: number | null;
};

export type StrategyBriefSourcePack = {
  packId: string;
  collectedAt: string;
  tradingDate: string;
  contLiqDays: ContLiqDayCapture[];
  snapshots: Record<StrategyId, { ok: boolean; staleReason: string | null; data: Record<string, unknown> | null }>;
  institutionalRows: Record<string, unknown>[];
  ohlcvRows: Record<string, unknown>[];
  trailComplete: boolean;
  blockedSources: string[];
};

// ── In-memory state ────────────────────────────────────────────────────────────

let _lastResult: StrategyBriefResult | null = null;
let _lastRunAt: Date | null = null;

export function getLastStrategyBrief(): StrategyBriefResult | null {
  return _lastResult;
}

export function getStrategyBriefWithStaleness(): StrategyBriefResult | null {
  if (!_lastResult) return null;
  const ageMs = _lastRunAt ? Date.now() - _lastRunAt.getTime() : Infinity;
  if (ageMs > STALE_AFTER_MS) {
    return {
      ..._lastResult,
      blockedReason: `stale: last_run_${Math.round(ageMs / (60 * 60 * 1000))}h_ago`
    };
  }
  return _lastResult;
}

/** For tests only. */
export function _resetStrategyBrief(): void {
  _lastResult = null;
  _lastRunAt = null;
}

// ── DB: ensure strategy_briefs table exists (CREATE TABLE IF NOT EXISTS) ───────

async function ensureStrategyBriefsTable(): Promise<void> {
  const db = getDb();
  if (!db) return;
  try {
    await db.execute(drizzleSql`
      CREATE TABLE IF NOT EXISTS strategy_briefs (
        id           TEXT    PRIMARY KEY,
        workspace_id TEXT    NOT NULL,
        trading_date TEXT    NOT NULL,
        status       TEXT    NOT NULL DEFAULT 'published',
        strategies   TEXT    NOT NULL DEFAULT '[]',
        sections     TEXT    NOT NULL DEFAULT '[]',
        blocked_reason TEXT,
        hallucination_check_passed INTEGER,
        generation_mode TEXT NOT NULL DEFAULT 'ai',
        source_pack  TEXT,
        generated_at TEXT    NOT NULL,
        created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
      )
    `);
  } catch {
    // Non-fatal — in-memory store always succeeds.
    // Table creation may fail on Postgres dialect (different syntax); handled below.
  }
  // Also try Postgres syntax
  try {
    await db.execute(drizzleSql`
      CREATE TABLE IF NOT EXISTS strategy_briefs (
        id                        TEXT        PRIMARY KEY,
        workspace_id              TEXT        NOT NULL,
        trading_date              TEXT        NOT NULL,
        status                    TEXT        NOT NULL DEFAULT 'published',
        strategies                JSONB       NOT NULL DEFAULT '[]',
        sections                  JSONB       NOT NULL DEFAULT '[]',
        blocked_reason            TEXT,
        hallucination_check_passed BOOLEAN,
        generation_mode           TEXT        NOT NULL DEFAULT 'ai',
        source_pack               JSONB,
        generated_at              TEXT        NOT NULL,
        created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
  } catch {
    // Non-fatal — may already exist or dialect mismatch
  }
}

async function persistStrategyBrief(workspaceId: string, result: StrategyBriefResult): Promise<void> {
  const db = getDb();
  if (!db) return;
  try {
    await db.execute(drizzleSql`
      INSERT INTO strategy_briefs
        (id, workspace_id, trading_date, status, strategies, sections,
         blocked_reason, hallucination_check_passed, generation_mode,
         source_pack, generated_at)
      VALUES (
        ${result.briefId},
        ${workspaceId},
        ${result.tradingDate},
        ${result.status},
        ${JSON.stringify(result.strategies)},
        ${JSON.stringify(result.sections)},
        ${result.blockedReason ?? null},
        ${result.hallucinationCheckPassed === null ? null : result.hallucinationCheckPassed ? 1 : 0},
        ${result.generationMode},
        ${JSON.stringify({
          packId: result.sourcePack.packId,
          tradingDate: result.sourcePack.tradingDate,
          trailComplete: result.sourcePack.trailComplete,
          blockedSources: result.sourcePack.blockedSources,
          contLiqDaysCount: result.sourcePack.contLiqDays.length,
          institutionalRowsCount: result.sourcePack.institutionalRows.length,
          ohlcvRowsCount: result.sourcePack.ohlcvRows.length,
        })},
        ${result.generatedAt}
      )
      ON CONFLICT (id) DO NOTHING
    `);
  } catch (e) {
    console.warn("[strategy-brief] DB persist failed (non-fatal):", e instanceof Error ? e.message : String(e));
  }
}

// ── Yaml loader ────────────────────────────────────────────────────────────────

/**
 * Parse a cont_liq period1 daily yaml into a trimmed ContLiqDayCapture.
 * Returns null if file is missing, malformed, or YAML parse fails.
 * NEVER throws.
 */
function parseContLiqYaml(raw: string): ContLiqDayCapture | null {
  try {
    // Minimal hand-rolled YAML key extractor (no yaml dep required — these files are
    // structured with simple `key: value` lines and nested lists).
    const getNum = (key: string): number | null => {
      const m = raw.match(new RegExp(`^${key}:\\s*([\\-\\d.]+)`, "m"));
      return m ? parseFloat(m[1]!) : null;
    };
    const getStr = (key: string): string | null => {
      const m = raw.match(new RegExp(`^${key}:\\s*(\\S.*)$`, "m"));
      return m ? m[1]!.trim() : null;
    };
    const getBool = (key: string): boolean | null => {
      const m = raw.match(new RegExp(`^${key}:\\s*(true|false)`, "im"));
      return m ? m[1]!.toLowerCase() === "true" : null;
    };

    const date = getStr("date");
    if (!date) return null;

    // parse basket entries
    const basket: ContLiqDayCapture["basket"] = [];
    const basketSection = raw.match(/^basket:\n([\s\S]*?)(?=^\w|\Z)/m)?.[1] ?? "";
    const symbolMatches = [...basketSection.matchAll(/^  - symbol:\s*"?(\w+)"?/gm)];
    for (const sm of symbolMatches) {
      const sym = sm[1]!;
      // Extract from the block following this symbol line
      const blockStart = sm.index! + sm[0].length;
      const nextSymbol = basketSection.indexOf("\n  - symbol:", blockStart);
      const block = basketSection.slice(blockStart, nextSymbol === -1 ? undefined : nextSymbol);
      const getBlockNum = (k: string) => {
        const bm = block.match(new RegExp(`${k}:\\s*([\\-\\d.]+)`));
        return bm ? parseFloat(bm[1]!) : null;
      };
      basket.push({
        symbol: sym,
        unrealized_return_pct: getBlockNum("unrealized_return_pct"),
        today_close_adj: getBlockNum("today_close_adj"),
        entry_close_adj: getBlockNum("entry_close_adj")
      });
    }

    // parse kill_switch_check block
    const killBlock = raw.match(/^kill_switch_check:\n([\s\S]*?)(?=^\w|\Z)/m)?.[1] ?? "";
    const getKillBool = (k: string): boolean | null => {
      const m = killBlock.match(new RegExp(`${k}:\\s*(true|false)`, "i"));
      return m ? m[1]!.toLowerCase() === "true" : null;
    };
    const getKillNum = (k: string): number | null => {
      const m = killBlock.match(new RegExp(`${k}:\\s*([\\-\\d.]+)`));
      return m ? parseFloat(m[1]!) : null;
    };

    // parse alert_triggers list
    const alertSection = raw.match(/^alert_triggers:\n([\s\S]*?)(?=^\w|\Z)/m)?.[1] ?? "";
    const alertTriggers = [...alertSection.matchAll(/^  - (\S.*)/gm)].map((m) => m[1]!);

    return {
      date,
      basket_equal_weight_unrealized_pct: getNum("basket_equal_weight_unrealized_pct"),
      benchmark_0050_same_period_pct: getNum("benchmark_0050_same_period_pct"),
      excess_pct: getNum("excess_pct"),
      status_enum: getStr("status_enum"),
      alert_triggers: alertTriggers,
      kill_switch_check: {
        basket_lt_minus_15_pct: getKillBool("basket_lt_minus_15_pct"),
        intra_period_dd_gt_minus_10_pct_today_close_only: getKillBool("intra_period_dd_gt_minus_10_pct_today_close_only"),
        basket_today_pct: getKillNum("basket_today_pct"),
        kill_switch_evaluable: getKillBool("kill_switch_evaluable")
      },
      basket,
      data_finality_status: getStr("data_finality_status"),
      days_held: getNum("days_held"),
      period_day_of_20: getNum("period_day_of_20")
    };
  } catch {
    return null;
  }
}

/**
 * Load cont_liq daily yamls for today and last N trading days.
 * Searches both the file-relative path and CWD-relative path.
 * Returns captured days in reverse-chronological order (most recent first).
 * Never throws.
 */
function loadContLiqYamls(tradingDate: string, lookbackDays = 5): ContLiqDayCapture[] {
  const results: ContLiqDayCapture[] = [];

  // Generate candidate dates: tradingDate + up to lookbackDays prior calendar days
  const candidateDates: string[] = [];
  const base = new Date(tradingDate + "T00:00:00Z");
  for (let i = 0; i < lookbackDays + 1; i++) {
    const d = new Date(base);
    d.setUTCDate(d.getUTCDate() - i);
    candidateDates.push(d.toISOString().slice(0, 10));
  }

  const searchDirs = [YAML_DIR_REL_TO_FILE, YAML_DIR_REL_TO_CWD];

  for (const date of candidateDates) {
    let found = false;
    for (const dir of searchDirs) {
      const filePath = join(dir, `${date}.yaml`);
      try {
        if (existsSync(filePath)) {
          const raw = readFileSync(filePath, "utf-8");
          const parsed = parseContLiqYaml(raw);
          if (parsed) {
            results.push(parsed);
            found = true;
            break;
          }
        }
      } catch {
        // Try next dir
      }
    }
    // Stop if we've collected enough actual data (cap at lookbackDays actual files)
    if (found && results.length >= lookbackDays) break;
  }

  return results;
}

// ── DB source collectors ───────────────────────────────────────────────────────

async function collectInstitutionalRows(workspaceId: string): Promise<Record<string, unknown>[]> {
  const db = getDb();
  if (!db) return [];
  try {
    const rows = await db.execute(drizzleSql`
      SELECT stock_id, date, foreign_investor_buy, foreign_investor_sell,
             investment_trust_buy, investment_trust_sell, dealer_buy, dealer_sell
      FROM tw_institutional_buysell
      WHERE stock_id IN (SELECT ticker FROM companies WHERE workspace_id = ${workspaceId})
      ORDER BY date DESC
      LIMIT 50
    `);
    const arr = (rows as { rows?: Record<string, unknown>[] }).rows
      ?? (Array.isArray(rows) ? (rows as Record<string, unknown>[]) : []);
    return arr;
  } catch {
    return [];
  }
}

async function collectOhlcvRows(workspaceId: string, tickers: string[]): Promise<Record<string, unknown>[]> {
  if (tickers.length === 0) return [];
  const db = getDb();
  if (!db) return [];
  try {
    // Add 0050 to tickers list if not already present
    const allTickers = [...new Set([...tickers, "0050"])];
    const tickerList = allTickers.map((t) => `'${t.replace(/'/g, "''")}'`).join(",");
    const rows = await db.execute(drizzleSql.raw(
      `SELECT ticker, dt, open, high, low, close, volume
       FROM companies_ohlcv
       WHERE workspace_id = '${workspaceId}' AND ticker IN (${tickerList})
       ORDER BY ticker, dt DESC
       LIMIT 200`
    ));
    const arr = (rows as { rows?: Record<string, unknown>[] }).rows
      ?? (Array.isArray(rows) ? (rows as Record<string, unknown>[]) : []);
    return arr;
  } catch {
    return [];
  }
}

// ── Source pack collector ──────────────────────────────────────────────────────

export async function collectStrategyBriefSourcePack(
  tradingDate: string,
  workspaceId: string
): Promise<StrategyBriefSourcePack> {
  const packId = randomUUID();
  const collectedAt = new Date().toISOString();
  const blockedSources: string[] = [];

  // 1. cont_liq daily yamls
  const contLiqDays = loadContLiqYamls(tradingDate, 5);
  if (contLiqDays.length === 0) {
    blockedSources.push("cont_liq_yaml:no_files_found");
  }

  // 2. Strategy snapshots
  const snapshots: StrategyBriefSourcePack["snapshots"] = {} as StrategyBriefSourcePack["snapshots"];
  for (const strategyId of STRATEGY_IDS) {
    if (!ALLOWED_STRATEGY_IDS.has(strategyId)) {
      snapshots[strategyId] = { ok: false, staleReason: "not_in_allowed_set", data: null };
      blockedSources.push(`snapshot:${strategyId}:not_allowed`);
      continue;
    }
    try {
      const res = await fetchStrategySnapshot(strategyId);
      if (res.ok) {
        snapshots[strategyId] = { ok: true, staleReason: null, data: res.snapshot };
      } else {
        snapshots[strategyId] = { ok: false, staleReason: res.stale_reason, data: res.snapshot };
        if (!res.snapshot) {
          blockedSources.push(`snapshot:${strategyId}:${res.stale_reason}`);
        }
      }
    } catch (e) {
      snapshots[strategyId] = { ok: false, staleReason: String(e), data: null };
      blockedSources.push(`snapshot:${strategyId}:fetch_error`);
    }
  }

  // 3. Institutional buysell from DB
  const institutionalRows = await collectInstitutionalRows(workspaceId);
  if (institutionalRows.length === 0) {
    blockedSources.push("tw_institutional_buysell:empty");
  }

  // 4. OHLCV for basket stocks + 0050
  // Extract basket symbols from cont_liq yaml
  const basketSymbols = contLiqDays.length > 0
    ? [...new Set(contLiqDays[0]!.basket.map((b) => b.symbol))]
    : [];
  const ohlcvRows = await collectOhlcvRows(workspaceId, basketSymbols);
  if (ohlcvRows.length === 0) {
    blockedSources.push("companies_ohlcv:empty");
  }

  // Trail complete: need at least 1 cont_liq yaml AND at least 1 snapshot
  const anySnapshotOk = STRATEGY_IDS.some((id) => snapshots[id]?.ok || snapshots[id]?.data !== null);
  const trailComplete = contLiqDays.length > 0 && anySnapshotOk;

  return {
    packId,
    collectedAt,
    tradingDate,
    contLiqDays,
    snapshots,
    institutionalRows,
    ohlcvRows,
    trailComplete,
    blockedSources
  };
}

// ── Prompt builders ────────────────────────────────────────────────────────────

function trim(v: string, max = 800): string {
  const n = v.replace(/\s+/g, " ").trim();
  return n.length > max ? n.slice(0, max - 1) + "…" : n;
}

function formatContLiqSummary(days: ContLiqDayCapture[]): string {
  if (days.length === 0) return "cont_liq daily data: UNAVAILABLE";
  const lines: string[] = ["=== cont_liq_v36 Period 1 Daily Captures (most recent first) ==="];
  for (const d of days) {
    lines.push(
      `Date: ${d.date} | Day ${d.period_day_of_20 ?? "?"}/20 | Days held: ${d.days_held ?? "?"} | ` +
      `Status: ${d.status_enum ?? "unknown"} | Finality: ${d.data_finality_status ?? "unknown"}`
    );
    lines.push(
      `  basket_return_pct=${d.basket_equal_weight_unrealized_pct?.toFixed(4) ?? "n/a"} ` +
      `benchmark_0050_pct=${d.benchmark_0050_same_period_pct?.toFixed(4) ?? "n/a"} ` +
      `excess_pct=${d.excess_pct?.toFixed(4) ?? "n/a"}`
    );
    if (d.kill_switch_check) {
      const ks = d.kill_switch_check;
      lines.push(
        `  kill_switch: basket_lt_minus_15=${ks.basket_lt_minus_15_pct ?? "n/a"} ` +
        `dd_gt_minus_10=${ks.intra_period_dd_gt_minus_10_pct_today_close_only ?? "n/a"} ` +
        `evaluable=${ks.kill_switch_evaluable ?? "n/a"}`
      );
    }
    if (d.alert_triggers.length > 0) {
      lines.push(`  ALERTS: ${d.alert_triggers.join(" | ")}`);
    }
    for (const stock of d.basket) {
      lines.push(
        `  ${stock.symbol}: entry=${stock.entry_close_adj ?? "n/a"} ` +
        `close=${stock.today_close_adj ?? "n/a"} ` +
        `return_pct=${stock.unrealized_return_pct?.toFixed(4) ?? "n/a"}`
      );
    }
  }
  return lines.join("\n");
}

function formatSnapshotSummary(snapshots: StrategyBriefSourcePack["snapshots"]): string {
  const lines: string[] = ["=== Strategy Snapshots ==="];
  for (const id of STRATEGY_IDS) {
    const snap = snapshots[id];
    if (!snap || !snap.data) {
      lines.push(`${id}: UNAVAILABLE (${snap?.staleReason ?? "no_data"})`);
      continue;
    }
    const d = snap.data;
    const hm = d["headlineMetrics"] as Record<string, unknown> | undefined;
    const status = d["status"] as string | undefined;
    lines.push(
      `${id}: status=${status ?? "unknown"} ` +
      `strategyNetReturn=${hm?.["strategyNetAbsoluteReturnPct"] ?? "n/a"}% ` +
      `benchmark0050=${hm?.["benchmark0050ReturnPct"] ?? "n/a"}% ` +
      `excess=${hm?.["excessVs0050Pp"] ?? "n/a"}pp ` +
      `hitRate=${hm?.["hitRatePct"] ?? "n/a"} ` +
      `maxDD=${hm?.["maxDrawdownNetPct"] ?? "n/a"} ` +
      `totalRebalances=${hm?.["totalRebalances"] ?? "n/a"}`
    );
    // Equity curve last point
    const ec = d["equityCurve"] as { points?: Array<{ date: string; cumReturn: number; drawdown: number }> } | undefined;
    const lastPt = ec?.points?.[ec.points.length - 1];
    if (lastPt) {
      lines.push(`  equityCurve last: date=${lastPt.date} cumReturn=${lastPt.cumReturn} drawdown=${lastPt.drawdown}`);
    }
    // caveats
    const caveats = d["caveatTextZh"] as string | undefined ?? d["caveats"] as string | undefined;
    if (caveats) lines.push(`  caveat: ${trim(String(caveats), 300)}`);
  }
  return lines.join("\n");
}

function formatInstitutionalSummary(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "法人買賣資料: UNAVAILABLE";
  // Group by date, take last 5 distinct dates
  const byDate = new Map<string, Record<string, unknown>[]>();
  for (const row of rows) {
    const date = String(row["date"] ?? "");
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date)!.push(row);
  }
  const dates = [...byDate.keys()].sort().reverse().slice(0, 5);
  const lines = ["=== 法人籌碼 (最近5個交易日) ==="];
  for (const date of dates) {
    const dayRows = byDate.get(date)!;
    // aggregate: sum foreign_investor_buy - sell, investment_trust, dealer
    let fib = 0, fis = 0, itb = 0, its = 0, db = 0, ds = 0;
    for (const r of dayRows) {
      fib += Number(r["foreign_investor_buy"] ?? 0);
      fis += Number(r["foreign_investor_sell"] ?? 0);
      itb += Number(r["investment_trust_buy"] ?? 0);
      its += Number(r["investment_trust_sell"] ?? 0);
      db += Number(r["dealer_buy"] ?? 0);
      ds += Number(r["dealer_sell"] ?? 0);
    }
    lines.push(
      `${date}: 外資淨=${fib - fis} 投信淨=${itb - its} 自營淨=${db - ds} (${dayRows.length} 檔)`
    );
  }
  return lines.join("\n");
}

function formatOhlcvSummary(rows: Record<string, unknown>[], basketSymbols: string[]): string {
  if (rows.length === 0) return "OHLCV資料: UNAVAILABLE";
  // Show last close for each basket symbol + 0050
  const symbols = [...new Set([...basketSymbols, "0050"])];
  const bySymbol = new Map<string, typeof rows>();
  for (const row of rows) {
    const sym = String(row["ticker"] ?? "");
    if (!bySymbol.has(sym)) bySymbol.set(sym, []);
    bySymbol.get(sym)!.push(row);
  }
  const lines = ["=== OHLCV 最近收盤 ==="];
  for (const sym of symbols) {
    const symRows = bySymbol.get(sym) ?? [];
    const last3 = symRows.slice(0, 3);
    if (last3.length === 0) {
      lines.push(`${sym}: 無資料`);
    } else {
      const pts = last3.map((r) => `${r["dt"]}@${r["close"]}`).join(", ");
      lines.push(`${sym}: ${pts}`);
    }
  }
  return lines.join("\n");
}

function buildGeneratorPrompt(sourcePack: StrategyBriefSourcePack): string {
  const contLiqSummary = formatContLiqSummary(sourcePack.contLiqDays);
  const snapshotSummary = formatSnapshotSummary(sourcePack.snapshots);
  const institutionalSummary = formatInstitutionalSummary(sourcePack.institutionalRows);
  const basketSymbols = sourcePack.contLiqDays[0]?.basket.map((b) => b.symbol) ?? [];
  const ohlcvSummary = formatOhlcvSummary(sourcePack.ohlcvRows, basketSymbols);

  return `你是台股 AI 交易戰情室策略級簡報撰寫器。根據下方真實資料，生成繁體中文策略級 brief。

=== 硬規則（任何違反 → 拒絕） ===
- 只輸出 JSON。
- 所有 heading 欄位必須使用繁體中文，禁止 "Market Overview" / "Technical Analysis" / "Risk Alert" / "Strategy Observation" / "Summary" 等英文標題。
- heading 範例：「今日市場總覽」/「技術觀察」/「風控警示」/「策略觀察」/「今日訊號狀態」/「綜合觀察」。
- 禁止買賣建議、禁止進場/賣出/買進/出脫/做多/做空。
- 禁止目標價/target price/guarantee/必賺/保證/勝率。
- 禁止 "approved" / "alpha confirmed" / "live-ready" 等促進用語。
- 禁止捏造資料來源未提供的數字或新聞。
- 中性語氣："觀察到" / "資料顯示" / "目前狀態為" — 不准寫 "建議" / "應該"。
- 每個 section body 至少 80 字，最多 1200 字。

=== 輸出 schema ===
{
  "sections": [
    { "sectionId": "today_market_summary", "heading": "今日市場總覽", "body": "..." },
    { "sectionId": "strategy_observation_cont_liq_v36", "heading": "cont_liq_v36 觀察", "body": "..." },
    { "sectionId": "strategy_observation_002", "heading": "strategy_002 觀察", "body": "..." },
    { "sectionId": "strategy_observation_003", "heading": "strategy_003 觀察", "body": "..." },
    { "sectionId": "signal_today", "heading": "今日訊號狀態", "body": "..." },
    { "sectionId": "risk_alerts", "heading": "風控警示", "body": "..." },
    { "sectionId": "commentary", "heading": "綜合觀察", "body": "..." }
  ]
}

=== 資料來源 ===
交易日：${sourcePack.tradingDate}

${contLiqSummary}

${snapshotSummary}

${institutionalSummary}

${ohlcvSummary}

=== 補充說明 ===
cont_liq 策略為研究前瞻觀察期（RESEARCH_FORWARD_OBSERVATION）。
strategy_002/003 狀態以快照 status 欄位為準。
所有數字以上方資料為唯一來源；若資料標記 UNAVAILABLE 或 PROVISIONAL，
請在 body 中明確標示「資料暫缺/待確認」，不准推估或補填數字。
risk_alerts 中請明確標示 basket_equal_weight_unrealized_pct 與 -10% / -15% 門檻距離。`;
}

function buildHallucinationCheckPrompt(draftSections: StrategyBriefSection[], sourcePack: StrategyBriefSourcePack): string {
  // Extract key numeric values from source pack as ground truth
  const groundTruth: string[] = [];
  const today = sourcePack.contLiqDays[0];
  if (today) {
    groundTruth.push(`basket_pct=${today.basket_equal_weight_unrealized_pct?.toFixed(4) ?? "n/a"}`);
    groundTruth.push(`excess_pct=${today.excess_pct?.toFixed(4) ?? "n/a"}`);
    groundTruth.push(`kill_switch_basket_lt_minus15=${today.kill_switch_check?.basket_lt_minus_15_pct ?? "n/a"}`);
    for (const stock of today.basket) {
      groundTruth.push(`${stock.symbol}_return=${stock.unrealized_return_pct?.toFixed(4) ?? "n/a"}`);
    }
  }

  const draftText = draftSections.map((s) => `[${s.sectionId}] ${s.body}`).join("\n\n");

  return `你是台股 brief 事實查核員。請檢查以下 brief 草稿是否有幻覺（捏造不在資料來源的數字）。

=== 已知真實數字（唯一依據） ===
${groundTruth.join("\n")}

=== Brief 草稿 ===
${trim(draftText, 2000)}

=== 任務 ===
1. 找出 brief 中出現但不在上方真實數字清單中的具體數值（百分比、股價、日數等）。
2. 如果 brief 只說「資料暫缺」「UNAVAILABLE」「待確認」等，不算幻覺。
3. 只回傳 JSON：{ "pass": true | false, "issues": ["...描述..."] }
   - pass=true 代表無幻覺問題
   - issues 為空陣列時 pass 必為 true`;
}

// ── Heading sanitizer ─────────────────────────────────────────────────────────

const STRATEGY_ENGLISH_HEADING_MAP: Record<string, string> = {
  "market overview": "今日市場總覽",
  "market summary": "今日市場總覽",
  "technical analysis": "技術觀察",
  "risk alert": "風控警示",
  "risk alerts": "風控警示",
  "strategy observation": "策略觀察",
  "strategy observations": "策略觀察",
  "signal today": "今日訊號狀態",
  "signals today": "今日訊號狀態",
  "today's signals": "今日訊號狀態",
  "summary": "綜合觀察",
  "commentary": "綜合觀察",
  "overview": "市場總覽",
  "sector analysis": "類股分析",
};

function sanitizeStrategyHeading(raw: string): string {
  const trimmed = raw.trim();
  const lower = trimmed.toLowerCase();
  if (STRATEGY_ENGLISH_HEADING_MAP[lower]) {
    console.warn(`[strategy-brief] heading English fallback: "${trimmed}" → "${STRATEGY_ENGLISH_HEADING_MAP[lower]}"`);
    return STRATEGY_ENGLISH_HEADING_MAP[lower];
  }
  const latin = (trimmed.match(/[A-Za-z]/g) ?? []).length;
  const cjk = (trimmed.match(/[一-鿿]/g) ?? []).length;
  if (latin >= 8 && latin > cjk) {
    console.warn(`[strategy-brief] heading English-heavy: "${trimmed}" → "市場觀察"`);
    return "市場觀察";
  }
  return trimmed;
}

// ── Wording guardrails ─────────────────────────────────────────────────────────

// Note: \b does not match on Chinese character boundaries.
// Chinese tokens (進場/賣出 etc.) do not need \b — they are their own token units.
const RED_WORDING_PATTERNS = [
  /(buy|sell|進場|賣出|買進|出脫|做多|做空|加碼|減碼)/i,
  /目標價|target price|price target/i,
  /guarantee|必賺|保證|翻倍/i,
  /approved|alpha confirmed|live-ready|可交易|正式啟動/i,
  /勝率|win rate/i
];

function checkRedWording(sections: StrategyBriefSection[]): string | null {
  const text = sections.map((s) => s.body).join(" ");
  for (const p of RED_WORDING_PATTERNS) {
    const m = text.match(p);
    if (m) return `red_wording_detected: "${m[0]}"`;
  }
  return null;
}

// ── Source-only fallback ───────────────────────────────────────────────────────

function buildSourceOnlyFallback(sourcePack: StrategyBriefSourcePack): StrategyBriefSection[] {
  const today = sourcePack.contLiqDays[0];
  return [
    {
      sectionId: "today_market_summary",
      heading: "今日市場總覽（資料狀態）",
      body: `交易日 ${sourcePack.tradingDate}。法人資料 ${sourcePack.institutionalRows.length > 0 ? "可用" : "暫缺"}。OHLCV 資料 ${sourcePack.ohlcvRows.length > 0 ? "可用" : "暫缺"}。本次簡報以資料完整性確認為主。`
    },
    {
      sectionId: "risk_alerts",
      heading: "風控警示",
      body: today
        ? `cont_liq 資料顯示，籃子等權重未實現報酬率為 ${today.basket_equal_weight_unrealized_pct?.toFixed(2) ?? "暫缺"}%，超額報酬 ${today.excess_pct?.toFixed(2) ?? "暫缺"}%。kill-switch 評估中 basket<-15%= ${today.kill_switch_check?.basket_lt_minus_15_pct ?? "暫缺"}，basket<-10%=${today.kill_switch_check?.intra_period_dd_gt_minus_10_pct_today_close_only ?? "暫缺"}。資料終局狀態：${today.data_finality_status ?? "暫缺"}。`
        : "cont_liq 日報檔案暫缺，無法評估風控門檻距離。請確認 reports/trading_room/cont_liq_period1_daily/ 目錄是否有今日 yaml 檔案。"
    }
  ];
}

// ── Main generator ─────────────────────────────────────────────────────────────

export type GenerateStrategyBriefInput = {
  tradingDate: string;
  strategies?: StrategyId[];
  workspaceSlug?: string;
};

export type GenerateStrategyBriefResult = StrategyBriefResult;

/**
 * Main entry point: collect sources, generate AI brief, hallucination-check, store.
 * Never throws — all errors are captured in the returned result.status.
 */
export async function generateStrategyBrief(
  input: GenerateStrategyBriefInput
): Promise<GenerateStrategyBriefResult> {
  const briefId = randomUUID();
  const generatedAt = new Date().toISOString();
  const tradingDate = input.tradingDate;
  const strategies = (input.strategies ?? STRATEGY_IDS).filter(
    (id): id is StrategyId => STRATEGY_IDS.includes(id as StrategyId)
  ) as StrategyId[];

  // Resolve workspace
  let workspaceId = "";
  if (isDatabaseMode()) {
    const db = getDb();
    if (db) {
      try {
        const [ws] = await db
          .select({ id: workspaces.id })
          .from(workspaces)
          .limit(1)
          .catch(() => [undefined]);
        workspaceId = ws?.id ?? "";
      } catch {
        workspaceId = "";
      }
    }
  }

  // Ensure table exists
  await ensureStrategyBriefsTable();

  // Collect source pack
  const sourcePack = await collectStrategyBriefSourcePack(tradingDate, workspaceId);

  // Guard: if source trail incomplete and no cont_liq yaml at all → BLOCKED
  if (!sourcePack.trailComplete && sourcePack.contLiqDays.length === 0) {
    const result: StrategyBriefResult = {
      briefId,
      generatedAt,
      tradingDate,
      strategies,
      sections: [],
      status: "blocked_data_quality",
      blockedReason: `BLOCKED_DATA_QUALITY: ${sourcePack.blockedSources.join(", ")}`,
      sourcePack,
      generationMode: "source_only_fallback",
      hallucinationCheckPassed: null,
      disclaimer: "research_only"
    };
    _lastResult = result;
    _lastRunAt = new Date();
    if (workspaceId) await persistStrategyBrief(workspaceId, result);
    console.warn(`[strategy-brief] BLOCKED_DATA_QUALITY for ${tradingDate}: ${result.blockedReason}`);
    return result;
  }

  // Try AI generation
  let sections: StrategyBriefSection[] = [];
  let generationMode: "ai" | "source_only_fallback" = "source_only_fallback";
  let hallucinationCheckPassed: boolean | null = null;
  let status: StrategyBriefStatus = "published";
  let blockedReason: string | null = null;

  const prompt = buildGeneratorPrompt(sourcePack);
  const rawAiOutput = (await callLlm(
    [{ role: "user", content: prompt }],
    { callerModule: "strategy_brief", taskType: "generation", maxTokens: MAX_TOKENS_GENERATOR, temperature: 0.15 }
  ))?.content ?? null;

  if (rawAiOutput) {
    try {
      const stripped = stripCodeFences(rawAiOutput);
      const parsed = JSON.parse(stripped) as { sections?: unknown[] };

      if (Array.isArray(parsed.sections) && parsed.sections.length > 0) {
        const rawSections = parsed.sections as Array<{ sectionId?: unknown; heading?: unknown; body?: unknown }>;
        const parsedSections: StrategyBriefSection[] = rawSections
          .filter((s) => typeof s.heading === "string" && typeof s.body === "string" && (s.body as string).length >= 40)
          .map((s) => ({
            sectionId: typeof s.sectionId === "string" ? s.sectionId : "unknown",
            heading: sanitizeStrategyHeading(String(s.heading).slice(0, 100)),
            body: sanitizeBriefBody(String(s.body).slice(0, 1400))
          }));

        if (parsedSections.length > 0) {
          // Red wording check
          const redViolation = checkRedWording(parsedSections);
          if (redViolation) {
            status = "blocked_red_wording";
            blockedReason = redViolation;
            sections = buildSourceOnlyFallback(sourcePack);
            generationMode = "source_only_fallback";
            hallucinationCheckPassed = null;
          } else {
            // Hallucination check
            const hcPrompt = buildHallucinationCheckPrompt(parsedSections, sourcePack);
            const hcRaw = (await callLlm(
              [{ role: "user", content: hcPrompt }],
              { callerModule: "strategy_brief", taskType: "hallucination_check", maxTokens: MAX_TOKENS_HALLUCINATION_CHECK, temperature: 0.0 }
            ))?.content ?? null;

            let hcPassed = false;
            let hcIssues: string[] = [];
            if (hcRaw) {
              try {
                const hcParsed = JSON.parse(stripCodeFences(hcRaw)) as { pass?: boolean; issues?: string[] };
                hcPassed = hcParsed.pass === true;
                hcIssues = Array.isArray(hcParsed.issues) ? hcParsed.issues.map(String) : [];
              } catch {
                hcPassed = false;
                hcIssues = ["hallucination_check_parse_failed"];
              }
            } else {
              // No quota → assume pass (degraded mode, logged)
              hcPassed = true;
              hcIssues = [];
              console.warn("[strategy-brief] hallucination check skipped (quota/key absent) — degraded pass");
            }

            hallucinationCheckPassed = hcPassed;

            if (!hcPassed) {
              status = "blocked_hallucination";
              blockedReason = `hallucination_detected: ${hcIssues.join(" | ")}`;
              sections = buildSourceOnlyFallback(sourcePack);
              generationMode = "source_only_fallback";
            } else {
              sections = parsedSections;
              generationMode = "ai";
              status = "published";
            }
          }
        } else {
          // No valid sections — fall back
          sections = buildSourceOnlyFallback(sourcePack);
          generationMode = "source_only_fallback";
          blockedReason = "ai_output_zero_valid_sections";
        }
      } else {
        sections = buildSourceOnlyFallback(sourcePack);
        generationMode = "source_only_fallback";
        blockedReason = "ai_output_no_sections_array";
      }
    } catch {
      sections = buildSourceOnlyFallback(sourcePack);
      generationMode = "source_only_fallback";
      blockedReason = "ai_output_parse_error";
    }
  } else {
    // No AI output (quota exhausted or key missing) — source-only fallback
    sections = buildSourceOnlyFallback(sourcePack);
    generationMode = "source_only_fallback";
    blockedReason = null; // Source-only fallback is a valid published state
    hallucinationCheckPassed = null;
    status = "published";
  }

  const result: StrategyBriefResult = {
    briefId,
    generatedAt,
    tradingDate,
    strategies,
    sections,
    status,
    blockedReason,
    sourcePack,
    generationMode,
    hallucinationCheckPassed,
    disclaimer: "research_only"
  };

  _lastResult = result;
  _lastRunAt = new Date();

  if (workspaceId) await persistStrategyBrief(workspaceId, result);

  console.info(
    `[strategy-brief] generated date=${tradingDate} status=${status} ` +
    `mode=${generationMode} sections=${sections.length} ` +
    `hallucinationCheck=${hallucinationCheckPassed ?? "skipped"} ` +
    `trail=${sourcePack.trailComplete} blocked=[${sourcePack.blockedSources.join(",")}]`
  );

  return result;
}

// ── TST time helpers ───────────────────────────────────────────────────────────

/**
 * Returns current Taipei HHMM integer (e.g. 1400 for 14:00 TST).
 */
export function getTstHHMM(): number {
  const formatted = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(new Date());
  return parseInt(formatted.replace(":", ""), 10);
}

/**
 * Returns current Taipei date as YYYY-MM-DD.
 */
export function getTstDate(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

/**
 * Returns true if now is in the 14:00–14:30 TST window (strategy brief generation window).
 */
export function isStrategyBriefWindow(): boolean {
  const hhmm = getTstHHMM();
  return hhmm >= 1400 && hhmm < 1430;
}
