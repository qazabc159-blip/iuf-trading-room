import type { LabStrategySnapshot } from "@/lib/api";
import type { S1Basket, S1SimStatus } from "@/lib/fauto-sim-api";

export type StrategyHolding = {
  symbol: string;
  name?: string;
  weight: number;
  price: number;
  note: string;
};

export type StrategyCurvePoint = {
  date: string;
  value: number;
  drawdown?: number;
  periodReturn?: number;
};

export type DisplayStatus = "PASS" | "WATCH" | "FAIL" | null;

export type QuantStrategy = {
  id: string;
  name: string;
  shortName: string;
  role: string;
  cadence: string;
  basketSize: string;
  accent: "gold" | "cyan" | "green";
  maturity: string;
  signal: string;
  displayStatus: DisplayStatus;
  logic: string[];
  sizing: string[];
  riskControls: string[];
  caveats: string[];
  metrics: {
    netReturnPct: number | null;
    benchmarkPct?: number;
    excessPct?: number;
    strictOosPct?: number;
    sharpe: number | null;
    sharpeLabel?: string;
    maxDrawdownPct: number | null;
    hitRatePct: number | null;
    sampleCount: number | null;
  };
  current: {
    asOf: string | null;
    status: string;
    primaryReadout: string;
    secondaryReadout: string;
    sourceLabel: string;
    researchWindow: string | null;
    dataState: "LIVE" | "PARTIAL" | "UNAVAILABLE";
  };
  holdings: StrategyHolding[];
  curve: StrategyCurvePoint[];
  bars: StrategyCurvePoint[];
};

export const QUANT_STRATEGIES: QuantStrategy[] = [
  {
    id: "cont_liq_v36",
    name: "S1 連續動能流動性策略",
    shortName: "S1",
    role: "F-AUTO KGI SIM 觀察主策略",
    cadence: "每週二 08:30 產生訊號、09:00-09:20 送出 SIM",
    basketSize: "Top 8 台股",
    accent: "gold",
    displayStatus: "WATCH",
    maturity: "Forward observation / KGI SIM only",
    signal:
      "以台股流動性池計算 20 日動能與 5/20 日量能比，做橫斷面 z-score 加總，依市場態勢決定曝險，再挑選前 8 檔送入 KGI SIM。",
    logic: [
      "Universe 來自 Trading Room 公司池，只允許台股四碼股票，排除資料不足或停牌標的。",
      "分數 = z(20 日報酬) + z(5 日均量 / 20 日均量)，用量價同步改善的股票當候選。",
      "用 0050 或市場中位數判斷 regime：risk_on 滿倉、sideways 半倉、risk_off 降到 20%、crisis 不下單。",
      "目前 Trading Room 正式量化只開 S1；其他策略先不放在產品頁，避免使用者誤以為可以執行。",
    ],
    sizing: [
      "你在本頁輸入的 SIM 資金會寫入後端 quant_strategy.subscribe audit log。",
      "S1 runner 產生 basket 時會讀取最新 S1 訂閱資金，依 regime 曝險權重換算每檔目標金額。",
      "下單股數以整張向下取整；若流動性容量超過 ADV 約束，會降股數或標註 capacity warning。",
    ],
    riskControls: [
      "全程 SIM-only，KGI real order path 保持鎖定。",
      "沒有 basket 就不送單；KGI 登入、帳號或 gateway 異常只記 failsafe，不硬下單。",
      "每次訊號、委託與 EOD 報告都寫入 reports/trading_room，/ops/f-auto 可追蹤狀態。",
    ],
    caveats: [
      "S1 目前是觀察窗，不是正式投資建議，不宣稱 L5/L10 或 alpha 已確認。",
      "今天若已錯過週二 08:30/09:00 視窗，新的資金設定會套用到下一次 S1 signal run，除非另開 owner-only catch-up。",
    ],
    metrics: {
      netReturnPct: null,
      sharpe: null,
      sharpeLabel: "等待核准快照",
      maxDrawdownPct: null,
      hitRatePct: null,
      sampleCount: null,
    },
    current: {
      asOf: null,
      status: "等待 S1 執行狀態",
      primaryReadout: "等待後端資金與 basket",
      secondaryReadout: "SIM-only，真單保持鎖定",
      sourceLabel: "尚未取得後端資料",
      researchWindow: null,
      dataState: "UNAVAILABLE",
    },
    holdings: [],
    curve: [],
    bars: [],
  },
];

export type QuantStrategyLiveData = {
  snapshot: LabStrategySnapshot | null;
  status: S1SimStatus | null;
  basket: S1Basket | null;
};

function percentFromFraction(value: number | null | undefined) {
  return value == null || !Number.isFinite(value) ? null : value * 100;
}

function formatMoney(value: number | null | undefined) {
  return value == null
    ? "尚未取得資金設定"
    : `${Math.round(value).toLocaleString("zh-TW")} TWD`;
}

function buildHoldings(basket: S1Basket | null, configuredCapitalTwd: number | null) {
  if (!basket?.found || !configuredCapitalTwd || configuredCapitalTwd <= 0) return [];
  return basket.items
    .filter((item) => item.symbol !== "--" && item.price != null && item.price > 0)
    .map((item) => ({
      symbol: item.symbol,
      weight: (item.targetNotionalTwd ?? 0) / configuredCapitalTwd,
      price: item.price ?? 0,
      note: [
        item.shares == null ? null : `${item.shares.toLocaleString("zh-TW")} 股`,
        item.score == null ? null : `策略分數 ${item.score.toFixed(2)}`,
        item.sizingNote,
      ].filter(Boolean).join(" / "),
    }));
}

export function hydrateQuantStrategy(
  strategy: QuantStrategy,
  live: QuantStrategyLiveData,
): QuantStrategy {
  const snapshot = live.snapshot;
  const status = live.status;
  const basket = live.basket;
  const metrics = snapshot?.headlineMetrics;
  const hasResearch = Boolean(snapshot && metrics);
  const hasOperations = Boolean(status && basket?.found);
  const dataState = hasResearch && hasOperations ? "LIVE" : hasResearch || status ? "PARTIAL" : "UNAVAILABLE";
  const basketDate = basket?.found ? basket.date : status?.lastSignalDate ?? null;
  const regime = basket?.regime ?? status?.regime ?? null;
  const exposureWeight = basket?.exposureWeight ?? status?.exposureWeight ?? null;
  const basketSize = basket?.found ? basket.items.length : status?.latestBasketSize ?? null;
  const researchStart = snapshot?.commonWindowStart ?? snapshot?.spec.commonWindowStart ?? null;
  const researchEnd = snapshot?.commonWindowEnd ?? snapshot?.spec.commonWindowEnd ?? null;
  const researchWindow = researchStart && researchEnd ? `${researchStart} 至 ${researchEnd}` : null;

  return {
    ...strategy,
    basketSize: basketSize == null ? "等待最新 basket" : `最新 ${basketSize} 檔`,
    maturity: snapshot?.status ?? strategy.maturity,
    displayStatus: dataState === "UNAVAILABLE" ? "FAIL" : "WATCH",
    metrics: {
      netReturnPct: metrics?.strategyNetAbsoluteReturnPct ?? null,
      benchmarkPct: metrics?.benchmark0050ReturnPct,
      excessPct: metrics?.excessVs0050Pp,
      strictOosPct: percentFromFraction(metrics?.strictOosLast) ?? undefined,
      sharpe: metrics?.sharpeAnnualized ?? null,
      sharpeLabel: metrics?.sharpeAnnualized == null ? "等待核准快照" : undefined,
      maxDrawdownPct: percentFromFraction(metrics?.maxDrawdownNetPct ?? metrics?.maxDrawdown),
      hitRatePct: percentFromFraction(metrics?.hitRatePct ?? metrics?.hitRate),
      sampleCount: metrics?.totalRebalances ?? snapshot?.panelWindow?.rebalancePeriods ?? null,
    },
    current: {
      asOf: basketDate,
      status: basketDate
        ? `最新 ${basketDate} basket：${regime ?? "態勢未標示"} / ${
            exposureWeight == null ? "曝險未標示" : `${Math.round(exposureWeight * 100)}% 曝險`
          } / ${basketSize ?? 0} 檔`
        : "尚未產生可讀取的 S1 basket",
      primaryReadout: `${formatMoney(status?.configuredCapitalTwd)} / ${
        status?.capitalSource ?? "資金來源未標示"
      }`,
      secondaryReadout: status?.automaticScheduler.enabled
        ? `自動排程已啟用；${status.automaticScheduler.signalWindowTst ?? "訊號視窗未標示"}`
        : "自動排程未啟用；SIM-only，真單保持鎖定",
      sourceLabel: [
        hasResearch ? "核准研究快照" : null,
        basket?.found ? `S1 basket (${basket.source ?? "後端"})` : null,
        status ? "S1 執行狀態" : null,
      ].filter(Boolean).join(" + ") || "尚未取得後端資料",
      researchWindow,
      dataState,
    },
    holdings: buildHoldings(basket, status?.configuredCapitalTwd ?? basket?.capitalTwd ?? null),
    curve: (snapshot?.equityCurve.points ?? []).map((point) => ({
      date: point.date,
      value: point.cumReturn * 100,
      drawdown: point.drawdown * 100,
    })),
    bars: (snapshot?.monthlyReturns.bars ?? []).map((bar) => ({
      date: bar.yearMonth,
      value: bar.monthReturn * 100,
    })),
  };
}

export function getQuantStrategy(
  strategyId: string,
  live?: QuantStrategyLiveData,
): QuantStrategy | null {
  const strategy = QUANT_STRATEGIES.find((item) => item.id === strategyId) ?? null;
  return strategy && live ? hydrateQuantStrategy(strategy, live) : strategy;
}
