/**
 * candidate-pool.ts — quantitative candidate screen for AI recommendation v3 (B1)
 *
 * Yang 6/11:「不希望它亂挑亂選」. The v3 prompt previously fell back to a FIXED
 * list of 10 large caps whenever news tickers ran dry — on 6/11 all five picks
 * were simply the first five names of that list. This module replaces the fixed
 * list with a rule-based, explainable screen:
 *
 *   Screen A — 法人籌碼: 5-day aggregate institutional net buy (外資+投信+自營,
 *              tw_institutional_buysell), top N net buyers.
 *   Screen B — 量價動能: latest published TWSE EOD (STOCK_DAY_ALL), changePct
 *              ranked with a liquidity floor (成交額 ≥ 1.5 億 TWD).
 *
 * The merged pool (dedup, capped) is injected into the v3 system prompt AND
 * recorded as a round-0 reactTrace entry so every run's candidate sourcing is
 * reviewable after the fact (no black box). The legacy fixed list survives only
 * as the last-resort fallback and is flagged when used.
 *
 * Hard lines: rule-based only (no LLM), fail-open (null on total failure),
 * read-only data access.
 */

import { sql as drizzleSql } from "drizzle-orm";
import { getDb, isDatabaseMode, execRows } from "@iuf-trading-room/db";
import type { StockDayAllRow } from "../data-sources/twse-openapi-client.js";
import { parseRocEodDateIso } from "../lib/roc-date.js";

export interface QuantCandidate {
  ticker: string;
  name: string;
  reasons: string[];
}

export interface QuantCandidatePool {
  candidates: QuantCandidate[];
  /** Trading date of the EOD data used by the momentum screen (ISO), if known. */
  dataDate: string | null;
  /** Which screens contributed (e.g. ["institutional_5d", "momentum_eod"]). */
  sources: string[];
  /** True when the screen produced too few names and the caller should append the legacy fixed list. */
  fallbackNeeded: boolean;
}

const POOL_CAP = 18;
const MOMENTUM_TOP_N = 12;
const INSTITUTIONAL_TOP_N = 12;
const LIQUIDITY_FLOOR_TWD = 150_000_000; // 1.5 億成交額 — skip illiquid names
const MIN_POOL_SIZE = 5;

function parseNum(raw: string | undefined | null): number | null {
  const n = Number(String(raw ?? "").replace(/,/g, "").trim().replace(/^\+/, ""));
  return Number.isFinite(n) ? n : null;
}

// ROC date parsing delegated to the shared lib/roc-date.ts parser
// (2026-07-10 sweep, dedup of a functionally-equivalent inline copy —
// reports/ledger_stall_20260709/).
const rocDateToIso = parseRocEodDateIso;

/** Screen B — momentum + liquidity from the latest published EOD rows. Pure, testable. */
export function screenMomentumCandidates(rows: StockDayAllRow[], topN = MOMENTUM_TOP_N): {
  candidates: QuantCandidate[];
  dataDate: string | null;
} {
  const scored: Array<QuantCandidate & { changePct: number }> = [];
  let dataDate: string | null = null;

  for (const row of rows) {
    const ticker = row.Code?.trim() ?? "";
    if (!/^\d{4}$/.test(ticker)) continue; // common stocks only (no ETF/warrant suffixes)
    const close = parseNum(row.ClosingPrice);
    const change = parseNum(row.Change);
    const tradeValue = parseNum(row.TradeValue);
    if (close === null || close <= 0 || change === null || tradeValue === null) continue;
    if (tradeValue < LIQUIDITY_FLOOR_TWD) continue;
    const prevClose = close - change;
    if (prevClose <= 0) continue;
    const changePct = Math.round((change / prevClose) * 10000) / 100;
    if (changePct <= 0) continue; // momentum screen wants strength, not knife-catching
    if (!dataDate) dataDate = rocDateToIso(row.Date);
    scored.push({
      ticker,
      name: row.Name?.trim() ?? ticker,
      changePct,
      reasons: [`前一交易日 +${changePct}%、成交額 ${(tradeValue / 100_000_000).toFixed(1)} 億`],
    });
  }

  scored.sort((a, b) => b.changePct - a.changePct);
  return { candidates: scored.slice(0, topN).map(({ changePct: _c, ...rest }) => rest), dataDate };
}

/** Screen A — 5-day institutional net buy from DB. Returns [] when DB unavailable. */
async function screenInstitutionalCandidates(
  nameByTicker: Map<string, string>,
  topN = INSTITUTIONAL_TOP_N
): Promise<QuantCandidate[]> {
  try {
    if (!isDatabaseMode()) return [];
    const db = getDb();
    if (!db) return [];

    const res = await db.execute(drizzleSql`
      WITH recent_dates AS (
        SELECT DISTINCT date FROM tw_institutional_buysell ORDER BY date DESC LIMIT 5
      )
      SELECT stock_id, SUM(net_buy_sell)::bigint AS net_5d
      FROM tw_institutional_buysell
      WHERE date IN (SELECT date FROM recent_dates)
      GROUP BY stock_id
      HAVING SUM(net_buy_sell) > 0
      ORDER BY SUM(net_buy_sell) DESC
      LIMIT ${topN * 2}
    `);

    return execRows<{ stock_id: string; net_5d: string | number }>(res)
      .filter((r) => /^\d{4}$/.test(String(r.stock_id ?? "").trim()))
      .slice(0, topN)
      .map((r) => {
        const ticker = String(r.stock_id).trim();
        const lots = Math.round(Number(r.net_5d) / 1000);
        return {
          ticker,
          name: nameByTicker.get(ticker) ?? ticker,
          reasons: [`5 日法人合計淨買超約 ${lots.toLocaleString("zh-TW")} 張`],
        };
      });
  } catch (e) {
    console.warn("[candidate-pool] institutional screen failed (non-fatal):", e instanceof Error ? e.message : e);
    return [];
  }
}

/** Merge screens: institutional first (chips lead), then momentum; dedupe with reason union. */
export function mergeCandidateScreens(
  institutional: QuantCandidate[],
  momentum: QuantCandidate[],
  cap = POOL_CAP
): QuantCandidate[] {
  const byTicker = new Map<string, QuantCandidate>();
  for (const c of [...institutional, ...momentum]) {
    const existing = byTicker.get(c.ticker);
    if (existing) {
      existing.reasons = [...existing.reasons, ...c.reasons];
    } else if (byTicker.size < cap) {
      byTicker.set(c.ticker, { ...c, reasons: [...c.reasons] });
    } else {
      // pool full — still merge reasons for names already in
      continue;
    }
  }
  return [...byTicker.values()];
}

/**
 * Build the candidate pool. `stockRowsOverride` allows tests to inject EOD rows
 * (the production path reads the shared STOCK_DAY_ALL cache).
 */
export async function buildQuantCandidatePool(
  stockRowsOverride?: StockDayAllRow[]
): Promise<QuantCandidatePool | null> {
  try {
    let rows = stockRowsOverride;
    if (!rows) {
      const { getStockDayAllRows } = await import("../data-sources/twse-openapi-client.js");
      rows = await getStockDayAllRows();
    }

    const { candidates: momentum, dataDate } = screenMomentumCandidates(rows ?? []);
    const nameByTicker = new Map((rows ?? []).map((r) => [r.Code?.trim() ?? "", r.Name?.trim() ?? ""]));
    const institutional = await screenInstitutionalCandidates(nameByTicker);

    const merged = mergeCandidateScreens(institutional, momentum);
    const sources: string[] = [];
    if (institutional.length > 0) sources.push("institutional_5d");
    if (momentum.length > 0) sources.push("momentum_eod");

    return {
      candidates: merged,
      dataDate,
      sources,
      fallbackNeeded: merged.length < MIN_POOL_SIZE,
    };
  } catch (e) {
    console.warn("[candidate-pool] build failed (non-fatal):", e instanceof Error ? e.message : e);
    return null;
  }
}

/** Render the pool as the prompt block consumed by buildV3SystemPrompt. */
export function renderCandidatePoolBlock(pool: QuantCandidatePool | null, legacyListLine: string): string {
  if (!pool || pool.candidates.length === 0 || pool.fallbackNeeded) {
    return `核心候選清單（量化掃盤本日無足夠結果 — 使用固定後備清單，fallback）：\n  ${legacyListLine}`;
  }
  const lines = pool.candidates
    .map((c) => `  - ${c.ticker}（${c.name}）｜${c.reasons.join("；")}`)
    .join("\n");
  return `核心候選清單（量化掃盤產生${pool.dataDate ? `，資料日期 ${pool.dataDate}` : ""}；依 5 日法人淨買超與前一交易日量價動能篩選，優先深入分析這些標的）：\n${lines}\n  後備清單（僅當上列全部查無技術資料時才使用）：${legacyListLine}`;
}
