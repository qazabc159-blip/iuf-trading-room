/**
 * Recommendation Orchestrator Store — v1 mock layer
 *
 * Day 1-2: Returns deterministic mock recommendations so frontend Codex can
 * integrate without waiting for real quant signal wiring (Day 3+).
 *
 * Day 3+ upgrade path: swap getMockRecommendations() body with real pipeline
 * that reads cont_liq_v36 + MAIN snapshots + news sentiment scores.
 *
 * Lane: strategy backend (Jason). Do NOT import from broker/*, risk-engine, market-data.
 */

import type { StockRecommendation } from "@iuf-trading-room/contracts";

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
// Mock recommendation generator
// ---------------------------------------------------------------------------
function todayTstDate(): string {
  // Returns YYYY-MM-DD in TST (UTC+8)
  const now = new Date(Date.now() + 8 * 60 * 60 * 1000);
  return now.toISOString().slice(0, 10);
}

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
      rule: "日收破 920 出場，停損 ~4%",
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
    action: "可布局",
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
      rule: "日收破 178 出場，停損 ~5%",
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
      rule: "日收破 1010 不介入",
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

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

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
