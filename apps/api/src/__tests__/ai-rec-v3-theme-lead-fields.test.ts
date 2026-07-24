import assert from "node:assert/strict";
import test from "node:test";

import {
  applyDeterministicMultiDimScoresToItems,
  enrichV3Items,
} from "../ai-recommendation-v2/orchestrator-v3.js";

// Field gap reported by Jim (reports/design_redesign_20260722/AI_REC_IMPL_FIELD_MAP_20260723.md,
// "已知缺口" #1/#2): v3 item had no theme/supply-chain context field and no independent
// lead-summary sentence field. This test pins the shape of the fix.

test("themeContext is populated verbatim from get_supply_chain trace observation", () => {
  const [item] = applyDeterministicMultiDimScoresToItems(
    [
      {
        id: "rec-2330",
        ticker: "2330",
        companyName: "台積電",
        date: "2026-07-24",
        action: "今日首選",
        confidence: 0.8,
        rationale: "test",
        aiGenerated: true,
        source: "brain_react_v2",
      } as any,
    ],
    [
      {
        round: 1,
        thought: "check supply chain",
        toolName: "get_supply_chain",
        toolInput: { ticker: "2330" },
        observation: {
          ticker: "2330",
          chainPosition: "CoAP_Chip",
          beneficiaryTier: "Core",
          themes: [{ name: "AI 伺服器", lifecycle: "Expansion" }],
          suppliers: [],
          customers: [],
          peers: [],
          dataAvailable: true,
          source: "company_graph_db",
        },
      },
    ] as any
  );

  assert.deepEqual(item.themeContext, {
    dataAvailable: true,
    chainPosition: "CoAP_Chip",
    beneficiaryTier: "Core",
    themes: [{ name: "AI 伺服器", lifecycle: "Expansion" }],
  });
});

test("themeContext reflects dataAvailable:false (not null) when get_supply_chain WAS called but company_graph_db has no row for the ticker", () => {
  const [item] = applyDeterministicMultiDimScoresToItems(
    [
      {
        id: "rec-9999",
        ticker: "9999",
        companyName: "測試股",
        date: "2026-07-24",
        action: "今日首選",
        confidence: 0.8,
        rationale: "test",
        aiGenerated: true,
        source: "brain_react_v2",
      } as any,
    ],
    [
      {
        round: 1,
        thought: "check supply chain",
        toolName: "get_supply_chain",
        toolInput: { ticker: "9999" },
        observation: {
          ticker: "9999",
          chainPosition: null,
          beneficiaryTier: null,
          themes: [],
          suppliers: [],
          customers: [],
          peers: [],
          dataAvailable: false,
          source: "company_graph_db",
        },
      },
    ] as any
  );

  // Distinguishes "tool never called" (themeContext === null) from
  // "tool called, DB has no row" (themeContext object with dataAvailable:false)
  // — frontend needs to tell these two honest-gap cases apart.
  assert.deepEqual(item.themeContext, {
    dataAvailable: false,
    chainPosition: null,
    beneficiaryTier: null,
    themes: [],
  });
});

test("themeContext is honestly null when get_supply_chain was never called for the ticker (no fabrication)", () => {
  const [item] = applyDeterministicMultiDimScoresToItems(
    [
      {
        id: "rec-2330",
        ticker: "2330",
        companyName: "台積電",
        date: "2026-07-24",
        action: "今日首選",
        confidence: 0.8,
        rationale: "test",
        aiGenerated: true,
        source: "brain_react_v2",
      } as any,
    ],
    []
  );

  assert.equal(item.themeContext, null);
});

test("leadSummary reuses the existing whyBuyBrief/oneLineReason value (no new LLM call)", () => {
  const [item] = enrichV3Items(
    [
      {
        id: "rec-2330",
        ticker: "2330",
        companyName: "台積電",
        date: "2026-07-24",
        action: "今日首選",
        confidence: 0.8,
        rationale: "test",
        aiGenerated: true,
        source: "brain_react_v2",
        whyBuyBrief: "月營收YoY+22%連加速+外資買超+技術面突破月線",
      } as any,
    ],
    []
  );

  assert.equal(item.leadSummary, "月營收YoY+22%連加速+外資買超+技術面突破月線");
});

test("leadSummary never diverges from whyBuyBrief — including the buildWhyBuyBrief() fallback path when the LLM omits oneLineReason but why_buy bullets exist (Pete review, PR #1362)", () => {
  const [item] = enrichV3Items(
    [
      {
        id: "rec-2330",
        ticker: "2330",
        companyName: "台積電",
        date: "2026-07-24",
        action: "今日首選",
        confidence: 0.8,
        rationale: "test",
        aiGenerated: true,
        source: "brain_react_v2",
        // no whyBuyBrief on input — LLM omitted oneLineReason this round —
        // but why_buy bullets exist, so buildWhyBuyBrief() derives a value.
        why_buy: ["外資連3日買超1.2萬張", "月營收YoY+15%加速"],
      } as any,
    ],
    []
  );

  assert.ok(item.whyBuyBrief, "whyBuyBrief should be derived from why_buy via buildWhyBuyBrief()");
  assert.equal(item.leadSummary, item.whyBuyBrief);
});

test("leadSummary is honestly null when the item has no LLM one-liner (deterministic fallback items)", () => {
  const [item] = enrichV3Items(
    [
      {
        id: "rec-2330",
        ticker: "2330",
        companyName: "台積電",
        date: "2026-07-24",
        action: "今日首選",
        confidence: 0.8,
        rationale: "test",
        aiGenerated: true,
        source: "brain_react_v2",
      } as any,
    ],
    []
  );

  assert.equal(item.leadSummary, null);
});
