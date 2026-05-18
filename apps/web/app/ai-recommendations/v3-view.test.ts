import { describe, expect, it } from "vitest";

import {
  buildV3PanelState,
  getOfficialAnnouncementSourceState,
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
      why_buy: ["技術結構仍在多方", "題材與量能同步"],
      why_not_buy: ["盤中跌破支撐要降風險"],
      source: "brain_react_v2",
    }, {
      status: "complete",
      itemCount: 1,
      fullAiReportParsed: true,
      synthesisRetryUsed: false,
      synthesisFallbackUsed: false,
      usedFallback: false,
      officialAnnouncementSourceState: { state: "live", lastUpdated: "2026-05-19T01:00:00Z" },
    });

    expect(card).toMatchObject({
      ticker: "2330",
      company_name: "台積電",
      bucket: "B",
      confidence: 0.82,
      entry: { ote_low: 820, ote_high: 850, label: "OTE 0.618-0.705" },
      targets: { tp1: 900, tp2: 960, sl: 790, r_value: 2.1 },
      market_multiplier: 1,
      source: "brain_react_v2",
    });
    expect(card?.sub_scores?.total).toBe(74);
    expect(card?.why_buy).toContain("技術結構");
    expect(card?.risk).toContain("盤中跌破支撐");
    expect(card?.synthesisFlags).toMatchObject({
      fullAiReportParsed: true,
      synthesisRetryUsed: false,
      synthesisFallbackUsed: false,
      usedFallback: false,
    });
    expect(card?.officialAnnouncementSourceState?.state).toBe("live");
  });

  it("returns null instead of fabricating a card when ticker is absent", () => {
    expect(mapV3ItemToStockRecCard({ ticker: "" })).toBeNull();
  });

  it("localizes deterministic fallback narratives instead of exposing raw English backend copy", () => {
    const card = mapV3ItemToStockRecCard({
      ticker: "2059",
      companyName: "川湖",
      entryZone: { reason: "Programmatic fallback range: 0.98x-1.01x of verified lastPrice." },
      why_buy: [
        "Verified technical data was available from get_company_technical.",
        "Price is above MA20.",
      ],
      why_not_buy: [
        "This is a deterministic fallback because the LLM did not return enough structured picks.",
        "Treat as research candidates until the full AI narrative is healthy.",
      ],
    });

    expect(card?.entry?.label).toContain("fallback 進場區間");
    expect(card?.why_buy).toContain("get_company_technical 已回傳可驗證技術資料");
    expect(card?.why_buy).toContain("價格站上 MA20");
    expect(card?.risk).toContain("完整 AI 敘事恢復健康前");
  });

  it("marks non-complete five-card fallback responses as degraded instead of live", () => {
    const state = buildV3PanelState({
      data: {
        status: "synthesis_format_error",
        itemCount: 5,
        items: Array.from({ length: 5 }, (_, index) => ({ ticker: `23${index}` })),
        usedFallback: true,
        fullAiReportParsed: false,
        synthesisRetryUsed: false,
        synthesisFallbackUsed: true,
      },
      error: null,
      visibleCount: 5,
    });

    expect(state.tone).toBe("degraded");
    expect(state.label).toBe("DEGRADED");
    expect(state.title).toContain("not complete");
    expect(state.detail).toContain("status=synthesis_format_error");
    expect(state.detail).toContain("itemCount=5");
    expect(state.detail).toContain("usedFallback=true");
    expect(state.detail).toContain("fullAiReportParsed=false");
  });

  it("shows an explicit pending state instead of padding when itemCount is under five", () => {
    const state = buildV3PanelState({
      data: {
        status: "complete",
        itemCount: 3,
        items: [{ ticker: "2330" }, { ticker: "2317" }, { ticker: "2603" }],
        usedFallback: false,
        fullAiReportParsed: true,
      },
      error: null,
      visibleCount: 3,
    });

    expect(state.tone).toBe("degraded");
    expect(state.detail).toContain("itemCount=3");
    expect(state.detail).toContain("not padding");
  });

  it("derives official announcement source state or exposes the missing backend field", () => {
    expect(getOfficialAnnouncementSourceState({
      officialAnnouncementSourceState: { state: "live", owner: "Jason" },
    })).toMatchObject({ label: "官方公告 source state", state: "live", owner: "Jason" });

    expect(getOfficialAnnouncementSourceState({ status: "complete", items: [] })).toMatchObject({
      label: "官方公告 source state",
      state: "pending",
      owner: "Jason/Elva",
    });
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

  it("maps ReAct trace safely and includes source state observations", () => {
    const steps = mapV3TraceSteps([
      { step: 1, label: "市場狀態", observation: { source: "twse_openapi", sourceState: "live" } },
      { step: 9, label: "bad" },
    ]);

    expect(steps).toHaveLength(1);
    expect(steps?.[0]).toMatchObject({ step: 1, label: "市場狀態" });
    expect(steps?.[0]?.observation).toContain("source=twse_openapi");
    expect(steps?.[0]?.observation).toContain("sourceState=live");
  });

  it("renders a blocked state without stale PR next-action copy", () => {
    const state = buildV3PanelState({
      data: null,
      error: "401 unauthenticated",
      visibleCount: 0,
    });

    expect(state.tone).toBe("blocked");
    expect(state.endpoint).toBe("GET /api/v1/ai-recommendations/v3");
    expect(state.nextAction).toContain("owner session");
    expect(state.nextAction).not.toContain("#703");
  });

  it("renders live only when complete, enough, parsed, and non-fallback", () => {
    const state = buildV3PanelState({
      data: {
        status: "complete",
        itemCount: 5,
        items: Array.from({ length: 5 }, (_, index) => ({ ticker: `23${index}` })),
        usedFallback: false,
        fullAiReportParsed: true,
        synthesisFallbackUsed: false,
      },
      error: null,
      visibleCount: 5,
    });

    expect(state.tone).toBe("live");
    expect(state.detail).toContain("itemCount=5");
  });
});
