/**
 * orchestrator-v3.ts — AI Recommendation v3: Yang SOP 5-Module / 7 Sub-Score
 *
 * Architecture (v3 upgrade from v2):
 *   [STEP 1 市場狀態] → [STEP 2 主題穿透] → [STEP 3 個股 7 sub-score] →
 *   [STEP 4 Bucket A+/A/B/C] → [STEP 5 進場/TP/SL 結構]
 *
 * Key changes vs v2:
 *   - systemPrompt: strict 5-module SOP (not generic "recommend 5-10 stocks")
 *   - risk_off_score >= 3 → return market-skip immediately (no items)
 *   - event day multiplier 0.5 applied to position sizing
 *   - synthesizeReport: mandates 7 sub-score table + bucket + entry/TP/SL in markdown
 *   - parseAiReportToRecommendationsV3: extracts all v3 fields from structured markdown
 *
 * v2 endpoint (/api/v1/ai-recommendations) is NOT modified — fully parallel.
 * v3 endpoint: GET/POST /api/v1/ai-recommendations/v3
 *
 * Lane boundary: no risk/broker/frontend changes. Read-only ReAct.
 */

import { randomUUID } from "crypto";
import type {
  AiStockRecommendationV2,
  AiRecMarketState,
  AiRecBucket,
} from "@iuf-trading-room/contracts";
import { callTool } from "../tools/tool-registry-store.js";
import {
  getMarketOverview,
  getSectorRotation,
  getCompanyTechnical,
  getInstitutionalFlow,
  getNewsTop10,
} from "../tools/market-data-tools.js";

// ── F1: Programmatic risk_off_score (deterministic — LLM cannot override) ─────

/**
 * Compute a programmatic risk_off_score BEFORE firing the LLM.
 *
 * 6 signals (楊董 SOP):
 *   S1: VIX > 25
 *   S2: VIX 5d change > 30%
 *   S3: DXY 60d Z-score > 1
 *   S4: US 10Y 20d rise > 25bp
 *   S5: WTI 10d rise > 10%
 *   S6: TAIEX < EMA60
 *
 * S1-S5 require external data sources not available in TWSE — fail-open (score=0).
 * S6 is computed from TWSE StockDay index level + EMA proxy.
 *
 * Fail-open contract: if any signal data is unavailable → signal = 0 (not 1).
 * This means programmatic score can only BLOCK when we have positive evidence.
 * A score of 0 means "data unavailable, do not block" — LLM still runs.
 *
 * Returns { score, signals, taiexIndex, taiexChangePct }
 */
export interface ProgrammaticRiskOffResult {
  score: number;
  signals: {
    vixAbove25: boolean;
    vix5dSpike: boolean;
    dxy60dZHigh: boolean;
    tenY20dUp: boolean;
    wti10dUp: boolean;
    taiexBelowEma60: boolean;
  };
  taiexIndex: number | null;
  taiexChangePct: number | null;
  dataSource: string;
  computedAt: string;
}

export async function computeProgrammaticRiskOffScore(): Promise<ProgrammaticRiskOffResult> {
  const result: ProgrammaticRiskOffResult = {
    score: 0,
    signals: {
      vixAbove25: false,
      vix5dSpike: false,
      dxy60dZHigh: false,
      tenY20dUp: false,
      wti10dUp: false,
      taiexBelowEma60: false,
    },
    taiexIndex: null,
    taiexChangePct: null,
    dataSource: "twse_openapi",
    computedAt: new Date().toISOString(),
  };

  try {
    // S1-S5: External data (VIX/DXY/10Y/WTI) — not available from TWSE.
    // These remain false (score=0) — fail-open.
    // TODO: wire Yahoo Finance or FRED API for these signals when available.

    // S6: TAIEX < EMA60
    // Use TWSE StockDay closing index to compute EMA60 proxy from index history.
    // Currently we only have today's close from MI_5MINS_INDEX — not enough for EMA60.
    // Fail-open: S6 = false when historical index data unavailable.
    const overview = await getMarketOverview();
    if (overview.taiex) {
      result.taiexIndex = overview.taiex.index;
      result.taiexChangePct = overview.taiex.changePct;

      // Try to compute EMA60 from DB if OHLCV index data exists
      // Fail-open: if no historical data, S6 = false
      const ema60 = await computeTaiexEma60FromDb();
      if (ema60 !== null && result.taiexIndex !== null && result.taiexIndex < ema60) {
        result.signals.taiexBelowEma60 = true;
        result.score += 1;
        console.info(`[v3-risk-off] S6 TAIEX(${result.taiexIndex}) < EMA60(${ema60}) → +1`);
      }
    }
  } catch (err) {
    console.warn("[v3-risk-off] computeProgrammaticRiskOffScore error:", err instanceof Error ? err.message : String(err));
  }

  console.info(`[v3-risk-off] programmatic risk_off_score = ${result.score}/6 (S1-S5 unavailable, S6 computed)`);
  return result;
}

/**
 * Compute TAIEX EMA60 from DB companies_ohlcv index data if available.
 * Uses index-level data if present, otherwise returns null (fail-open).
 */
async function computeTaiexEma60FromDb(): Promise<number | null> {
  try {
    const { getDb, isDatabaseMode } = await import("@iuf-trading-room/db");
    if (!isDatabaseMode()) return null;
    const db = getDb();
    if (!db) return null;

    const { sql } = await import("drizzle-orm");
    // Query TAIEX index history from DB if available (ticker = "^TWII" or "TAIEX")
    const rows = (await db.execute(sql`
      SELECT o.close AS close
      FROM companies_ohlcv o
      INNER JOIN companies c ON c.id = o.company_id
      WHERE (c.ticker = 'TAIEX' OR c.ticker = '^TWII' OR c.ticker = '0000')
        AND o.interval = '1d'
      ORDER BY o.dt DESC
      LIMIT 60
    `)) as unknown as { rows: Array<{ close: string }> };

    const closes = (rows.rows ?? [])
      .map(r => parseFloat(r.close))
      .filter(v => !isNaN(v) && v > 0);

    if (closes.length < 20) return null; // not enough data

    // Simple EMA60 (or EMA<N> with what we have)
    const n = Math.min(60, closes.length);
    const reversed = closes.slice(0, n).reverse(); // ascending
    const k = 2 / (n + 1);
    let ema = reversed[0]!;
    for (let i = 1; i < reversed.length; i++) {
      ema = reversed[i]! * k + ema * (1 - k);
    }
    return Math.round(ema * 100) / 100;
  } catch {
    return null;
  }
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type AiRecTrigger = "cron_0930" | "cron_1300" | "manual_refresh" | "test";

export interface AiRecommendationV3RunOptions {
  workspaceId?: string | null;
  trigger?: AiRecTrigger;
  maxRounds?: number;
  costCapUsd?: number;
  runId?: string;
  dateStr?: string;
}

export interface AiRecommendationV3RunResult {
  runId: string;
  status: "complete" | "failed" | "budget_exceeded" | "market_risk_off" | "insufficient_tools" | "synthesis_format_error";
  generatedAt: string;
  items: AiStockRecommendationV2[];
  reactTrace: unknown[];
  finalReportMarkdown: string;
  totalCostUsd: number;
  totalTokens: number;
  marketState: AiRecMarketState | null;
  marketRiskOffScore: number | null;
  /** programmatic risk_off computation result (F1) */
  programmaticRiskOff: ProgrammaticRiskOffResult | null;
  synthesisRetryUsed?: boolean;
  synthesisFallbackUsed?: boolean;
  dbRowId: string | null;
}

// ── In-memory cache (latest v3 run) ──────────────────────────────────────────

let _latestV3Cache: AiRecommendationV3RunResult | null = null;
let _latestV3CacheExpiresAt = 0;
const V3_CACHE_TTL_MS = 5 * 60 * 1000;
const MIN_V3_RECOMMENDATION_ITEMS = 5;
const MIN_V3_TECHNICAL_CALLS = 5;

export function getLatestAiRecommendationV3Run(): AiRecommendationV3RunResult | null {
  if (_latestV3Cache && Date.now() < _latestV3CacheExpiresAt) {
    return _latestV3Cache;
  }
  return null;
}

const V3_TRIGGER_SUFFIX = ":v3";

function v3DbTrigger(trigger: AiRecTrigger): string {
  return `${trigger}${V3_TRIGGER_SUFFIX}`;
}

async function persistV3RunStart(opts: {
  id: string;
  runId: string;
  workspaceId?: string | null;
  trigger: AiRecTrigger;
  model: string;
}): Promise<void> {
  try {
    const { getDb, isDatabaseMode, aiRecommendationsRuns } = await import("@iuf-trading-room/db");
    if (!isDatabaseMode()) return;
    const db = getDb();
    if (!db) return;
    await db.insert(aiRecommendationsRuns).values({
      id: opts.id,
      runId: opts.runId,
      workspaceId: opts.workspaceId ?? null,
      status: "running",
      trigger: v3DbTrigger(opts.trigger),
      model: opts.model,
      items: [],
      reactTrace: [],
    });
  } catch (e) {
    console.warn("[ai-rec-v3] persistV3RunStart failed:", e instanceof Error ? e.message : e);
  }
}

async function persistV3RunComplete(result: AiRecommendationV3RunResult, model: string): Promise<void> {
  if (!result.dbRowId) return;
  try {
    const { getDb, isDatabaseMode, aiRecommendationsRuns } = await import("@iuf-trading-room/db");
    if (!isDatabaseMode()) return;
    const db = getDb();
    if (!db) return;
    const { eq } = await import("drizzle-orm");
    await db
      .update(aiRecommendationsRuns)
      .set({
        status: result.status,
        items: result.items as unknown[],
        reactTrace: result.reactTrace,
        finalReportMarkdown: result.finalReportMarkdown,
        costUsd: result.totalCostUsd.toFixed(8),
        totalTokens: result.totalTokens,
        model,
        completedAt: new Date(),
      })
      .where(eq(aiRecommendationsRuns.id, result.dbRowId));
  } catch (e) {
    console.warn("[ai-rec-v3] persistV3RunComplete failed:", e instanceof Error ? e.message : e);
  }
}

async function finalizeV3Run(result: AiRecommendationV3RunResult, model: string): Promise<AiRecommendationV3RunResult> {
  await persistV3RunComplete(result, model);
  _latestV3Cache = result;
  _latestV3CacheExpiresAt = Date.now() + V3_CACHE_TTL_MS;
  return result;
}

export async function loadLatestAiRecommendationV3RunFromDb(): Promise<AiRecommendationV3RunResult | null> {
  try {
    const { getDb, isDatabaseMode, aiRecommendationsRuns } = await import("@iuf-trading-room/db");
    if (!isDatabaseMode()) return null;
    const db = getDb();
    if (!db) return null;
    const { desc, sql } = await import("drizzle-orm");
    const rows = await db
      .select()
      .from(aiRecommendationsRuns)
      .where(sql`${aiRecommendationsRuns.trigger} like ${`%${V3_TRIGGER_SUFFIX}`}`)
      .orderBy(desc(aiRecommendationsRuns.generatedAt))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return {
      runId: row.runId,
      status: row.status as AiRecommendationV3RunResult["status"],
      generatedAt: row.generatedAt.toISOString(),
      items: (row.items ?? []) as AiStockRecommendationV2[],
      reactTrace: (row.reactTrace ?? []) as unknown[],
      finalReportMarkdown: row.finalReportMarkdown ?? "",
      totalCostUsd: Number(row.costUsd ?? 0),
      totalTokens: row.totalTokens ?? 0,
      marketState: null,
      marketRiskOffScore: null,
      programmaticRiskOff: null,
      synthesisRetryUsed: false,
      synthesisFallbackUsed:
        row.status === "synthesis_format_error" &&
        ((row.items ?? []) as unknown[]).length >= MIN_V3_RECOMMENDATION_ITEMS,
      dbRowId: row.id,
    };
  } catch (e) {
    console.warn("[ai-rec-v3] loadLatestAiRecommendationV3RunFromDb failed:", e instanceof Error ? e.message : e);
    return null;
  }
}

export async function getLatestAiRecommendationV3RunForRead(): Promise<AiRecommendationV3RunResult | null> {
  const cached = getLatestAiRecommendationV3Run();
  if (cached) return cached;
  const dbRun = await loadLatestAiRecommendationV3RunFromDb();
  if (!dbRun) return null;
  _latestV3Cache = dbRun;
  _latestV3CacheExpiresAt = Date.now() + V3_CACHE_TTL_MS;
  return dbRun;
}

export function _resetAiRecommendationV3Cache(): void {
  _latestV3Cache = null;
  _latestV3CacheExpiresAt = 0;
}

// ── Date helper ───────────────────────────────────────────────────────────────

function todayTst(): string {
  const now = new Date(Date.now() + 8 * 60 * 60 * 1000);
  return now.toISOString().slice(0, 10);
}

// ── Tool whitelist ────────────────────────────────────────────────────────────

const TOOL_WHITELIST_V3 = [
  "get_market_overview",
  "get_sector_rotation",
  "get_company_technical",
  "get_institutional_flow",
  "get_news_top10",
] as const;

// ── dispatchTool ──────────────────────────────────────────────────────────────

async function dispatchMarketToolV3(
  toolName: string,
  toolInput: unknown,
  workspaceId?: string | null
): Promise<unknown> {
  return callTool(toolName, "brain_react", workspaceId, toolInput, async (input) => {
    switch (toolName) {
      case "get_market_overview":
        return getMarketOverview();
      case "get_sector_rotation": {
        const inp = input as { limit?: number } | null;
        return getSectorRotation(inp?.limit ?? 20);
      }
      case "get_company_technical": {
        const inp = input as { ticker?: string } | null;
        if (!inp?.ticker) return { error: "ticker_required" };
        return getCompanyTechnical(inp.ticker);
      }
      case "get_institutional_flow": {
        const inp = input as { ticker?: string } | null;
        if (!inp?.ticker) return { error: "ticker_required" };
        return getInstitutionalFlow(inp.ticker);
      }
      case "get_news_top10":
        return getNewsTop10();
      default:
        throw new Error(`TOOL_NOT_FOUND: ${toolName} not in v3 whitelist`);
    }
  });
}

// ── Yang SOP system prompt (5-module strict) ──────────────────────────────────

function buildV3SystemPrompt(dateStr: string, programmaticRiskOffScore: number): string {
  const riskOffContext = `
=== SYSTEM-PROVIDED risk_off_score (DETERMINISTIC — DO NOT OVERRIDE) ===
系統已計算 programmatic risk_off_score = ${programmaticRiskOffScore}/6（基於可用市場資料）。
${programmaticRiskOffScore >= 3
  ? `risk_off_score >= 3 → 你必須回傳 RISK_OFF_SKIP，不推薦任何新倉。`
  : `risk_off_score < 3 → 你必須完整執行 STEP 2-5，輸出 ≥${MIN_V3_RECOMMENDATION_ITEMS} 檔推薦（A+/A/B/C bucket）。
你不可自行判斷 risk-off 並 skip STEP 2-5。即使大盤單日跌 0.5%-1%，也必須繼續分析。
若輸出推薦數 < ${MIN_V3_RECOMMENDATION_ITEMS}，系統會自動 reject 並標記 insufficient_tools / synthesis_format_error。`}
=== END SYSTEM CONTEXT ===
`;

  return `你是 IUF 台股操盤師 AI，嚴格按楊董 SOP 5-module 框架執行推薦分析。
今天是 ${dateStr}（台北時間）。
${riskOffContext}
你有以下工具可用：${TOOL_WHITELIST_V3.join(", ")}

---
[STEP 1] 市場狀態（前置條件 — 必須最先執行）
  先 callTool(get_market_overview)，從回傳資料補充確認市場狀態。
  trend_score = 1[C>EMA20] + 1[EMA20>EMA60] + 1[EMA60>EMA120] + 1[ADX14>22] + 1[RS20>0]（滿分5）
  range_score = 1[|C-EMA60|/EMA60<5%] + 1[ADX14<18] + 1[BBWidth<40pct]（滿分3）

  判斷優先序：risk-off > event > trend > range
  ★★ CRITICAL: 系統 programmatic risk_off_score = ${programmaticRiskOffScore}。
  ${programmaticRiskOffScore >= 3
    ? "risk_off_score >= 3 → 你必須在第一輪 toolName=null，thought 包含「RISK_OFF_SKIP」。"
    : `risk_off_score < 3 → 你絕對不可 RISK_OFF_SKIP。必須執行完整 STEP 2-5。
  若 event日（FOMC/CPI/法說 T-2~T+1 或振幅>2*ATR20）→ 市場狀態設 event，倉位倍率 0.5，但仍推薦。`}

[STEP 2] 主題穿透（risk_off_score < 3 時強制執行）
  callTool(get_news_top10) 識別當前強勢主題
  callTool(get_sector_rotation) 找資金流入板塊
  根據楊董 4 層產業鏈框架定位標的：
    第一層龍頭（8分）| 第二層系統/模組（14分）| 第三層關鍵零件（16分）| 材料/設備（20分）
  排除「已 price in」：法人連5日大量買超且股價20日漲>30% 的公司直接跳過

[STEP 3] 個股 7 sub-score（每候選股 0-100 合計）
  ★★ 必須至少呼叫 get_company_technical ${MIN_V3_TECHNICAL_CALLS} 次（不同 ticker）。
  每個推薦標的都需要 get_company_technical 工具支撐，否則視為未驗證無效。
  若 STEP 2 的新聞或板塊資料沒有可用候選，禁止亂猜冷門代碼；請依序檢查這組核心候選：
  2330、2454、2317、2308、2412、3711、3707、2882、2881、6505。
  - 主題位置 /20（依 STEP 2 產業鏈層位判定）
  - 營收/財報 /15（近3月YoY正且至少2月加速 → 滿分；只1月加速 → 8分；負成長 → 0）
  - 法人/ETF /15（5日外資+投信同向淨買超/20均量 > 0.5 → 滿；單向 → 8；流出 → 0）
  - 融資/借券/擁擠 /15（融資5日降溫 → 滿；持平 → 8；5日增>12%且股價漲>15% → 扣分至0）
  - 相對強弱量能 /10（RS20>0且突破量>1.3均量 → 滿；RS正但量不足 → 5；RS負 → 0）
  - 技術結構 /20（BOS+OB/FVG+OTE重疊3項以上 → 滿；2項 → 12；1項 → 6；無 → 0）
  - 估值/事件 /5（法說/除息/注意股等加減分）
  totalScore = 7個分數相加，最大100

[STEP 4] Bucket assign（依 totalScore）
  totalScore >= 85 → A+ 今日首選（0.8% NAV）
  75–84 → A 可觀察布局（0.6% NAV）
  65–74 → B 等回檔（0.4% NAV）
  < 65 → C 高風險排除（不開新倉）

[STEP 5] 每檔輸出（C bucket 也必須輸出，但標示高風險排除）
  ★★ 最終輸出必須包含 ≥${MIN_V3_RECOMMENDATION_ITEMS} 檔真實資料支撐的 A+/A/B/C 卡片（否則系統拒絕此次分析）。
  ★★ PARSER 格式規則（必須遵守，否則解析失敗）：
     - 每檔 heading 必須是「## XXXX 公司名」（兩個#，空格，4位數ticker，空格，中文名）
     - 不得用 ###、#### 或 **ticker** bold heading
     - 不得在 ticker heading 前後穿插任何非 ticker heading（例如 ## 市場分析 會被誤解析）
     - 所有欄位用「- 欄位名: 值」bullet 格式，不得用 markdown table
  格式嚴格如下（解析器依賴此格式）：
  進場區：OTE 0.618-0.705 回踩（具體價格區間）或突破後回測不破
  TP1：前波高 or 整數關（具體價格）
  TP2：月線上緣 or 年線頂部（具體價格）
  SL：結構失效點外 0.5 ATR（具體價格），上限 8%
  R值：(TP1-進場中點)/(進場中點-SL)
  信心：0.0-1.0

---
回應格式（每輪 JSON，無 markdown 包裝）：
{"thought": "<1-3句分析>", "toolName": "<工具名稱 or null>", "toolInput": <{...} or null>}

規則：
- 先完成 STEP 1（market overview），再 STEP 2（news+sector），再 STEP 3（技術/法人個股，≥5次）
- 至少執行7輪工具呼叫再給最終答案（1次overview + 1次news + 1次sector + 5次company_technical）
- 最終答案時 toolName=null，thought 包含完整分析摘要
- ★★ 禁止在 risk_off_score < 3 時使用 RISK_OFF_SKIP（系統已驗證，LLM 不可 override）`;
}

// ── Yang SOP synthesis prompt ──────────────────────────────────────────────────

function buildV3SynthesisPrompt(traceText: string, dateStr: string): string {
  return `你是 IUF 台股操盤師 AI，請根據以下 ReAct 分析過程，輸出符合楊董 SOP 的個股推薦報告（${dateStr}）。

## 分析過程
${traceText}

---
請為每支推薦股票（bucket != C）輸出以下嚴格格式：

## [ticker] [公司名稱]
- 分類: [A+今日首選 | A可觀察布局 | B等回檔 | C高風險排除]
- 總分: [0-100整數]
- 市場狀態: [risk_off | event | trend | range]
- 主題位置分: [0-20]
- 營收財報分: [0-15]
- 法人ETF分: [0-15]
- 融資借券分: [0-15]
- 相對強弱量能分: [0-10]
- 技術結構分: [0-20]
- 估值事件分: [0-5]
- 進場區: [低-高，例如 870-890]
- 進場理由: [OTE 0.618-0.705 / 突破後回測不破 / 其他]
- TP1: [具體價格]
- TP1理由: [前波高/整數關等]
- TP2: [具體價格]
- TP2理由: [月線上緣/年線等]
- 停損: [具體價格]
- ATR倍數: [0.5]
- R值: [計算值]
- 信心: [0.0-1.0]
- 為什麼買: [具體bull thesis，至少2點]
- 為什麼不買: [具體bear case/風險，至少2點]
- NAV比重: [0.8% | 0.6% | 0.4% | 0%]
- 市場倍率: [1.0 | 0.9 | 0.7 | 0.6 | 0.5 | 0.4 | 0.3 | 0]

推薦 A+/A/B 的股票，不要輸出 C 分類。
若 risk_off_score >= 3，只輸出純文字「RISK_OFF_FINAL_SKIP」後接一行說明原因，不推薦任何股票，不要輸出任何 ## 股票 heading。
使用真實市場資料（來自 ReAct trace），不要捏造數字。`;
}

// ── Markdown parser v3 ────────────────────────────────────────────────────────

function parseFloat2v3(s: string | undefined): number | null {
  if (!s) return null;
  const n = parseFloat(s.replace(/[^\d.]/g, ""));
  return isNaN(n) ? null : n;
}

function extractPriceRangeV3(line: string): { low: number | null; high: number | null } {
  const m = line.match(/(\d+(?:\.\d+)?)\s*[-~～至到]\s*(\d+(?:\.\d+)?)/);
  if (m) return { low: parseFloat2v3(m[1]), high: parseFloat2v3(m[2]) };
  const single = line.match(/(\d{2,5}(?:\.\d+)?)/);
  if (single) {
    const v = parseFloat2v3(single[1]);
    return { low: v, high: v };
  }
  return { low: null, high: null };
}

function parseBucket(text: string): { bucket: AiRecBucket; action: AiStockRecommendationV2["action"] } {
  if (/A\+|A\+今日首選/.test(text) || /今日首選/.test(text)) {
    return { bucket: "A+", action: "今日首選" };
  }
  if (/^A可觀察|A 可觀察|A(?:\s|$)/.test(text) && !/A\+/.test(text)) {
    return { bucket: "A", action: "可觀察布局（研究參考）" };
  }
  if (/B等回檔|B 等回檔|等回檔/.test(text)) {
    return { bucket: "B", action: "等回檔" };
  }
  if (/C高風險|C 高風險|高風險排除/.test(text)) {
    return { bucket: "C", action: "高風險排除" };
  }
  // Fallback inference from 分類 line
  if (/今日首選/.test(text)) return { bucket: "A+", action: "今日首選" };
  if (/可觀察/.test(text)) return { bucket: "A", action: "可觀察布局（研究參考）" };
  if (/等回檔/.test(text)) return { bucket: "B", action: "等回檔" };
  return { bucket: "C", action: "高風險排除" };
}

function parseMarketStateV3(text: string): AiRecMarketState {
  if (/risk_off/.test(text)) return "risk_off";
  if (/event/.test(text)) return "event";
  if (/trend/.test(text)) return "trend";
  return "range";
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function roundPrice(value: number): number {
  return Math.round(value * 100) / 100;
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toBool(value: unknown): boolean {
  return value === true || value === "true" || value === 1 || value === "1";
}

const CORE_COMPANY_NAMES: Record<string, string> = {
  "2330": "台積電",
  "2454": "聯發科",
  "2317": "鴻海",
  "2308": "台達電",
  "2412": "中華電",
  "3711": "日月光投控",
  "3707": "漢磊",
  "2882": "國泰金",
  "2881": "富邦金",
  "6505": "台塑化",
};

interface TechnicalObservationForFallback {
  ticker: string;
  companyName: string | null;
  lastPrice: number;
  changePct: number | null;
  rsi14: number | null;
  ma20: number | null;
  ma60: number | null;
  volumeRatio20d: number | null;
  aboveMa20: boolean;
  aboveMa60: boolean;
  source: string | null;
}

function extractTechnicalObservationForFallback(step: V3ReActStep): TechnicalObservationForFallback | null {
  if (step.toolName !== "get_company_technical") return null;
  if (!step.observation || typeof step.observation !== "object") return null;

  const obs = step.observation as Record<string, unknown>;
  const ticker = typeof obs["ticker"] === "string" ? obs["ticker"] : null;
  const lastPrice = toFiniteNumber(obs["lastPrice"]);
  if (!ticker || lastPrice === null || lastPrice <= 0) return null;

  return {
    ticker,
    companyName: typeof obs["companyName"] === "string" && obs["companyName"].trim()
      ? obs["companyName"].trim()
      : null,
    lastPrice,
    changePct: toFiniteNumber(obs["changePct"]),
    rsi14: toFiniteNumber(obs["rsi14"]),
    ma20: toFiniteNumber(obs["ma20"]),
    ma60: toFiniteNumber(obs["ma60"]),
    volumeRatio20d: toFiniteNumber(obs["volumeRatio20d"]),
    aboveMa20: toBool(obs["aboveMa20"]),
    aboveMa60: toBool(obs["aboveMa60"]),
    source: typeof obs["source"] === "string" ? obs["source"] : null,
  };
}

function technicalFallbackRank(obs: TechnicalObservationForFallback): number {
  let score = 50;
  if (obs.aboveMa20) score += 10;
  if (obs.aboveMa60) score += 10;
  if ((obs.changePct ?? 0) > 0) score += 5;
  if (obs.rsi14 !== null && obs.rsi14 >= 45 && obs.rsi14 <= 75) score += 8;
  if (obs.volumeRatio20d !== null && obs.volumeRatio20d >= 0.5) score += 5;
  if (obs.volumeRatio20d !== null && obs.volumeRatio20d > 1.5) score -= 5;
  return clampNumber(score, 0, 100);
}

export function buildDeterministicFallbackItemsFromTrace(
  trace: V3ReActStep[],
  dateStr: string,
  marketState: AiRecMarketState
): AiStockRecommendationV2[] {
  const byTicker = new Map<string, TechnicalObservationForFallback>();
  for (const step of trace) {
    const obs = extractTechnicalObservationForFallback(step);
    if (!obs) continue;
    if (!byTicker.has(obs.ticker)) byTicker.set(obs.ticker, obs);
  }

  return Array.from(byTicker.values())
    .map((obs) => ({ obs, rank: technicalFallbackRank(obs) }))
    .sort((a, b) =>
      b.rank - a.rank ||
      (b.obs.changePct ?? -999) - (a.obs.changePct ?? -999) ||
      a.obs.ticker.localeCompare(b.obs.ticker)
    )
    .slice(0, MIN_V3_RECOMMENDATION_ITEMS)
    .map(({ obs, rank }) => {
      const technical = clampNumber(
        8 +
          (obs.aboveMa20 ? 4 : 0) +
          (obs.aboveMa60 ? 4 : 0) +
          (obs.rsi14 !== null && obs.rsi14 >= 45 && obs.rsi14 <= 75 ? 2 : 0) +
          (obs.volumeRatio20d !== null && obs.volumeRatio20d >= 0.5 ? 2 : 0),
        0,
        20
      );
      const rs = (obs.changePct ?? 0) > 0 ? 8 : (obs.changePct ?? 0) >= 0 ? 6 : 5;
      const subScores = {
        theme: 15,
        revenue: 8,
        institutional: 8,
        margin: 8,
        rs,
        technical,
        valuation: 3,
      };
      const totalScore = subScores.theme + subScores.revenue + subScores.institutional +
        subScores.margin + subScores.rs + subScores.technical + subScores.valuation;
      const bucket: AiRecBucket =
        totalScore >= 82 ? "A+" : totalScore >= 75 ? "A" : totalScore >= 60 ? "B" : "C";
      const action: AiStockRecommendationV2["action"] =
        bucket === "A+" ? "今日首選" :
        bucket === "A" ? "可觀察布局（研究參考）" :
        bucket === "B" ? "等回檔" : "高風險排除";

      const entryLow = roundPrice(obs.lastPrice * 0.98);
      const entryHigh = roundPrice(obs.lastPrice * 1.01);
      const entryMid = (entryLow + entryHigh) / 2;
      const tp1 = roundPrice(obs.lastPrice * 1.05);
      const tp2 = roundPrice(obs.lastPrice * 1.1);
      const stopLoss = roundPrice(obs.lastPrice * 0.94);
      const downside = Math.max(0.01, entryMid - stopLoss);
      const upside = Math.max(0.01, tp1 - entryMid);

      return {
        id: randomUUID(),
        ticker: obs.ticker,
        companyName: obs.companyName ?? CORE_COMPANY_NAMES[obs.ticker] ?? obs.ticker,
        action,
        date: dateStr,
        confidence: bucket === "A" ? 0.68 : 0.56,
        rationale:
          `Deterministic fallback from verified get_company_technical data. ` +
          `rank=${rank}, lastPrice=${obs.lastPrice}, changePct=${obs.changePct ?? "n/a"}, ` +
          `aboveMa20=${obs.aboveMa20}, aboveMa60=${obs.aboveMa60}, rsi14=${obs.rsi14 ?? "n/a"}.`,
        entryPriceRange: { low: entryLow, high: entryHigh },
        tp1,
        tp2,
        stopLoss,
        aiGenerated: true,
        source: "brain_react_v2",
        marketState,
        subScores,
        totalScore,
        bucket,
        entryZone: {
          low: entryLow,
          high: entryHigh,
          reason: "Programmatic fallback range: 0.98x-1.01x of verified lastPrice.",
        },
        tp1Structured: {
          price: tp1,
          reason: "Conservative +5% first target from verified lastPrice.",
        },
        tp2Structured: {
          price: tp2,
          reason: "Stretch +10% second target from verified lastPrice.",
        },
        stopLossStructured: {
          price: stopLoss,
          atr_multiple: 0.5,
        },
        r_ratio: roundPrice(upside / downside),
        position_sizing: {
          nav_pct: bucket === "A+" ? 0.008 : bucket === "A" ? 0.006 : bucket === "B" ? 0.004 : 0,
          market_multiplier: marketState === "event" ? 0.5 : marketState === "range" ? 0.7 : 1,
        },
        why_buy: [
          "Verified technical data was available from get_company_technical.",
          obs.aboveMa20 ? "Price is above MA20." : "Price is not above MA20; keep sizing conservative.",
          obs.aboveMa60 ? "Price is above MA60." : "Price is not above MA60; keep sizing conservative.",
        ],
        why_not_buy: [
          "This is a deterministic fallback because the LLM did not return enough structured picks.",
          "Treat as research candidates until the full AI narrative is healthy.",
        ],
      };
    });
}

/**
 * parseAiReportToRecommendationsV3
 *
 * Parses structured markdown report from synthesizeReportV3 into AiStockRecommendationV2[]
 * with v3 fields (subScores, bucket, entryZone, tp1Structured, tp2Structured, etc.)
 *
 * Expected block format:
 *   ## XXXX 公司名
 *   - 分類: A+今日首選
 *   - 總分: 88
 *   - 主題位置分: 18
 *   - 進場區: 870-890
 *   - TP1: 920
 *   - ...
 */
export function parseAiReportToRecommendationsV3(
  markdown: string,
  dateStr: string
): AiStockRecommendationV2[] {
  const results: AiStockRecommendationV2[] = [];
  if (!markdown || markdown.trim().length === 0) return results;

  // Check if market is risk-off (AI returned explicit skip signal).
  //
  // IMPORTANT: Only treat as risk-off if the markdown contains an explicit
  // RISK_OFF_FINAL_SKIP sentinel OR if it contains "RISK_OFF_SKIP" AND has
  // no stock headings at all (## \d{4}).  The old check triggered on any
  // "市場 risk-off" substring, which false-positives on the synthesis section
  // header "## 市場 risk-off 分析" that LLM legitimately writes as a preamble
  // before recommending stocks — root cause of usedFallback=true ~50% runs.
  const hasStockHeadings = /^#{2,6}\s*(?:\*\*)?\d{4,6}[A-Z]?(?:\*\*)?\b/m.test(markdown);
  const isExplicitSkip = /RISK_OFF_FINAL_SKIP/.test(markdown) ||
    (/RISK_OFF_SKIP/.test(markdown) && !hasStockHeadings);
  if (isExplicitSkip) {
    return results; // Empty — genuine risk-off skip
  }

  const stockBlockStartRe = /(?=^(?:#{2,6}\s*|\d+\.\s*|[-*]\s*)?(?:\*\*)?\d{4,6}[A-Z]?(?:\*\*)?\b)/m;
  const stockBlockTickerRe = /^(?:#{2,6}\s*|\d+\.\s*|[-*]\s*)?(?:\*\*)?(\d{4,6}[A-Z]?)(?:\*\*)?\b/m;
  const yearTickerRe = /^(201\d|202[0-9]|203[0-5])$/;
  const stockBlocks = markdown.split(stockBlockStartRe);

  for (const block of stockBlocks) {
    if (!block.trim()) continue;

    const headerLine = block.split("\n").find(line => stockBlockTickerRe.test(line)) ?? "";
    const tickerMatch = headerLine.match(stockBlockTickerRe);
    if (!tickerMatch) continue;
    const ticker = tickerMatch[1]!;
    if (yearTickerRe.test(ticker)) continue;

    const nameSource = headerLine.replace(/\*/g, "");
    const nameMatch = nameSource.match(new RegExp(ticker + "\\s+([\\u4e00-\\u9fff\\w\\s]{2,20})"));
    const companyName = nameMatch ? nameMatch[1]!.trim() : ticker;

    const lines = block.split("\n");

    // v3 fields
    let bucketResult: { bucket: AiRecBucket; action: AiStockRecommendationV2["action"] } = {
      bucket: "B",
      action: "等回檔",
    };
    let totalScore: number | null = null;
    let marketState: AiRecMarketState = "trend";
    let themeScore: number | null = null;
    let revenueScore: number | null = null;
    let institutionalScore: number | null = null;
    let marginScore: number | null = null;
    let rsScore: number | null = null;
    let technicalScore: number | null = null;
    let valuationScore: number | null = null;
    let entryLow: number | null = null;
    let entryHigh: number | null = null;
    let entryReason = "";
    let tp1Price: number | null = null;
    let tp1Reason = "";
    let tp2Price: number | null = null;
    let tp2Reason = "";
    let slPrice: number | null = null;
    let slAtrMultiple: number | null = null;
    let rRatio: number | null = null;
    let confidence: number | null = null;
    let navPct: number | null = null;
    let marketMultiplier: number | null = null;
    const whyBuy: string[] = [];
    const whyNotBuy: string[] = [];
    const rationaleLines: string[] = [];

    for (const line of lines) {
      const lower = line.toLowerCase();
      const value = line.replace(/^[-*•\s]*[^:：]+[:：]\s*/, "").trim();

      if (/分類[:：]/.test(line)) {
        bucketResult = parseBucket(value);
      } else if (/總分[:：]/.test(line)) {
        totalScore = parseFloat2v3(value.match(/\d+/)?.[0]);
      } else if (/市場狀態[:：]/.test(line)) {
        marketState = parseMarketStateV3(value);
      } else if (/主題位置分[:：]/.test(line)) {
        themeScore = parseFloat2v3(value.match(/[\d.]+/)?.[0]);
      } else if (/營收財報分[:：]/.test(line)) {
        revenueScore = parseFloat2v3(value.match(/[\d.]+/)?.[0]);
      } else if (/法人ETF分[:：]/.test(line)) {
        institutionalScore = parseFloat2v3(value.match(/[\d.]+/)?.[0]);
      } else if (/融資借券分[:：]/.test(line)) {
        marginScore = parseFloat2v3(value.match(/[\d.]+/)?.[0]);
      } else if (/相對強弱量能分[:：]/.test(line)) {
        rsScore = parseFloat2v3(value.match(/[\d.]+/)?.[0]);
      } else if (/技術結構分[:：]/.test(line)) {
        technicalScore = parseFloat2v3(value.match(/[\d.]+/)?.[0]);
      } else if (/估值事件分[:：]/.test(line)) {
        valuationScore = parseFloat2v3(value.match(/[\d.]+/)?.[0]);
      } else if (/進場區[:：]/.test(line)) {
        const pr = extractPriceRangeV3(line);
        entryLow = pr.low;
        entryHigh = pr.high;
      } else if (/進場理由[:：]/.test(line)) {
        entryReason = value;
      } else if (/^- TP1[:：]/.test(line) || /^- tp1[:：]/i.test(line)) {
        // Extract price AFTER the colon, not first digit in whole line
        tp1Price = parseFloat2v3(value.match(/(\d+(?:\.\d+)?)/)?.[0]);
      } else if (/TP1理由[:：]/.test(line)) {
        tp1Reason = value;
      } else if (/^- TP2[:：]/.test(line) || /^- tp2[:：]/i.test(line)) {
        tp2Price = parseFloat2v3(value.match(/(\d+(?:\.\d+)?)/)?.[0]);
      } else if (/TP2理由[:：]/.test(line)) {
        tp2Reason = value;
      } else if (/停損[:：]/.test(line)) {
        slPrice = parseFloat2v3(value.match(/(\d+(?:\.\d+)?)/)?.[0]);
      } else if (/ATR倍數[:：]/.test(line)) {
        slAtrMultiple = parseFloat2v3(value.match(/[\d.]+/)?.[0]);
      } else if (/R值[:：]/i.test(line)) {
        rRatio = parseFloat2v3(value.match(/[\d.]+/)?.[0]);
      } else if (/信心[:：]/.test(line)) {
        const cv = value.match(/([01](?:\.\d+)?)/);
        confidence = cv ? parseFloat2v3(cv[1]) : null;
      } else if (/為什麼買[:：]/.test(line)) {
        const bullets = value.split(/[;；,，]/).map(s => s.trim()).filter(s => s.length > 2);
        whyBuy.push(...bullets);
      } else if (/為什麼不買[:：]/.test(line)) {
        const bullets = value.split(/[;；,，]/).map(s => s.trim()).filter(s => s.length > 2);
        whyNotBuy.push(...bullets);
      } else if (/NAV比重[:：]/.test(line)) {
        navPct = parseFloat2v3(value.match(/([\d.]+)/)?.[0]);
        if (navPct !== null && navPct > 1) navPct = navPct / 100; // convert % to decimal if needed
      } else if (/市場倍率[:：]/.test(line)) {
        marketMultiplier = parseFloat2v3(value.match(/([\d.]+)/)?.[0]);
      } else if (/推薦理由|rationale|理由[:：]/i.test(line)) {
        rationaleLines.push(value);
      }
    }

    // Skip C bucket items
    if (bucketResult.bucket === "C") continue;

    // Confidence defaults by bucket
    const defaultConfidence = bucketResult.bucket === "A+" ? 0.85
      : bucketResult.bucket === "A" ? 0.70
      : 0.55;

    // nav_pct defaults by bucket
    const defaultNavPct = bucketResult.bucket === "A+" ? 0.008
      : bucketResult.bucket === "A" ? 0.006
      : 0.004;

    // Build subScores (use null-safe values)
    const subScores = (themeScore !== null || revenueScore !== null) ? {
      theme: themeScore ?? 10,
      revenue: revenueScore ?? 8,
      institutional: institutionalScore ?? 8,
      margin: marginScore ?? 8,
      rs: rsScore ?? 5,
      technical: technicalScore ?? 10,
      valuation: valuationScore ?? 3,
    } : undefined;

    // Compute totalScore from subScores if not explicitly parsed
    const computedTotal = subScores
      ? subScores.theme + subScores.revenue + subScores.institutional +
        subScores.margin + subScores.rs + subScores.technical + subScores.valuation
      : null;

    const rationale = rationaleLines.join("; ") ||
      whyBuy.join("; ") ||
      block.slice(0, 200).replace(/\n/g, " ").trim();

    const rec: AiStockRecommendationV2 = {
      id: randomUUID(),
      ticker,
      companyName,
      action: bucketResult.action,
      date: dateStr,
      confidence: confidence ?? defaultConfidence,
      rationale,
      entryPriceRange: (entryLow !== null || entryHigh !== null)
        ? { low: entryLow, high: entryHigh }
        : null,
      tp1: tp1Price,
      tp2: tp2Price,
      stopLoss: slPrice,
      aiGenerated: true,
      source: "brain_react_v2",
      // v3 fields
      marketState,
      marketScores: undefined, // Set at run level, not per-stock
      subScores,
      totalScore: totalScore ?? computedTotal ?? undefined,
      bucket: bucketResult.bucket,
      entryZone: (entryLow !== null || entryHigh !== null) ? {
        low: entryLow,
        high: entryHigh,
        reason: entryReason || undefined,
      } : undefined,
      tp1Structured: tp1Price !== null ? {
        price: tp1Price,
        reason: tp1Reason || undefined,
      } : undefined,
      tp2Structured: tp2Price !== null ? {
        price: tp2Price,
        reason: tp2Reason || undefined,
      } : undefined,
      stopLossStructured: slPrice !== null ? {
        price: slPrice,
        atr_multiple: slAtrMultiple ?? 0.5,
      } : undefined,
      r_ratio: rRatio ?? undefined,
      position_sizing: (navPct !== null || marketMultiplier !== null) ? {
        nav_pct: navPct ?? defaultNavPct,
        market_multiplier: marketMultiplier ?? 1.0,
      } : {
        nav_pct: defaultNavPct,
        market_multiplier: 1.0,
      },
      why_buy: whyBuy.length > 0 ? whyBuy : undefined,
      why_not_buy: whyNotBuy.length > 0 ? whyNotBuy : undefined,
    };

    if (!results.some(r => r.ticker === ticker)) {
      results.push(rec);
    }
  }

  return results;
}

// ── ReAct step parser ─────────────────────────────────────────────────────────

function parseMarketStepV3(raw: string): {
  thought: string;
  toolName: string | null;
  toolInput: unknown | null;
  isRiskOff: boolean;
} {
  const cleaned = raw.trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  try {
    const parsed = JSON.parse(cleaned) as { thought?: string; toolName?: string | null; toolInput?: unknown };
    const thought = String(parsed.thought ?? "(no thought)");
    const isRiskOff = /RISK_OFF_SKIP/.test(thought);
    return {
      thought,
      toolName: parsed.toolName ?? null,
      toolInput: parsed.toolInput ?? null,
      isRiskOff,
    };
  } catch {
    return {
      thought: cleaned.slice(0, 300),
      toolName: null,
      toolInput: null,
      isRiskOff: /RISK_OFF_SKIP/.test(cleaned),
    };
  }
}

// ── synthesize v3 report ──────────────────────────────────────────────────────

interface V3SynthesisAttempt {
  markdown: string;
  totalTokens: number;
  costUsd: number;
}

interface V3ParsedSynthesis {
  report: string;
  items: AiStockRecommendationV2[];
  totalTokens: number;
  costUsd: number;
  retryUsed: boolean;
  initialItemCount: number;
}

async function synthesizeReportV3(
  trace: Array<{ round: number; thought: string; toolName: string | null; observation: unknown; tokensUsed: number }>,
  dateStr: string,
  model: string,
  repairMarkdown?: string
): Promise<V3SynthesisAttempt> {
  const { callLlm } = await import("../llm/llm-gateway.js");
  const traceText = trace
    .map(s => `Round ${s.round}:\n思考: ${s.thought}\n工具: ${s.toolName ?? "(Final Answer)"}\n結果: ${JSON.stringify(s.observation).slice(0, 600)}`)
    .join("\n\n");
  const userPrompt = repairMarkdown
    ? `${buildV3SynthesisPrompt(traceText, dateStr)}

---
FORMAT_REPAIR_REQUIRED:
The previous synthesis output did not parse into at least ${MIN_V3_RECOMMENDATION_ITEMS} recommendation items.
Rewrite the recommendation sections only, preserving the same factual basis from the trace.
CRITICAL PARSER RULES:
1. Every stock section MUST start with exactly "## XXXX 公司名" (two hashes, space, 4-digit ticker, space, Chinese name).
2. Do NOT use ### or #### headings for stocks. Do NOT use bold-only (**2330**) headings for stocks.
3. Do NOT output any heading containing "risk-off" or "市場" — only stock ticker headings are parsed.
4. Do NOT use markdown tables — use bullet list format (- 欄位: 值) exclusively.
5. Include ${MIN_V3_RECOMMENDATION_ITEMS} to 8 stocks. C bucket is allowed when the verified data is weak; label it clearly instead of dropping the stock.

Previous markdown:
${repairMarkdown.slice(0, 9000)}`
    : buildV3SynthesisPrompt(traceText, dateStr);

  const llmResult = await callLlm(
    [
      { role: "system", content: "你是 IUF 台股操盤師 AI，輸出嚴格格式的推薦報告。" },
      { role: "user", content: userPrompt },
    ],
    {
      modelKey: model,
      callerModule: "ai_rec_v2",
      taskType: repairMarkdown ? "synthesis_format_retry" : "synthesis",
      maxTokens: repairMarkdown ? 7000 : 5500,
      temperature: repairMarkdown ? 0.1 : 0.2,
    }
  );

  return {
    markdown: llmResult?.content ?? "(synthesis unavailable - LLM returned null)",
    totalTokens: llmResult?.usage.totalTokens ?? 0,
    costUsd: llmResult?.costUsd ?? 0,
  };
}

async function synthesizeAndParseReportV3(
  trace: V3ReActStep[],
  dateStr: string,
  model: string,
  allowRetry: boolean
): Promise<V3ParsedSynthesis> {
  const first = await synthesizeReportV3(trace, dateStr, model);
  let report = first.markdown;
  let items = parseAiReportToRecommendationsV3(report, dateStr);
  const initialItemCount = items.length;
  let totalTokens = first.totalTokens;
  let costUsd = first.costUsd;
  let retryUsed = false;

  if (items.length < MIN_V3_RECOMMENDATION_ITEMS) {
    const headingCandidates = Array.from(
      report.matchAll(/^(?:#{1,6}\s+.*|\d+\.\s+\d{4,6}.*|\*\*\d{4,6}.*)$/gm),
      match => match[0]!.slice(0, 160)
    ).slice(0, 8);
    console.warn("[v3-synthesis] parser_under_min_items", JSON.stringify({
      initialItemCount,
      reportLength: report.length,
      allowRetry,
      headingCandidates,
      reportPreview: report.slice(0, 800),
      reportTail: report.slice(-800),
    }));
  }

  if (allowRetry && items.length < MIN_V3_RECOMMENDATION_ITEMS && report.trim().length > 0) {
    const retry = await synthesizeReportV3(trace, dateStr, model, report);
    const retryItems = parseAiReportToRecommendationsV3(retry.markdown, dateStr);
    totalTokens += retry.totalTokens;
    costUsd += retry.costUsd;
    retryUsed = true;

    if (retryItems.length >= items.length) {
      report = retry.markdown;
      items = retryItems;
    }
  }

  return { report, items, totalTokens, costUsd, retryUsed, initialItemCount };
}

// ── Core runAiRecommendationV3 ────────────────────────────────────────────────

interface V3ReActStep {
  round: number;
  thought: string;
  toolName: string | null;
  toolInput: unknown | null;
  observation: unknown | null;
  tokensUsed: number;
}

export async function runAiRecommendationV3(
  opts: AiRecommendationV3RunOptions = {}
): Promise<AiRecommendationV3RunResult> {
  const runId = opts.runId ?? randomUUID();
  const dbRowId = randomUUID();
  const trigger = opts.trigger ?? "manual_refresh";
  const dateStr = opts.dateStr ?? todayTst();
  const generatedAt = new Date().toISOString();
  const model = process.env["OPENAI_MODEL"] ?? "gpt-4o-mini";
  const maxRounds = Math.min(opts.maxRounds ?? 12, 15);
  const costCap = Math.min(opts.costCapUsd ?? 2.0, 5.0);

  await persistV3RunStart({ id: dbRowId, runId, workspaceId: opts.workspaceId, trigger, model });

  // ── F1: Programmatic risk_off_score (before firing LLM) ──────────────────
  const programmaticRiskOff = await computeProgrammaticRiskOffScore();
  const progScore = programmaticRiskOff.score;

  console.info(`[v3-orchestrator] run ${runId} programmatic risk_off_score=${progScore}/6 (trigger=${trigger})`);

  // If programmatic score >= 3 → short-circuit, do NOT fire LLM
  if (progScore >= 3) {
    const riskOffReport = `## 市場 risk-off — 暫不推薦新倉（系統程式判斷）

系統計算 programmatic risk_off_score = ${progScore}/6，達到 ≥3 閘門。
依楊董 SOP，risk_off_score >= 3 時不開新 beta 倉，待事件過後重新評估。

觸發訊號（${progScore}/6）:
${programmaticRiskOff.signals.vixAbove25 ? "- S1: VIX > 25 ✓" : ""}
${programmaticRiskOff.signals.vix5dSpike ? "- S2: VIX 5d 漲 > 30% ✓" : ""}
${programmaticRiskOff.signals.dxy60dZHigh ? "- S3: DXY 60d Z-score > 1 ✓" : ""}
${programmaticRiskOff.signals.tenY20dUp ? "- S4: 10Y 20d 漲 > 25bp ✓" : ""}
${programmaticRiskOff.signals.wti10dUp ? "- S5: WTI 10d 漲 > 10% ✓" : ""}
${programmaticRiskOff.signals.taiexBelowEma60 ? `- S6: TAIEX(${programmaticRiskOff.taiexIndex}) < EMA60 ✓` : ""}`.trim();

    const result: AiRecommendationV3RunResult = {
      runId,
      status: "market_risk_off",
      generatedAt,
      items: [],
      reactTrace: [],
      finalReportMarkdown: riskOffReport,
      totalCostUsd: 0,
      totalTokens: 0,
      marketState: "risk_off",
      marketRiskOffScore: progScore,
      programmaticRiskOff,
      dbRowId,
    };
    return finalizeV3Run(result, model);
  }

  const { callLlm } = await import("../llm/llm-gateway.js");
  type LlmMessage = { role: "system" | "user" | "assistant"; content: string };

  const trace: V3ReActStep[] = [];
  let totalTokens = 0;
  let totalCostUsd = 0;
  let detectedMarketState: AiRecMarketState | null = null;
  let detectedRiskOffScore: number | null = progScore;

  // Inject programmatic score into system prompt — LLM cannot override
  const messages: LlmMessage[] = [
    { role: "system", content: buildV3SystemPrompt(dateStr, progScore) },
    {
      role: "user",
      content: `請開始楊董 SOP 5-module 分析，日期 ${dateStr}。
系統已確認 programmatic risk_off_score = ${progScore}/6 < 3，你必須完整執行 STEP 1→5，輸出 ≥${MIN_V3_RECOMMENDATION_ITEMS} 檔推薦。
先執行 STEP 1: callTool(get_market_overview)。`,
    },
  ];

  // Track get_company_technical call count for F3 validation
  let companyTechnicalCallCount = 0;

  for (let round = 1; round <= maxRounds; round++) {
    if (totalCostUsd >= costCap) {
      let report = `Budget cap $${costCap} reached.`;
      let items: AiStockRecommendationV2[] = [];
      let synthesisRetryUsed = false;
      if (trace.length > 0) {
        const synthesis = await synthesizeAndParseReportV3(trace, dateStr, model, false);
        totalTokens += synthesis.totalTokens;
        totalCostUsd += synthesis.costUsd;
        report = synthesis.report;
        items = synthesis.items;
        synthesisRetryUsed = synthesis.retryUsed;
      }
      const result: AiRecommendationV3RunResult = {
        runId,
        status: "budget_exceeded",
        generatedAt,
        items,
        reactTrace: trace,
        finalReportMarkdown: report,
        totalCostUsd,
        totalTokens,
        marketState: detectedMarketState,
        marketRiskOffScore: detectedRiskOffScore,
        programmaticRiskOff,
        synthesisRetryUsed,
        synthesisFallbackUsed: false,
        dbRowId,
      };
      return finalizeV3Run(result, model);
    }

    const llmResult = await callLlm(messages, {
      modelKey: model,
      callerModule: "ai_rec_v2",
      taskType: "react_reason",
      workspaceId: opts.workspaceId,
      maxTokens: 1024,
      temperature: 0.1,
    });

    if (!llmResult) {
      // LLM unavailable (test mode without API key) — return gracefully
      const result: AiRecommendationV3RunResult = {
        runId,
        status: "failed",
        generatedAt,
        items: [],
        reactTrace: trace,
        finalReportMarkdown: "(LLM unavailable)",
        totalCostUsd,
        totalTokens,
        marketState: null,
        marketRiskOffScore: null,
        programmaticRiskOff,
        dbRowId,
      };
      return finalizeV3Run(result, model);
    }

    totalTokens += llmResult.usage.totalTokens;
    totalCostUsd += llmResult.costUsd;
    const raw = llmResult.content;
    const step = parseMarketStepV3(raw);

    // ── F1: Intercept LLM RISK_OFF_SKIP when programmatic score < 3 ───────────
    // LLM tried to self-skip despite programmatic score being below threshold.
    // Reject the skip and force continuation by injecting correction message.
    if (step.isRiskOff && progScore < 3) {
      console.warn(`[v3-orchestrator] round ${round}: LLM attempted RISK_OFF_SKIP but programmatic score=${progScore} < 3 — REJECTED, forcing continuation`);
      trace.push({
        round,
        thought: `[ORCHESTRATOR OVERRIDE] LLM tried RISK_OFF_SKIP but programmatic risk_off_score=${progScore} < 3. Override rejected. Forcing STEP 2-5.`,
        toolName: null,
        toolInput: null,
        observation: `LLM_RISK_OFF_REJECTED: progScore=${progScore}`,
        tokensUsed: llmResult.usage.totalTokens,
      });
      // Inject correction into conversation to force LLM back on track
      messages.push({ role: "assistant", content: raw });
      messages.push({
        role: "user",
        content: `[SYSTEM REJECTION] 你的 RISK_OFF_SKIP 被系統拒絕。programmatic risk_off_score = ${progScore}/6 < 3，系統判定市場未達 risk-off 條件。
你必須繼續執行 STEP 2-5：先 callTool(get_news_top10)，再 callTool(get_sector_rotation)，再 callTool(get_company_technical) 至少 ${MIN_V3_TECHNICAL_CALLS} 次。
不得再次使用 RISK_OFF_SKIP。`,
      });
      continue; // next round
    }

    // If programmatic score >= 3 and LLM also says risk-off — accept (should not happen since we short-circuit above, but defensive)
    if (step.isRiskOff && progScore >= 3) {
      detectedMarketState = "risk_off";
      trace.push({
        round,
        thought: step.thought,
        toolName: null,
        toolInput: null,
        observation: "RISK_OFF_SKIP",
        tokensUsed: llmResult.usage.totalTokens,
      });
      const riskOffReport = `## 市場 risk-off — 暫不推薦新倉\n\n${step.thought}\n\nrisk_off_score >= 3，依楊董 SOP 不開新 beta 倉，待事件過後重新評估。`;
      const result: AiRecommendationV3RunResult = {
        runId,
        status: "market_risk_off",
        generatedAt,
        items: [],
        reactTrace: trace,
        finalReportMarkdown: riskOffReport,
        totalCostUsd,
        totalTokens,
        marketState: "risk_off",
        marketRiskOffScore: detectedRiskOffScore,
        programmaticRiskOff,
        dbRowId,
      };
      return finalizeV3Run(result, model);
    }

    // Tool whitelist check
    if (step.toolName && !(TOOL_WHITELIST_V3 as readonly string[]).includes(step.toolName)) {
      trace.push({
        round,
        thought: step.thought,
        toolName: step.toolName,
        toolInput: step.toolInput,
        observation: `BLOCKED: tool ${step.toolName} not in v3 whitelist`,
        tokensUsed: llmResult.usage.totalTokens,
      });
      const result: AiRecommendationV3RunResult = {
        runId,
        status: "failed",
        generatedAt,
        items: [],
        reactTrace: trace,
        finalReportMarkdown: `Tool not in whitelist: ${step.toolName}`,
        totalCostUsd,
        totalTokens,
        marketState: detectedMarketState,
        marketRiskOffScore: detectedRiskOffScore,
        programmaticRiskOff,
        dbRowId,
      };
      return finalizeV3Run(result, model);
    }

    // ── F3: Final answer validation ────────────────────────────────────────────
    if (!step.toolName) {
      trace.push({
        round,
        thought: step.thought,
        toolName: null,
        toolInput: null,
        observation: null,
        tokensUsed: llmResult.usage.totalTokens,
      });
      const allowSynthesisRetry = companyTechnicalCallCount >= MIN_V3_TECHNICAL_CALLS || round >= maxRounds - 1;
      const synthesis = await synthesizeAndParseReportV3(trace, dateStr, model, allowSynthesisRetry);
      totalTokens += synthesis.totalTokens;
      totalCostUsd += synthesis.costUsd;
      let report = synthesis.report;
      let items = synthesis.items;
      let synthesisFallbackUsed = false;
      if (
        items.length < MIN_V3_RECOMMENDATION_ITEMS &&
        companyTechnicalCallCount >= MIN_V3_TECHNICAL_CALLS &&
        progScore < 3
      ) {
        const fallbackItems = buildDeterministicFallbackItemsFromTrace(
          trace,
          dateStr,
          detectedMarketState ?? "trend"
        );
        if (fallbackItems.length >= MIN_V3_RECOMMENDATION_ITEMS) {
          console.warn(`[v3-orchestrator] run ${runId}: LLM returned ${items.length} items after ${companyTechnicalCallCount} technical calls; using deterministic fallback (${fallbackItems.length} items)`);
          items = fallbackItems;
          synthesisFallbackUsed = true;
          report = `${report}

---
Deterministic fallback applied after synthesis format retry: the LLM returned fewer than ${MIN_V3_RECOMMENDATION_ITEMS} structured recommendations even though programmatic risk_off_score=${progScore} and verified get_company_technical observations were available. Items were generated from those tool observations only. initialParsedItems=${synthesis.initialItemCount}; retryUsed=${synthesis.retryUsed}.`;
        }
      }

      // F3: Validate minimum items and tool call count
      const insufficientItems = items.length < MIN_V3_RECOMMENDATION_ITEMS;
      const insufficientTools = companyTechnicalCallCount < MIN_V3_TECHNICAL_CALLS;
      const unresolvedSynthesisFormatError =
        companyTechnicalCallCount >= MIN_V3_TECHNICAL_CALLS &&
        synthesis.initialItemCount < MIN_V3_RECOMMENDATION_ITEMS &&
        items.length < MIN_V3_RECOMMENDATION_ITEMS;

      if ((insufficientItems || insufficientTools) && round < maxRounds - 1) {
        // Still have rounds left — force continuation with correction
        console.warn(`[v3-orchestrator] round ${round}: insufficient output (items=${items.length}, get_company_technical calls=${companyTechnicalCallCount}) — forcing continuation`);
        messages.push({ role: "assistant", content: raw });
        messages.push({
          role: "user",
          content: `[SYSTEM REJECTION] 分析不足：推薦股數=${items.length}（需 ≥${MIN_V3_RECOMMENDATION_ITEMS}），get_company_technical 呼叫次數=${companyTechnicalCallCount}（需 ≥${MIN_V3_TECHNICAL_CALLS}）。
請繼續分析更多候選標的，callTool(get_company_technical) 取得更多個股技術資料，並補充更多 A/A+/B/C bucket 卡片。`,
        });
        continue; // continue loop
      }

      // Accept result (either sufficient or no rounds left)
      const status: AiRecommendationV3RunResult["status"] = synthesisFallbackUsed || unresolvedSynthesisFormatError
        ? "synthesis_format_error"
        : (insufficientItems || insufficientTools) ? "insufficient_tools" : "complete";
      if (status === "insufficient_tools") {
        console.warn(`[v3-orchestrator] run ${runId} finished with insufficient_tools: items=${items.length}, get_company_technical calls=${companyTechnicalCallCount}`);
      } else if (status === "synthesis_format_error") {
        console.warn(`[v3-orchestrator] run ${runId} finished with synthesis_format_error: initialItems=${synthesis.initialItemCount}, finalItems=${items.length}, retryUsed=${synthesis.retryUsed}, fallbackUsed=${synthesisFallbackUsed}`);
      }

      const result: AiRecommendationV3RunResult = {
        runId,
        status,
        generatedAt,
        items,
        reactTrace: trace,
        finalReportMarkdown: report,
        totalCostUsd,
        totalTokens,
        marketState: detectedMarketState ?? "trend",
        marketRiskOffScore: detectedRiskOffScore,
        programmaticRiskOff,
        synthesisRetryUsed: synthesis.retryUsed,
        synthesisFallbackUsed,
        dbRowId,
      };
      return finalizeV3Run(result, model);
    }

    // Execute tool
    let observation: unknown;
    try {
      observation = await dispatchMarketToolV3(step.toolName, step.toolInput, opts.workspaceId);

      // Track get_company_technical calls (F3)
      if (step.toolName === "get_company_technical") {
        companyTechnicalCallCount++;
        console.info(`[v3-orchestrator] round ${round}: get_company_technical call #${companyTechnicalCallCount}`);
      }

      // Try to extract risk_off_score from market overview result
      if (step.toolName === "get_market_overview" && typeof observation === "object" && observation !== null) {
        const obs = observation as Record<string, unknown>;
        if (typeof obs["risk_off_score"] === "number") {
          detectedRiskOffScore = obs["risk_off_score"] as number;
          // Determine market state from scores (but do NOT override progScore gate)
          if ((obs["trend_score"] as number | undefined) !== undefined && (obs["trend_score"] as number) >= 4) {
            detectedMarketState = "trend";
          } else {
            detectedMarketState = "range";
          }
        }
      }
    } catch (err) {
      observation = { error: err instanceof Error ? err.message : String(err) };
    }

    trace.push({
      round,
      thought: step.thought,
      toolName: step.toolName,
      toolInput: step.toolInput,
      observation,
      tokensUsed: llmResult.usage.totalTokens,
    });

    messages.push({ role: "assistant", content: raw });
    messages.push({
      role: "user",
      content: `Tool ${step.toolName} 結果: ${JSON.stringify(observation).slice(0, 2000)}`,
    });
  }

  // Max rounds reached — synthesize with what we have
  const synthesis = await synthesizeAndParseReportV3(trace, dateStr, model, true);
  totalTokens += synthesis.totalTokens;
  totalCostUsd += synthesis.costUsd;
  let report = synthesis.report;
  let items = synthesis.items;
  let synthesisFallbackUsed = false;
  if (
    items.length < MIN_V3_RECOMMENDATION_ITEMS &&
    companyTechnicalCallCount >= MIN_V3_TECHNICAL_CALLS &&
    progScore < 3
  ) {
    const fallbackItems = buildDeterministicFallbackItemsFromTrace(
      trace,
      dateStr,
      detectedMarketState ?? "trend"
    );
    if (fallbackItems.length >= MIN_V3_RECOMMENDATION_ITEMS) {
      console.warn(`[v3-orchestrator] run ${runId}: max rounds reached with ${items.length} items after ${companyTechnicalCallCount} technical calls; using deterministic fallback (${fallbackItems.length} items)`);
      items = fallbackItems;
      synthesisFallbackUsed = true;
      report = `${report}

---
Deterministic fallback applied after synthesis format retry: max rounds ended with fewer than ${MIN_V3_RECOMMENDATION_ITEMS} structured recommendations even though programmatic risk_off_score=${progScore} and verified get_company_technical observations were available. Items were generated from those tool observations only. initialParsedItems=${synthesis.initialItemCount}; retryUsed=${synthesis.retryUsed}.`;
    }
  }
  const insufficientFinal =
    items.length < MIN_V3_RECOMMENDATION_ITEMS ||
    companyTechnicalCallCount < MIN_V3_TECHNICAL_CALLS;
  const unresolvedSynthesisFormatError =
    companyTechnicalCallCount >= MIN_V3_TECHNICAL_CALLS &&
    synthesis.initialItemCount < MIN_V3_RECOMMENDATION_ITEMS &&
    items.length < MIN_V3_RECOMMENDATION_ITEMS;
  const result: AiRecommendationV3RunResult = {
    runId,
    status: synthesisFallbackUsed || unresolvedSynthesisFormatError
      ? "synthesis_format_error"
      : insufficientFinal ? "insufficient_tools" : "complete",
    generatedAt,
    items,
    reactTrace: trace,
    finalReportMarkdown: report,
    totalCostUsd,
    totalTokens,
    marketState: detectedMarketState ?? "trend",
    marketRiskOffScore: detectedRiskOffScore,
    programmaticRiskOff,
    synthesisRetryUsed: synthesis.retryUsed,
    synthesisFallbackUsed,
    dbRowId,
  };
  return finalizeV3Run(result, model);
}
