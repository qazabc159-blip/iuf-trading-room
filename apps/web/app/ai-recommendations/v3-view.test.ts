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
      bucket: "B",
      totalScore: 68,
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

    expect(card?.entry?.label).toContain("最新可用成交價推估觀察區間");
    expect(card?.why_buy).toContain("量價技術資料已完成核對");
    expect(card?.why_buy).toContain("價格站上 MA20");
    expect(card?.risk).toContain("僅作研究候選");
    expect(`${card?.entry?.label}\n${card?.why_buy}\n${card?.risk}`).not.toMatch(/fallback|get_company_technical|LLM/i);
  });

  it("scrubs parser diagnostics from customer-facing card narratives", () => {
    const card = mapV3ItemToStockRecCard({
      ticker: "2330",
      companyName: "台積電",
      bucket: "A",
      totalScore: 76,
      entryZone: {
        low: 2280,
        high: 2320,
        reason: "trace=entryZone RSI parsing error; 靠近支撐區，等待量能確認。",
      },
      tp1Structured: { price: 2400 },
      tp2Structured: { price: 2480 },
      stopLossStructured: { price: 2240 },
      why_buy: [
        "trace=2330 technical parser diagnostic; 價格站上 MA20。",
        "institutional parsing error: missing rows; 產業鏈題材仍在主流觀察名單。",
      ],
      why_not_buy: [
        "rawSynthesisPreview returned parser noise; 若跌破支撐需降部位。",
      ],
      source: "brain_react_v2",
    });

    const productText = `${card?.entry?.label}\n${card?.why_buy}\n${card?.risk}`;
    expect(productText).toContain("靠近支撐區");
    expect(productText).toContain("價格站上 MA20");
    expect(productText).toContain("產業鏈題材");
    expect(productText).toContain("跌破支撐");
    expect(productText).not.toMatch(/trace=|parsing error|parser|diagnostic|rawSynthesisPreview|usedFallback/i);
  });

  // P1-4 (reports/product_critique_20260710/PRODUCT_CRITIQUE_v1.md): backend
  // sends the same risk content as a merged `risk` string AND an itemized
  // `risks` array. Old joinLines(item.risk, item.risks, ...) rendered both —
  // the merged sentence, then every point again individually.
  it("does not duplicate risk text when the backend sends both a merged risk string and an itemized risks array", () => {
    const card = mapV3ItemToStockRecCard({
      ticker: "3006",
      companyName: "晶豪科",
      bucket: "A",
      totalScore: 77,
      risk: "供應鏈資料company_graph_db顯示dataAvailable=false，主題分維持預設10。; 估值仍不便宜，PER 28.18。",
      risks: [
        "供應鏈資料company_graph_db顯示dataAvailable=false，主題分維持預設10。",
        "估值仍不便宜，PER 28.18。",
      ],
    });

    const occurrences = (card?.risk?.match(/估值仍不便宜/g) ?? []).length;
    expect(occurrences).toBe(1);
  });

  it("still falls back to why_not_buy for risk when risk/risks/riskFactors are all absent", () => {
    const card = mapV3ItemToStockRecCard({
      ticker: "2330",
      bucket: "B",
      totalScore: 68,
      why_not_buy: ["盤中跌破支撐要降風險"],
    });
    expect(card?.risk).toContain("盤中跌破支撐");
  });

  // P1-1: raw backend field names inside AI-generated risk narratives must be
  // translated to human Chinese, not shown verbatim.
  it("translates raw backend field-name fragments inside risk narratives into human Chinese", () => {
    const card = mapV3ItemToStockRecCard({
      ticker: "2317",
      bucket: "B",
      totalScore: 70,
      risk: "7/9成交量8545.9萬股但volumeRatio20d僅0.8；供應鏈資料dataAvailable=false，chainPosition與beneficiaryTier暫缺；產業鏈資料暫缺：company_graph_db 尚無定位。",
    });
    expect(card?.risk).not.toMatch(/volumeRatio20d|dataAvailable|company_graph_db|chainPosition|beneficiaryTier/);
    expect(card?.risk).toContain("20日均量比");
  });

  it("marks non-complete five-card fallback responses as degraded instead of live", () => {
    const state = buildV3PanelState({
      data: {
        status: "synthesis_format_error",
        itemCount: 5,
        items: Array.from({ length: 5 }, (_, index) => ({ ticker: `23${index}`, bucket: "B" as const, totalScore: 68 })),
        usedFallback: true,
        fullAiReportParsed: false,
        synthesisRetryUsed: false,
        synthesisFallbackUsed: true,
      },
      error: null,
      visibleCount: 5,
    });

    expect(state.tone).toBe("degraded");
    expect(state.label).toBe("需留意");
    expect(state.title).toContain("尚未完整");
    expect(state.detail).toContain("目前顯示 5 檔");
    expect(state.detail).toContain("不會補假資料");
  });

  it("shows an explicit pending state instead of padding when itemCount is under five", () => {
    const state = buildV3PanelState({
      data: {
        status: "complete",
        itemCount: 3,
        items: [
          { ticker: "2330", bucket: "B", totalScore: 68 },
          { ticker: "2317", bucket: "B", totalScore: 69 },
          { ticker: "2603", bucket: "B", totalScore: 70 },
        ],
        usedFallback: false,
        fullAiReportParsed: true,
      },
      error: null,
      visibleCount: 3,
    });

    expect(state.tone).toBe("degraded");
    expect(state.detail).toContain("目前顯示 3 檔");
    expect(state.detail).toContain("不會補假資料");
  });

  it("does not mark five high-risk exclusion cards as live recommendations", () => {
    const state = buildV3PanelState({
      data: {
        status: "complete",
        itemCount: 5,
        items: Array.from({ length: 5 }, (_, index) => ({
          ticker: `23${index}`,
          bucket: "C" as const,
          action: "高風險排除",
          totalScore: 56,
        })),
        usedFallback: false,
        fullAiReportParsed: true,
      },
      error: null,
      visibleCount: 0,
    });

    expect(state.tone).toBe("degraded");
    expect(state.title).toContain("今日沒有可行動 AI 推薦");
    expect(state.detail).toContain("高風險排除");
    expect(state.detail).toContain("不會把排除名單包裝成推薦");
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
        items: Array.from({ length: 5 }, (_, index) => ({ ticker: `23${index}`, bucket: "B" as const, totalScore: 68 })),
        usedFallback: false,
        fullAiReportParsed: true,
        synthesisFallbackUsed: false,
      },
      error: null,
      visibleCount: 5,
    });

    expect(state.tone).toBe("live");
    expect(state.detail).toContain("目前顯示 5 檔");
    expect(state.detail).toContain("未使用備援補牌");
  });
});
