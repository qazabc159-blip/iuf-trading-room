import { describe, expect, it } from "vitest";

import {
  buildV3PanelState,
  getV3MarketScores,
  mapV3ItemToStockRecCard,
  mapV3TraceSteps,
} from "./v3-view";

describe("AI recommendations v3 view mapping", () => {
  it("maps a backend v3 item into a visible stock recommendation card without padding", () => {
    const card = mapV3ItemToStockRecCard({
      ticker: "2330",
      companyName: "台積電",
      confidence: 0.82,
      marketState: "trend",
      marketScores: { trend: 4, range: 1, risk_off: 0 },
      subScores: {
        theme: 18,
        revenue: 12,
        institutional: 10,
        margin: 8,
        rs: 7,
        technical: 16,
        valuation: 3,
      },
      totalScore: 74,
      bucket: "B",
      entryZone: { low: 820, high: 850, reason: "OTE 0.618-0.705" },
      tp1Structured: { price: 900 },
      tp2Structured: { price: 960 },
      stopLossStructured: { price: 790 },
      r_ratio: 2.1,
      position_sizing: { nav_pct: 0.004, market_multiplier: 1 },
      why_buy: ["技術結構轉強", "主題與法人同步"],
      why_not_buy: ["跳空過熱須等回檔"],
    });

    expect(card).toMatchObject({
      ticker: "2330",
      company_name: "台積電",
      bucket: "B",
      confidence: 0.82,
      entry: { ote_low: 820, ote_high: 850, label: "OTE 0.618-0.705" },
      targets: { tp1: 900, tp2: 960, sl: 790, r_value: 2.1 },
      market_multiplier: 1,
    });
    expect(card?.sub_scores?.total).toBe(74);
    expect(card?.why_buy).toContain("技術結構轉強");
  });

  it("returns null instead of fabricating a card when ticker is absent", () => {
    expect(mapV3ItemToStockRecCard({ ticker: "" })).toBeNull();
  });

  it("derives the market state badge scores from the first scored item", () => {
    const scores = getV3MarketScores([
      { ticker: "2330", marketState: "range", marketScores: { trend: 2, range: 3, risk_off: 1 } },
    ]);

    expect(scores).toEqual({
      state: "range",
      trend_score: 2,
      range_score: 3,
      risk_off_score: 1,
      event_label: null,
    });
  });

  it("maps ReAct trace safely and ignores malformed rows", () => {
    const steps = mapV3TraceSteps([
      { step: 1, label: "市場狀態", observation: "trend_score=4" },
      { step: 9, label: "bad" },
    ]);

    expect(steps).toHaveLength(1);
    expect(steps?.[0]).toMatchObject({ step: 1, label: "市場狀態" });
  });

  it("renders a blocked state without stale PR next-action copy", () => {
    const state = buildV3PanelState({
      data: null,
      error: "401 unauthenticated",
      visibleCount: 0,
    });

    expect(state.tone).toBe("blocked");
    expect(state.endpoint).toBe("GET /api/v1/ai-recommendations/v3");
    expect(state.nextAction).toContain("owner-session");
    expect(state.nextAction).not.toContain("#703");
  });

  it("renders a live state only when real backend items are visible", () => {
    const state = buildV3PanelState({
      data: { status: "complete", items: [{ ticker: "2330" }] },
      error: null,
      visibleCount: 1,
    });

    expect(state.tone).toBe("live");
    expect(state.detail).toContain("1 檔正式 v3 推薦");
  });
});
