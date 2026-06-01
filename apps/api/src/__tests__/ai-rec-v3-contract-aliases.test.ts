import assert from "node:assert/strict";
import test from "node:test";

import { enrichV3Items } from "../ai-recommendation-v2/orchestrator-v3.js";

test("V3 enrichment adds PR-A card aliases without dropping source trail", () => {
  const [item] = enrichV3Items([
    {
      id: "rec-2330",
      ticker: "2330",
      companyName: "TSMC",
      date: "2026-06-01",
      action: "今日首選",
      confidence: 0.78,
      entryPriceRange: { low: 2300, high: 2400 },
      tp1: 2500,
      tp2: 2600,
      stopLoss: 2200,
      rationale: "advanced packaging and AI demand are improving",
      aiGenerated: true,
      source: "brain_react_v2",
      whyBuyBrief: "AI demand and margin structure are improving",
      why_not_buy: ["valuation remains high", "watch FX and index volatility"],
    } as any,
  ], [
    {
      round: 2,
      thought: "collect company data",
      toolName: "get_company_technical",
      toolInput: { ticker: "2330" },
      observation: { ticker: "2330", lastPrice: 2265, rsi14: 58 },
      tokensUsed: 120,
    },
  ] as any);

  assert.equal(item.entry, "2300-2400");
  assert.equal(item.stop, 2200);
  assert.equal(item.reason, "AI demand and margin structure are improving");
  assert.equal(item.risk, "valuation remains high; watch FX and index volatility");
  assert.equal(item.sourceTrail?.[0]?.toolName, "get_company_technical");
});
