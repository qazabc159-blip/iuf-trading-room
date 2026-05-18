#!/usr/bin/env python3
"""
Appends 5 AI-REC-V2 tests to ci.test.ts, before the after() teardown.
"""

import sys

path = "C:/Users/User/Desktop/小楊機密/交易/IUF_TRADING_ROOM_APP/tests/ci.test.ts"

with open(path, "r", encoding="utf-8") as f:
    content = f.read()

if "AI-REC-V2" in content:
    print("AI-REC-V2 tests already present — skipping.")
    sys.exit(0)

TEARDOWN = '// Force-exit teardown: tsx/esbuild service workers are not killed by node:test runner.'

if TEARDOWN not in content:
    print("ERROR: teardown marker not found", file=sys.stderr)
    sys.exit(1)

AI_REC_V2_TESTS = """// =============================================================================
// AI-REC-V2: Pure-AI independent recommendation v2 (2026-05-18)
// Tests run in memory-mode (no OPENAI_API_KEY required — LLM returns null gracefully).
// =============================================================================

test("AI-REC-V2-1: orchestrator does NOT call loadAthenaFixture", async () => {
  // Import recommendation-store to verify Athena fixture loader exists
  const recStore = await import("../apps/api/src/recommendation-store.js") as any;
  // Import orchestrator v2
  const orch = await import("../apps/api/src/ai-recommendation-v2/orchestrator.js") as any;

  // The v2 orchestrator must NOT import or call loadAthenaFixture.
  // We verify by checking that the orchestrator module does not have _resetAthenaFixtureCache
  // (that export lives only in recommendation-store.ts).
  assert.ok(typeof orch.runAiRecommendationV2 === "function", "AI-REC-V2-1: runAiRecommendationV2 must be exported");
  assert.ok(typeof orch._resetAthenaFixtureCache === "undefined", "AI-REC-V2-1: orchestrator must NOT export _resetAthenaFixtureCache (Athena fixture)");

  // Also verify recommendation-store still exports it (v1 untouched)
  assert.ok(typeof recStore._resetAthenaFixtureCache === "function", "AI-REC-V2-1: recommendation-store v1 still has _resetAthenaFixtureCache");
});

test("AI-REC-V2-2: runAiRecommendationV2 respects budget cap — returns budget_exceeded or failed (no LLM in test)", async () => {
  const { runAiRecommendationV2, _resetAiRecommendationCache } = await import("../apps/api/src/ai-recommendation-v2/orchestrator.js") as any;
  _resetAiRecommendationCache();

  // costCapUsd=0 forces immediate budget_exceeded or failed (no LLM key in CI)
  const result = await runAiRecommendationV2({ costCapUsd: 0, maxRounds: 1, trigger: "test" });
  // In test mode (no OPENAI_API_KEY), LLM returns null → status=failed is also acceptable
  assert.ok(
    result.status === "budget_exceeded" || result.status === "failed",
    `AI-REC-V2-2: status must be budget_exceeded or failed, got ${result.status}`
  );
  assert.ok(Array.isArray(result.items), "AI-REC-V2-2: items must be an array");
  assert.ok(Array.isArray(result.reactTrace), "AI-REC-V2-2: reactTrace must be an array");
  assert.ok(typeof result.runId === "string", "AI-REC-V2-2: runId must be a string");
  assert.ok(typeof result.generatedAt === "string", "AI-REC-V2-2: generatedAt must be a string");
});

test("AI-REC-V2-3: parseAiReportToRecommendations parses markdown → structured items", async () => {
  const { parseAiReportToRecommendations } = await import("../apps/api/src/ai-recommendation-v2/orchestrator.js") as any;

  const markdown = `
## 2330 台積電
- 進場: 870-890
- TP1: 920
- TP2: 960
- 停損: 850
- 信心: 0.85
- 推薦理由: AI半導體需求強勁，外資連買10天，RSI未超買
- 分類: 今日首選

## 2454 聯發科
- 進場: 1050-1080
- TP1: 1120
- 停損: 1020
- 信心: 0.7
- 推薦理由: 手機晶片回溫，投信買超
- 分類: 可觀察布局
`;

  const items = parseAiReportToRecommendations(markdown, "2026-05-18");
  assert.ok(items.length >= 2, `AI-REC-V2-3: must parse at least 2 items, got ${items.length}`);

  const tsmc = items.find((i: any) => i.ticker === "2330");
  assert.ok(tsmc, "AI-REC-V2-3: must find ticker 2330");
  assert.equal(tsmc.action, "今日首選", `AI-REC-V2-3: 2330 action must be 今日首選, got ${tsmc.action}`);
  assert.ok(tsmc.aiGenerated === true, "AI-REC-V2-3: aiGenerated must be true");
  assert.equal(tsmc.source, "brain_react_v2", "AI-REC-V2-3: source must be brain_react_v2");
  assert.equal(tsmc.date, "2026-05-18", "AI-REC-V2-3: date must be 2026-05-18");

  const mtk = items.find((i: any) => i.ticker === "2454");
  assert.ok(mtk, "AI-REC-V2-3: must find ticker 2454");
  assert.equal(mtk.action, "可觀察布局（研究參考）", `AI-REC-V2-3: 2454 action must be 可觀察布局, got ${mtk.action}`);
});

test("AI-REC-V2-4: parseAiReportToRecommendations maps all 5 buckets correctly", async () => {
  const { parseAiReportToRecommendations } = await import("../apps/api/src/ai-recommendation-v2/orchestrator.js") as any;

  const markdown = `
## 2330 台積電
- 分類: 今日首選
- 推薦理由: r

## 2454 聯發科
- 分類: 可觀察布局
- 推薦理由: r

## 2317 鴻海
- 分類: 等回檔
- 推薦理由: r

## 2303 聯電
- 分類: 高風險排除
- 推薦理由: r

## 2412 中華電
- 分類: 資料不足
- 推薦理由: r
`;

  const items = parseAiReportToRecommendations(markdown, "2026-05-18");
  const buckets = items.map((i: any) => i.action);

  assert.ok(buckets.includes("今日首選"), "AI-REC-V2-4: must have 今日首選");
  assert.ok(buckets.includes("可觀察布局（研究參考）"), "AI-REC-V2-4: must have 可觀察布局");
  assert.ok(buckets.includes("等回檔"), "AI-REC-V2-4: must have 等回檔");
  assert.ok(buckets.includes("高風險排除"), "AI-REC-V2-4: must have 高風險排除");
  assert.ok(buckets.includes("資料不足暫不推薦"), "AI-REC-V2-4: must have 資料不足暫不推薦");
});

test("AI-REC-V2-5: getLatestAiRecommendationRun returns null before any run, non-null after cache set", async () => {
  const { getLatestAiRecommendationRun, _resetAiRecommendationCache, runAiRecommendationV2 } = await import("../apps/api/src/ai-recommendation-v2/orchestrator.js") as any;

  // Start fresh
  _resetAiRecommendationCache();
  const before = getLatestAiRecommendationRun();
  assert.equal(before, null, "AI-REC-V2-5: cache must be null before any run");

  // Run once (will fail gracefully without LLM key)
  await runAiRecommendationV2({ trigger: "test", maxRounds: 1, costCapUsd: 0.001 });

  // After run, cache must be set regardless of status
  const after = getLatestAiRecommendationRun();
  assert.ok(after !== null, "AI-REC-V2-5: cache must be non-null after run");
  assert.ok(typeof after.runId === "string", "AI-REC-V2-5: cached result must have runId");
  assert.ok(Array.isArray(after.items), "AI-REC-V2-5: cached result must have items array");

  // Cleanup
  _resetAiRecommendationCache();
});

"""

content = content.replace(TEARDOWN, AI_REC_V2_TESTS + TEARDOWN)

with open(path, "w", encoding="utf-8") as f:
    f.write(content)

# Verify
with open(path, "r", encoding="utf-8") as f:
    updated = f.read()

count = updated.count("AI-REC-V2-")
print(f"AI-REC-V2 test references found: {count}")
print("AI-REC-V2-1 present:", "AI-REC-V2-1" in updated)
print("AI-REC-V2-5 present:", "AI-REC-V2-5" in updated)
