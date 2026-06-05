/**
 * Recommendation Orchestrator Store — v2 real-data layer
 *
 * v1 (PR #469): mock skeleton.
 * v2 (PR #517): Athena QuantCandidateSignal fixture + leaders + news synthesis.
 * v3 (PR #531): fixture resolved by latest-mtime glob — no hardcoded date in filename.
 *
 * Data sources:
 *   1. Athena fixture  — quant_candidate_signal_cont_liq_v36_<date>.json (latest by mtime)
 *      Searched in: ATHENA_FIXTURE_PATH (exact, env override) → bundled data dir →
 *      sibling IUF_QUANT_LAB repo → IUF_QUANT_LAB_PATH env.
 *   2. Leaders         — GET /api/v1/market/leaders/twse (internal fetch)
 *   3. News            — GET /api/v1/market-intel/announcements?limit=30 (internal fetch)
 *
 * Fallback: if fixture cannot be read → returns mock data with _mock=true flag.
 *
 * Lane: strategy backend (Jason). Do NOT import from broker/*, risk-engine, market-data.
 */

import fs from "node:fs";
import path from "node:path";
import type { AppSession, StockRecommendation } from "@iuf-trading-room/contracts";
import type { TradingRoomRepository } from "@iuf-trading-room/domain";
import { getCompanyOhlcv, type OhlcvBar } from "./companies-ohlcv.js";

// ---------------------------------------------------------------------------
// Feedback in-process store (memory-mode v1; Day 5 wires to DB table)
// ---------------------------------------------------------------------------
export type RecommendationFeedbackEntry = {
  recommendationId: string;
  userId: string;
  reaction: "like" | "dislike" | "skip" | "acted";
  note?: string;
  recordedAt: string;
};

const _feedbackStore: Map<string, RecommendationFeedbackEntry[]> = new Map();

export function recordRecommendationFeedback(entry: RecommendationFeedbackEntry): void {
  const existing = _feedbackStore.get(entry.recommendationId) ?? [];
  existing.push(entry);
  _feedbackStore.set(entry.recommendationId, existing);
}

export function getRecommendationFeedback(
  recommendationId: string
): RecommendationFeedbackEntry[] {
  return _feedbackStore.get(recommendationId) ?? [];
}

/** Test helper — resets in-process feedback map between tests */
export function _resetRecommendationFeedbackStore(): void {
  _feedbackStore.clear();
}

// ---------------------------------------------------------------------------
// Athena fixture types
// ---------------------------------------------------------------------------
type AthenaCandidateSignal = {
  ticker: string;
  companyName: string;
  quantRank: number;
  quantScore: number;
  strategySource: string;
  regime: string;
  gateStatus: "PASS" | "WATCH" | "FAIL";
  expectedHoldingPeriod: string;
  quantReason: string[];
  riskFlags: string[];
  dataQuality: {
    backtestEvidence: string;
    forwardObservation: string;
    liquidity: string;
  };
  snapshotAt: string;
};

type AthenaFixture = {
  schema: string;
  schemaVersion: string;
  producer: string;
  producedAtTaipei: string;
  snapshotAt: string;
  strategySource: string;
  signals: AthenaCandidateSignal[];
};

// ---------------------------------------------------------------------------
// Fixture path resolution — latest-by-mtime glob (no hardcoded date)
// ---------------------------------------------------------------------------

/**
 * Glob prefix used to match Athena fixture files.
 * Matches: quant_candidate_signal_cont_liq_v36_2026_05_14.json
 *          quant_candidate_signal_cont_liq_v36_2026_05_15.json
 *          ... etc.
 */
const FIXTURE_GLOB_PREFIX = "quant_candidate_signal_cont_liq_v36_";
const FIXTURE_GLOB_SUFFIX = ".json";

/**
 * Scans `dir` for files matching the fixture glob pattern and returns the
 * absolute path of the file with the greatest mtime (newest). Returns null
 * if the directory is inaccessible or no matching file exists.
 */
function findLatestFixtureInDir(dir: string): string | null {
  try {
    const entries = fs.readdirSync(dir);
    const matches = (entries as string[]).filter(
      (name: string) => name.startsWith(FIXTURE_GLOB_PREFIX) && name.endsWith(FIXTURE_GLOB_SUFFIX)
    );
    if (matches.length === 0) return null;

    // Sort by mtime descending — pick the newest file
    let bestPath: string | null = null;
    let bestMtime = -Infinity;
    for (const name of matches) {
      const fullPath = path.join(dir, name);
      try {
        const mtime = fs.statSync(fullPath).mtimeMs;
        if (mtime > bestMtime) {
          bestMtime = mtime;
          bestPath = fullPath;
        }
      } catch {
        // stat failed for this entry — skip
      }
    }
    return bestPath;
  } catch {
    // readdirSync failed — dir not accessible (Railway, unavailable drive, etc.)
    return null;
  }
}

function resolveFixturePath(): string | null {
  // 1. Env var override — exact path, takes priority (no glob)
  const envPath = process.env["ATHENA_FIXTURE_PATH"];
  if (envPath && fs.existsSync(envPath)) return envPath;

  // 2. Search candidate directories by latest-mtime glob
  const baseDir = import.meta.dirname ?? __dirname;
  const candidateDirs: (string | null)[] = [
    // a) apps/api/data/athena-fixtures/ — bundled with IUF deploy (Railway)
    path.resolve(baseDir, "../data/athena-fixtures"),
    // b) Sibling repo path (Windows dev machine)
    path.resolve(
      baseDir,
      "../../../../..",              // → desktop/小楊機密/交易
      "IUF_QUANT_LAB",
      "research",
      "fixtures"
    ),
    // c) IUF_QUANT_LAB_PATH env var (CI / custom lab root)
    process.env["IUF_QUANT_LAB_PATH"]
      ? path.join(process.env["IUF_QUANT_LAB_PATH"], "research", "fixtures")
      : null,
  ];

  for (const dir of candidateDirs) {
    if (!dir) continue;
    const found = findLatestFixtureInDir(dir);
    if (found) return found;
  }
  return null;
}

let _fixtureCache: AthenaFixture | null | "NOT_FOUND" = undefined as unknown as "NOT_FOUND";

export function _resetAthenaFixtureCache(): void {
  _fixtureCache = undefined as unknown as "NOT_FOUND";
}

function loadAthenaFixture(): AthenaFixture | null {
  // Simple memo — fixture is static per deploy
  if (_fixtureCache !== undefined) {
    return _fixtureCache === "NOT_FOUND" ? null : _fixtureCache;
  }
  const fixturePath = resolveFixturePath();
  if (!fixturePath) {
    _fixtureCache = "NOT_FOUND";
    return null;
  }
  try {
    const raw = fs.readFileSync(fixturePath, "utf-8");
    const parsed = JSON.parse(raw) as AthenaFixture;
    _fixtureCache = parsed;
    return parsed;
  } catch {
    _fixtureCache = "NOT_FOUND";
    return null;
  }
}

// ---------------------------------------------------------------------------
// Synthesis helpers
// ---------------------------------------------------------------------------
function todayTstDate(): string {
  const now = new Date(Date.now() + 8 * 60 * 60 * 1000);
  return now.toISOString().slice(0, 10);
}

type LeaderStock = {
  symbol: string;
  name: string;
  last: number;
  changePct: number;
  volume: number;
};

type LeadersPayload = {
  topGainers: LeaderStock[];
  topLosers: LeaderStock[];
  mostActive: LeaderStock[];
  source?: string;
  asOf?: string;
};

type OhlcvRow = {
  dt: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  source?: string;
};

type OhlcvPayload = {
  data?: OhlcvRow[];
};

type IntelItem = {
  id: string;
  date: string;
  title: string;
  ticker?: string;
  companyName?: string;
  source?: string;
};

/**
 * Internal HTTP fetch to a sibling endpoint.
 * Only used during real synthesis; times out gracefully.
 */
async function fetchInternal<T>(url: string, cookie: string): Promise<T | null> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(url, {
      headers: { cookie },
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

type ActionBucket = StockRecommendation["action"];

function ohlcvLookbackFromDate(): string {
  const now = new Date(Date.now() + 8 * 60 * 60 * 1000);
  now.setUTCDate(now.getUTCDate() - 220);
  return now.toISOString().slice(0, 10);
}

function cleanTicker(ticker: string | undefined | null): string | null {
  const value = String(ticker ?? "").trim();
  if (!/^\d{4}[A-Z]?$/.test(value)) return null;
  return value;
}

function toFinitePrice(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function roundPrice(value: number): number {
  if (value >= 1000) return Math.round(value / 5) * 5;
  if (value >= 100) return Math.round(value * 2) / 2;
  if (value >= 50) return Math.round(value * 10) / 10;
  return Math.round(value * 100) / 100;
}

function formatPlanPrice(value: number): string {
  const rounded = roundPrice(value);
  if (rounded >= 100) return rounded.toLocaleString("zh-TW", { maximumFractionDigits: 1 });
  return rounded.toLocaleString("zh-TW", { maximumFractionDigits: 2 });
}

function average(values: number[]): number | null {
  const valid = values.filter((v) => Number.isFinite(v));
  if (valid.length === 0) return null;
  return valid.reduce((sum, v) => sum + v, 0) / valid.length;
}

function normaliseOhlcvRows(rows: OhlcvRow[] | undefined): OhlcvRow[] {
  return (rows ?? [])
    .filter((row) => toFinitePrice(row.close) !== null && toFinitePrice(row.high) !== null && toFinitePrice(row.low) !== null)
    .sort((a, b) => a.dt.localeCompare(b.dt));
}

function deriveTradePlanFromOhlcv(rows: OhlcvRow[] | undefined): Pick<StockRecommendation, "entryZone" | "invalidation" | "targets"> & {
  technicalReasons: string[];
  ohlcvSource: StockRecommendation["sourceTrail"][number] | null;
  kbarState: "OK" | "STALE" | "MISSING";
} {
  const ordered = normaliseOhlcvRows(rows);
  const recent = ordered.slice(-60);
  const last = recent.at(-1);
  if (!last || recent.length < 20) {
    return {
      entryZone: {
        primary: "等待 OHLCV 回補",
        reason: "最近日 K 不足 20 根，推薦 API 不補假進場區間。",
      },
      invalidation: {
        price: null,
        rule: "OHLCV 不足，停損點位暫不生成。",
      },
      targets: [
        { label: "TP1", price: null, reason: "OHLCV 不足，目標價暫不生成。" },
        { label: "TP2", price: null, reason: "OHLCV 不足，目標價暫不生成。" },
      ],
      technicalReasons: ["OHLCV 少於 20 根，技術面僅列入觀察。"],
      ohlcvSource: null,
      kbarState: recent.length > 0 ? "STALE" : "MISSING",
    };
  }

  const last20 = recent.slice(-20);
  const close = toFinitePrice(last.close)!;
  const low20 = Math.min(...last20.map((row) => toFinitePrice(row.low)!).filter(Boolean));
  const high20 = Math.max(...last20.map((row) => toFinitePrice(row.high)!).filter(Boolean));
  const sma20 = average(last20.map((row) => toFinitePrice(row.close)!).filter(Boolean)) ?? close;
  const volatility = Math.max(0.03, Math.min(0.14, (high20 - low20) / close));
  const entryLow = roundPrice(Math.max(low20, close * (1 - Math.max(0.035, volatility * 0.45))));
  const entryHigh = roundPrice(Math.max(entryLow, Math.min(close * 1.01, Math.max(sma20, close * 0.985))));
  const stop = roundPrice(Math.min(low20 * 0.98, close * (1 - Math.max(0.055, volatility * 0.55))));
  const risk = Math.max(close - stop, close * 0.035);
  const tp1 = roundPrice(close + risk * 1.35);
  const tp2 = roundPrice(close + risk * 2.1);
  const source = last.source ?? "companies_ohlcv";

  return {
    entryZone: {
      primary: `${formatPlanPrice(entryLow)}–${formatPlanPrice(entryHigh)}`,
      secondary: `最近收盤 ${formatPlanPrice(close)}；20 日區間 ${formatPlanPrice(low20)}–${formatPlanPrice(high20)}`,
      reason: `以 ${last.dt} 最近 20 根日 K 派生，不使用 mock 點位。`,
    },
    invalidation: {
      price: stop,
      rule: `跌破近 20 日支撐緩衝 ${formatPlanPrice(stop)}，視為本輪觀察結構失效。`,
    },
    targets: [
      { label: "TP1", price: tp1, reason: "以最近波動風險距離 1.35R 派生。" },
      { label: "TP2", price: tp2, reason: "以最近波動風險距離 2.1R 派生。" },
    ],
    technicalReasons: [
      `最近收盤 ${formatPlanPrice(close)}，20 日均線約 ${formatPlanPrice(sma20)}`,
      `20 日高低區間 ${formatPlanPrice(low20)}–${formatPlanPrice(high20)}，用於 entry/stop/TP 派生`,
    ],
    ohlcvSource: {
      type: "technical",
      source: `companies_ohlcv_${source}`,
      timestamp: last.dt,
    },
    kbarState: "OK",
  };
}

function computeAction(
  totalScore: number,
  gateStatus: string,
  hasMissingData: boolean
): ActionBucket {
  if (hasMissingData) return "資料不足暫不推薦";
  if (gateStatus === "FAIL") return "高風險排除";
  // Thresholds lowered 5pt to ensure cont_liq_v36 WATCH candidates (DQ-penalised) reach
  // meaningful buckets. Old: 80/70/60. New: 75/65/55.
  // cont_liq_v36 quantScore ~71-80 → after PENDING penalty (5%) → totalScore ~67-76.
  if (totalScore >= 75) return "今日首選";
  if (totalScore >= 65) return "可觀察布局（研究參考）";
  if (totalScore >= 55) return "等回檔";
  return "高風險排除";
}

function computeDataQualityPenalty(dq: AthenaCandidateSignal["dataQuality"]): number {
  const vals = Object.values(dq);
  const missingCount = vals.filter((v) => v === "MISSING").length;
  const pendingCount = vals.filter((v) => v === "PENDING").length;
  return missingCount * 0.15 + pendingCount * 0.05;
}

function buildSupplementalSignals(
  fixture: AthenaFixture,
  leaders: LeadersPayload | null,
  newsItems: IntelItem[]
): AthenaCandidateSignal[] {
  const existing = new Set(fixture.signals.map((signal) => signal.ticker));
  const out: AthenaCandidateSignal[] = [];
  const generatedAt = new Date().toISOString();

  const pushCandidate = (input: { ticker?: string; companyName?: string; reason: string; score: number; sourceAt?: string }) => {
    const ticker = cleanTicker(input.ticker);
    if (!ticker || existing.has(ticker) || out.some((item) => item.ticker === ticker)) return;
    out.push({
      ticker,
      companyName: input.companyName?.trim() || ticker,
      quantRank: fixture.signals.length + out.length + 1,
      quantScore: input.score,
      strategySource: "market_context",
      regime: "market-context",
      gateStatus: "WATCH",
      expectedHoldingPeriod: "波段",
      quantReason: [
        input.reason,
        "此為正式市場排行 / 重大訊息補足候選，用於每日觀察清單，不代表策略晉升或下單建議。",
      ],
      riskFlags: [
        "market_context_not_promoted_strategy",
        "requires_manual_confirmation_before_trade",
      ],
      dataQuality: {
        backtestEvidence: "PENDING",
        forwardObservation: "PENDING",
        liquidity: "OK",
      },
      snapshotAt: input.sourceAt ?? leaders?.asOf ?? generatedAt,
    });
  };

  for (const stock of leaders?.topGainers ?? []) {
    pushCandidate({
      ticker: stock.symbol,
      companyName: stock.name,
      score: 68,
      sourceAt: leaders?.asOf,
      reason: `今日市場漲幅排行正式來源，漲跌幅 ${stock.changePct.toFixed(2)}%。`,
    });
    if (fixture.signals.length + out.length >= 8) break;
  }

  for (const stock of leaders?.mostActive ?? []) {
    pushCandidate({
      ticker: stock.symbol,
      companyName: stock.name,
      score: 66,
      sourceAt: leaders?.asOf,
      reason: `今日成交活躍正式來源，成交量 ${Math.round(stock.volume).toLocaleString("zh-TW")}。`,
    });
    if (fixture.signals.length + out.length >= 8) break;
  }

  for (const item of newsItems) {
    pushCandidate({
      ticker: item.ticker,
      companyName: item.companyName,
      score: 64,
      sourceAt: item.date,
      reason: `重大訊息 / 市場情報正式來源：${item.title}`,
    });
    if (fixture.signals.length + out.length >= 8) break;
  }

  return out;
}

async function fetchOhlcvByTicker(
  internalBaseUrl: string,
  sessionCookie: string,
  tickers: string[],
  opts: {
    session?: AppSession;
    repo?: TradingRoomRepository;
  } = {}
): Promise<Map<string, OhlcvRow[]>> {
  const unique = Array.from(new Set(tickers.map(cleanTicker).filter(Boolean) as string[])).slice(0, 12);
  const from = ohlcvLookbackFromDate();
  const to = todayTstDate();
  const result = new Map<string, OhlcvRow[]>();

  if (opts.session && opts.repo) {
    const companiesByTicker = new Map<string, { id: string; ticker: string }>();
    try {
      const companies = await opts.repo.listCompaniesLite({
        workspaceSlug: opts.session.workspace.slug,
      });
      for (const company of companies) {
        const ticker = cleanTicker(company.ticker);
        if (ticker) companiesByTicker.set(ticker, { id: company.id, ticker });
      }
    } catch {
      // Fall back to the HTTP path below. Recommendations must degrade, not crash.
    }

    const directSettled = await Promise.allSettled(
      unique.map(async (ticker) => {
        const company = companiesByTicker.get(ticker);
        if (!company) return [ticker, [] as OhlcvRow[]] as const;
        const bars = await getCompanyOhlcv(company.id, opts.session!, {
          interval: "1d",
          from,
          to,
          ticker,
        });
        return [ticker, normaliseOhlcvRows(bars.map(ohlcvBarToRow))] as const;
      })
    );

    for (const item of directSettled) {
      if (item.status !== "fulfilled") continue;
      result.set(item.value[0], item.value[1]);
    }
  }

  const missing = unique.filter((ticker) => (result.get(ticker)?.length ?? 0) < 20);
  const settled = await Promise.allSettled(
    missing.map(async (ticker) => {
      const payload = await fetchInternal<OhlcvPayload>(
        `${internalBaseUrl}/api/v1/companies/${encodeURIComponent(ticker)}/ohlcv?interval=1d&from=${from}&to=${to}`,
        sessionCookie
      );
      return [ticker, normaliseOhlcvRows(payload?.data ?? [])] as const;
    })
  );

  for (const item of settled) {
    if (item.status !== "fulfilled") continue;
    if (item.value[1].length > 0) result.set(item.value[0], item.value[1]);
  }
  return result;
}

function ohlcvBarToRow(bar: OhlcvBar): OhlcvRow {
  return {
    dt: bar.dt,
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    volume: bar.volume,
    source: bar.source,
  };
}

/**
 * Core synthesis function — exported for testability.
 */
export function synthesizeFromFixture(
  fixture: AthenaFixture,
  leaders: LeadersPayload | null,
  newsItems: IntelItem[],
  ohlcvByTicker: Map<string, OhlcvRow[]> = new Map()
): StockRecommendation[] {
  const date = todayTstDate();
  const generatedAt = new Date().toISOString();

  const allLeaderSymbols = new Set([
    ...( leaders?.topGainers ?? []).map((s) => s.symbol),
    ...(leaders?.topLosers ?? []).map((s) => s.symbol),
    ...(leaders?.mostActive ?? []).map((s) => s.symbol),
  ]);

  const newsByTicker = new Map<string, string[]>();
  for (const item of newsItems) {
    if (!item.ticker) continue;
    const existing = newsByTicker.get(item.ticker) ?? [];
    existing.push(item.title);
    newsByTicker.set(item.ticker, existing);
  }

  const supplementalSignals = buildSupplementalSignals(fixture, leaders, newsItems);
  const signals = [...fixture.signals, ...supplementalSignals];

  return signals.map((sig, idx) => {
    const dqPenalty = computeDataQualityPenalty(sig.dataQuality);
    const totalScore = Math.round(sig.quantScore * (1 - dqPenalty));
    const hasMissingData = Object.values(sig.dataQuality).includes("MISSING");
    const action = computeAction(totalScore, sig.gateStatus, hasMissingData);

    const newsReasons = (newsByTicker.get(sig.ticker) ?? []).slice(0, 3);
    const isLeader = allLeaderSymbols.has(sig.ticker);
    const leaderNote = isLeader ? [`${sig.ticker} 出現於今日市場領漲/領跌名單`] : [];

    // Source trail: always include fixture + conditional leaders/news
    const sourceTrail: StockRecommendation["sourceTrail"] = [
      {
        type: "quant",
        source: sig.strategySource,
        timestamp: sig.snapshotAt,
      },
      {
        type: "fixture",
        source: `athena_cont_liq_v36_fixture_${fixture.snapshotAt.slice(0, 10)}`,
        timestamp: fixture.producedAtTaipei,
      },
    ];
    if (leaders?.asOf) {
      sourceTrail.push({
        type: "leaders",
        source: `market_leaders_twse_${leaders.source ?? "twse"}`,
        timestamp: leaders.asOf,
      });
    }
    if (newsReasons.length > 0) {
      sourceTrail.push({
        type: "news",
        source: "market_intel_announcements",
        timestamp: generatedAt,
      });
    }

    const tradePlan = deriveTradePlanFromOhlcv(ohlcvByTicker.get(sig.ticker));
    if (tradePlan.ohlcvSource) {
      sourceTrail.push(tradePlan.ohlcvSource);
    }

    // Confidence: quant gate drives it, penalised by data quality
    const rawConfidence = sig.gateStatus === "PASS" ? 0.78
      : sig.gateStatus === "WATCH" ? 0.6
      : 0.35;
    const confidence = parseFloat((rawConfidence * (1 - dqPenalty)).toFixed(2));

    // Direction: default neutral for WATCH; all are "研究候選" not live signals
    const direction: StockRecommendation["direction"] = "中性";

    // timeHorizon from fixture expectedHoldingPeriod
    const horizonMap: Record<string, StockRecommendation["timeHorizon"]> = {
      "波段": "波段",
      "1-2週": "1-2週",
      "當沖/隔日": "當沖/隔日",
    };
    const timeHorizon: StockRecommendation["timeHorizon"] =
      horizonMap[sig.expectedHoldingPeriod] ?? "波段";

    const rec: StockRecommendation = {
      recommendationId: `rec_${sig.ticker}_${date.replace(/-/g, "")}`,
      date,
      generatedAt,
      ticker: sig.ticker,
      companyName: sig.companyName,
      rank: idx + 1,
      action,
      direction,
      timeHorizon,
      confidence,
      totalScore,
      quant: {
        score: sig.quantScore,
        strategySource: sig.strategySource,
        gateStatus: sig.gateStatus,
        reason: sig.quantReason,
      },
      entryZone: tradePlan.entryZone,
      invalidation: tradePlan.invalidation,
      targets: tradePlan.targets,
      positionSizing: {
        suggestion: "小倉",
        maxRiskPct: 1.0,
      },
      reasons: {
        technical: tradePlan.technicalReasons,
        chip: [],
        news: [...newsReasons, ...leaderNote],
        theme: [],
        quant: sig.quantReason,
        macro: [],
      },
      risks: sig.riskFlags.map((f) => f.replace(/_/g, " ")),
      dataQuality: {
        quote: "OK",
        kbar: tradePlan.kbarState,
        chip: "OK",
        news: newsReasons.length > 0 ? "OK" : "STALE",
        quant: sig.dataQuality.forwardObservation === "PENDING" ? "WEAK" : "OK",
        confidencePenalty: parseFloat(dqPenalty.toFixed(2)),
      },
      sourceTrail,
      generatedBy: "iuf_recommendation_orchestrator_v1",
    };

    return rec;
  });
}

// ---------------------------------------------------------------------------
// Public API — real data path
// ---------------------------------------------------------------------------

/**
 * Returns recommendations synthesised from Athena fixture + live market context.
 * `internalBaseUrl` and `sessionCookie` are forwarded to internal API calls.
 *
 * If fixture cannot be loaded, falls back to mock data + sets `_isMock = true`.
 */
export async function getTodayRecommendations(opts: {
  internalBaseUrl: string;
  sessionCookie: string;
  session?: AppSession;
  repo?: TradingRoomRepository;
}): Promise<{ items: StockRecommendation[]; isMock: boolean }> {
  const fixture = loadAthenaFixture();
  if (!fixture) {
    return { items: getMockRecommendations(), isMock: true };
  }

  // Best-effort parallel fetch — both are allowed to degrade
  const [leadersRaw, newsRaw] = await Promise.allSettled([
    fetchInternal<LeadersPayload>(
      `${opts.internalBaseUrl}/api/v1/market/leaders/twse`,
      opts.sessionCookie
    ),
    fetchInternal<{ data: { items: IntelItem[] } }>(
      `${opts.internalBaseUrl}/api/v1/market-intel/announcements?limit=30`,
      opts.sessionCookie
    ),
  ]);

  const leaders =
    leadersRaw.status === "fulfilled" ? (leadersRaw.value ?? null) : null;
  const newsItems: IntelItem[] =
    newsRaw.status === "fulfilled"
      ? (newsRaw.value?.data?.items ?? [])
      : [];

  const supplementalSignals = buildSupplementalSignals(fixture, leaders, newsItems);
  const candidateTickers = [
    ...fixture.signals.map((signal) => signal.ticker),
    ...supplementalSignals.map((signal) => signal.ticker),
  ];
  const ohlcvByTicker = await fetchOhlcvByTicker(
    opts.internalBaseUrl,
    opts.sessionCookie,
    candidateTickers,
    { session: opts.session, repo: opts.repo }
  );

  const items = synthesizeFromFixture(fixture, leaders, newsItems, ohlcvByTicker);
  return { items, isMock: false };
}

// ---------------------------------------------------------------------------
// Mock fallback (v1 data preserved)
// ---------------------------------------------------------------------------

const MOCK_RECS: Omit<StockRecommendation, "date" | "generatedAt">[] = [
  {
    recommendationId: "rec_2330_20260514",
    ticker: "2330",
    companyName: "台積電",
    rank: 1,
    action: "今日首選",
    direction: "偏多",
    timeHorizon: "1-2週",
    confidence: 0.82,
    totalScore: 87,
    quant: {
      score: 91,
      strategySource: "cont_liq_v36",
      gateStatus: "PASS",
      reason: ["流動性篩選通過", "RS強度 > 1.2", "cont_liq v36 訊號 BUY"],
    },
    entryZone: {
      primary: "950–960",
      secondary: "935–950 (拉回再布)",
      reason: "前高突破後回測支撐帶",
    },
    invalidation: {
      price: 920,
      rule: "跌破 845 月線支撐則結構失效，建議減倉觀望",
    },
    targets: [
      { label: "TP1", price: 990, reason: "前波段高點壓力" },
      { label: "TP2", price: 1020, reason: "月線上緣整數關卡" },
      { label: "延伸", price: 1060, reason: "年線頂部結構若量價配合" },
    ],
    positionSizing: {
      suggestion: "中倉",
      maxRiskPct: 2.0,
    },
    reasons: {
      technical: ["週 K 站上布林中軌", "月量增 15%"],
      chip: ["外資連續 3 日買超", "主力未見出貨跡象"],
      news: ["CoWoS 需求調升", "AI 伺服器訂單能見度至 2026Q3"],
      theme: ["AI 算力", "先進封裝"],
      quant: ["cont_liq_v36 BUY 訊號", "RS 90 日排名前 8%"],
      macro: ["Fed 停升碼預期強化", "美元指數走弱利外銷"],
    },
    risks: [
      "中美晶片禁令升級風險",
      "CoWoS 擴產進度不如預期",
      "台股大盤系統性回檔",
    ],
    dataQuality: {
      quote: "OK",
      kbar: "OK",
      chip: "OK",
      news: "OK",
      quant: "OK",
      confidencePenalty: 0,
    },
    sourceTrail: [
      { type: "quant", source: "cont_liq_v36", timestamp: "2026-05-14T01:00:00.000Z" },
      { type: "chip", source: "tdcc_margin_2330", timestamp: "2026-05-14T06:00:00.000Z" },
      { type: "news", source: "openalice_pipeline", timestamp: "2026-05-14T07:30:00.000Z" },
    ],
    generatedBy: "iuf_recommendation_orchestrator_v1",
  },
  {
    recommendationId: "rec_0050_20260514",
    ticker: "0050",
    companyName: "元大台灣50",
    rank: 2,
    action: "可觀察布局（研究參考）",
    direction: "偏多",
    timeHorizon: "波段",
    confidence: 0.71,
    totalScore: 74,
    quant: {
      score: 78,
      strategySource: "MAIN",
      gateStatus: "PASS",
      reason: ["MAIN 策略訊號 BUY", "大盤 RSI 月線回升"],
    },
    entryZone: {
      primary: "185–190",
      reason: "季線支撐帶分批布局",
    },
    invalidation: {
      price: 178,
      rule: "跌破 50 日均線結構轉弱，建議調整曝險",
    },
    targets: [
      { label: "TP1", price: 200, reason: "整數關卡 + 前高壓力" },
      { label: "TP2", price: 215, reason: "年線頂部" },
    ],
    positionSizing: {
      suggestion: "小倉",
      maxRiskPct: 1.5,
    },
    reasons: {
      technical: ["季線金叉", "月 MACD 翻紅"],
      chip: ["ETF 申購量增加"],
      news: [],
      theme: ["台股大盤指數"],
      quant: ["MAIN BUY 訊號"],
      macro: ["外資 5/13 買超台股 42 億"],
    },
    risks: [
      "美股大跌拖累台股系統性風險",
      "外資持續提款",
    ],
    dataQuality: {
      quote: "OK",
      kbar: "OK",
      chip: "OK",
      news: "STALE",
      quant: "OK",
      confidencePenalty: 0.05,
    },
    sourceTrail: [
      { type: "quant", source: "MAIN_v34", timestamp: "2026-05-14T01:00:00.000Z" },
      { type: "chip", source: "etf_subscription", timestamp: "2026-05-14T06:00:00.000Z" },
    ],
    generatedBy: "iuf_recommendation_orchestrator_v1",
  },
  {
    recommendationId: "rec_2454_20260514",
    ticker: "2454",
    companyName: "聯發科",
    rank: 3,
    action: "等回檔",
    direction: "中性",
    timeHorizon: "1-2週",
    confidence: 0.55,
    totalScore: 58,
    quant: {
      score: 62,
      strategySource: "cont_liq_v36",
      gateStatus: "WATCH",
      reason: ["訊號 WATCH — 流動性略弱", "等待量能確認"],
    },
    entryZone: {
      primary: "1050–1070",
      reason: "前低支撐帶若回測",
    },
    invalidation: {
      price: 1010,
      rule: "跌破 880 主升結構失效，建議離場觀察",
    },
    targets: [
      { label: "TP1", price: 1120, reason: "前波整理高點" },
    ],
    positionSizing: {
      suggestion: "小倉",
      maxRiskPct: 1.0,
    },
    reasons: {
      technical: ["日 RSI 背離初現"],
      chip: ["融資維持高水位待觀察"],
      news: ["手機 SoC 需求回溫訊號"],
      theme: ["5G 手機", "AIoT"],
      quant: ["cont_liq_v36 WATCH — 流動性分數 0.62"],
      macro: [],
    },
    risks: [
      "手機終端需求不確定性",
      "融資爆量賣壓潛在風險",
    ],
    dataQuality: {
      quote: "OK",
      kbar: "OK",
      chip: "OK",
      news: "OK",
      quant: "WEAK",
      confidencePenalty: 0.1,
    },
    sourceTrail: [
      { type: "quant", source: "cont_liq_v36", timestamp: "2026-05-14T01:00:00.000Z" },
    ],
    generatedBy: "iuf_recommendation_orchestrator_v1",
  },
];

export function getMockRecommendations(): StockRecommendation[] {
  const date = todayTstDate();
  const generatedAt = new Date().toISOString();
  return MOCK_RECS.map((r) => ({ ...r, date, generatedAt }));
}

export function getMockRecommendationById(
  id: string
): StockRecommendation | null {
  const all = getMockRecommendations();
  return all.find((r) => r.recommendationId === id) ?? null;
}

/** Lookup by id across real or mock data (for GET /:id endpoint) */
export function getRecommendationById(
  items: StockRecommendation[],
  id: string
): StockRecommendation | null {
  return items.find((r) => r.recommendationId === id) ?? null;
}
