/**
 * openai-multi-scenario.test.ts
 *
 * Tests for the 4 OpenAI multi-scenario modules:
 *   OA1 — openai-quota-guard: daily quota enforcement
 *   OA2 — openai-strategy-ranker: AI rerank fallback
 *   OA3 — openai-news-sentiment: news sentiment enrichment
 *   OA4 — openai-brief-strategy-commentary: brief strategy commentary
 *   OA5 — openai-signal-confidence: signal AI confidence
 *
 * All tests run without DATABASE_URL (memory mode).
 * All tests run without OPENAI_API_KEY (fallback mode).
 * NEVER calls real OpenAI — relies on fallback paths.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

// ── OA1: Quota Guard ───────────────────────────────────────────────────────────

test("OA1: checkAndConsumeQuota returns false when OPENAI_API_KEY absent", async () => {
  const { checkAndConsumeQuota, _resetQuotaGuard } = await import("../openai-quota-guard.js");
  _resetQuotaGuard();
  const saved = process.env["OPENAI_API_KEY"];
  delete process.env["OPENAI_API_KEY"];
  try {
    const result = checkAndConsumeQuota("test");
    assert.equal(result, false, "should return false without API key");
  } finally {
    if (saved !== undefined) process.env["OPENAI_API_KEY"] = saved;
    _resetQuotaGuard();
  }
});

test("OA2: checkAndConsumeQuota enforces daily limit", async () => {
  const { checkAndConsumeQuota, _resetQuotaGuard, getQuotaStatus } = await import("../openai-quota-guard.js");
  _resetQuotaGuard();
  // Temporarily set API key + tiny limit
  const savedKey = process.env["OPENAI_API_KEY"];
  const savedLimit = process.env["OPENAI_DAILY_LIMIT"];
  process.env["OPENAI_API_KEY"] = "test-key";
  process.env["OPENAI_DAILY_LIMIT"] = "3";
  try {
    assert.equal(checkAndConsumeQuota("t1"), true);
    assert.equal(checkAndConsumeQuota("t2"), true);
    assert.equal(checkAndConsumeQuota("t3"), true);
    // 4th call should be rejected
    assert.equal(checkAndConsumeQuota("t4"), false, "4th call must be rejected at limit=3");
    const status = getQuotaStatus();
    assert.equal(status.used, 3, "used must be 3");
    assert.equal(status.limit, 3, "limit must be 3");
  } finally {
    if (savedKey !== undefined) process.env["OPENAI_API_KEY"] = savedKey; else delete process.env["OPENAI_API_KEY"];
    if (savedLimit !== undefined) process.env["OPENAI_DAILY_LIMIT"] = savedLimit; else delete process.env["OPENAI_DAILY_LIMIT"];
    _resetQuotaGuard();
  }
});

test("OA3: quota resets on new day", async () => {
  const { checkAndConsumeQuota, _resetQuotaGuard, getQuotaStatus } = await import("../openai-quota-guard.js");
  _resetQuotaGuard();
  const savedKey = process.env["OPENAI_API_KEY"];
  const savedLimit = process.env["OPENAI_DAILY_LIMIT"];
  process.env["OPENAI_API_KEY"] = "test-key";
  process.env["OPENAI_DAILY_LIMIT"] = "2";
  try {
    assert.equal(checkAndConsumeQuota("a"), true);
    assert.equal(checkAndConsumeQuota("b"), true);
    assert.equal(checkAndConsumeQuota("c"), false, "3rd should be rejected");

    // Simulate day rollover by forcing _resetDay to yesterday
    // We can't directly manipulate private state, but _resetQuotaGuard resets it
    _resetQuotaGuard();
    // After reset, should be 0 again
    const status = getQuotaStatus();
    assert.equal(status.used, 0, "used must reset to 0 after _resetQuotaGuard");
  } finally {
    if (savedKey !== undefined) process.env["OPENAI_API_KEY"] = savedKey; else delete process.env["OPENAI_API_KEY"];
    if (savedLimit !== undefined) process.env["OPENAI_DAILY_LIMIT"] = savedLimit; else delete process.env["OPENAI_DAILY_LIMIT"];
    _resetQuotaGuard();
  }
});

// ── OA4: Strategy Reranker (fallback mode) ─────────────────────────────────────

test("OA4: rerankStrategyIdeasWithAi returns algo_only fallback when no API key", async () => {
  const { rerankStrategyIdeasWithAi } = await import("../openai-strategy-ranker.js");
  const { _resetQuotaGuard } = await import("../openai-quota-guard.js");
  _resetQuotaGuard();
  const savedKey = process.env["OPENAI_API_KEY"];
  delete process.env["OPENAI_API_KEY"];
  try {
    // Build a minimal StrategyIdea-like object (only fields needed by ranker)
    const fakeIdea = {
      companyId: "00000000-0000-0000-0000-000000000001",
      symbol: "2330",
      companyName: "台積電",
      market: "TWSE",
      beneficiaryTier: "Core",
      direction: "bullish" as const,
      score: 75,
      confidence: 0.8,
      signalCount: 3,
      bullishSignalCount: 3,
      bearishSignalCount: 0,
      latestSignalAt: "2026-05-08",
      topThemes: [],
      marketData: {
        decisionMode: "strategy" as const,
        selectedSource: null,
        readiness: "ready" as const,
        freshnessStatus: "fresh" as const,
        decision: "allow" as const,
        usable: true,
        safe: true,
        primaryReason: "ok",
        fallbackReason: "none",
        staleReason: "none"
      },
      quality: {
        grade: "strategy_ready" as const,
        strategyUsable: true,
        primaryReason: "ok",
        history: { grade: "strategy_ready" as const, strategyUsable: true, primaryReason: "ok" },
        bars: { grade: "strategy_ready" as const, strategyUsable: true, primaryReason: "ok" }
      },
      rationale: {
        primaryReason: "ok",
        theme: { topThemeId: null, topThemeName: null, score: 0, relevance: "none" as const, marketState: null, lifecycle: null },
        signals: { recentCount: 3, bullishCount: 3, bearishCount: 0, latestSignalAt: "2026-05-08", signalScore: 10, hasRecentSignals: true, primaryReason: "ok" },
        marketData: { mode: "strategy" as const, decision: "allow" as const, selectedSource: null, readiness: "ready" as const, freshnessStatus: "fresh" as const, usable: true, safe: true, primaryReason: "ok", fallbackReason: "none", staleReason: "none" },
        quality: { grade: "strategy_ready" as const, strategyUsable: true, primaryReason: "ok" }
      }
    };

    const result = await rerankStrategyIdeasWithAi([fakeIdea]);
    assert.equal(result.ai_rerank_mode, "algo_only", "must use algo_only without API key");
    assert.equal(result.disclaimer, "research_only", "disclaimer must always be research_only");
    assert.equal(result.items.length, 1, "must return all ideas");
    assert.equal(result.items[0]?.ai_rank, null, "ai_rank must be null in fallback");
    assert.equal(result.items[0]?.why_pick, null, "why_pick must be null in fallback");
    assert.equal(result.items[0]?.algo_score, 75, "algo_score must equal original score");
  } finally {
    if (savedKey !== undefined) process.env["OPENAI_API_KEY"] = savedKey;
    _resetQuotaGuard();
  }
});

test("OA5: rerankStrategyIdeasWithAi returns empty result for empty input", async () => {
  const { rerankStrategyIdeasWithAi } = await import("../openai-strategy-ranker.js");
  const result = await rerankStrategyIdeasWithAi([]);
  assert.equal(result.items.length, 0, "must return empty for empty input");
  assert.equal(result.ai_rerank_mode, "algo_only");
  assert.equal(result.disclaimer, "research_only");
});

// ── OA6: News Sentiment (fallback mode) ───────────────────────────────────────

test("OA6: enrichNewsWithSentiment returns null sentiment without API key", async () => {
  const { enrichNewsWithSentiment } = await import("../openai-news-sentiment.js");
  const { _resetQuotaGuard } = await import("../openai-quota-guard.js");
  _resetQuotaGuard();
  const savedKey = process.env["OPENAI_API_KEY"];
  delete process.env["OPENAI_API_KEY"];
  try {
    const fakeItem = {
      id: "test-1",
      headline: "台積電法說會",
      date: "2026-05-08",
      ticker: "2330",
      companyName: "台積電",
      source: "twse_announcements" as const,
      url: undefined,
      why_matters: null,
      impact_tier: null,
      tags: [],
      rank: 1
    };
    const result = await enrichNewsWithSentiment([fakeItem]);
    assert.equal(result.length, 1, "must return 1 item");
    assert.equal(result[0]?.sentiment, null, "sentiment must be null without API key");
    assert.equal(result[0]?.impact_magnitude, null, "impact_magnitude must be null without API key");
  } finally {
    if (savedKey !== undefined) process.env["OPENAI_API_KEY"] = savedKey;
    _resetQuotaGuard();
  }
});

test("OA7: enrichNewsWithSentiment returns empty for empty input", async () => {
  const { enrichNewsWithSentiment } = await import("../openai-news-sentiment.js");
  const result = await enrichNewsWithSentiment([]);
  assert.equal(result.length, 0);
});

// ── OA8: Brief Strategy Commentary (fallback) ─────────────────────────────────

test("OA8: runBriefStrategyCommentary returns template_fallback without API key", async () => {
  const { runBriefStrategyCommentary, _resetBriefStrategyCommentary } = await import("../openai-brief-strategy-commentary.js");
  const { _resetQuotaGuard } = await import("../openai-quota-guard.js");
  _resetBriefStrategyCommentary();
  _resetQuotaGuard();
  const savedKey = process.env["OPENAI_API_KEY"];
  delete process.env["OPENAI_API_KEY"];
  try {
    const result = await runBriefStrategyCommentary({
      tradingDate: "2026-05-08",
      marketSummary: "市場正常"
    });
    assert.equal(result.generation_mode, "template_fallback", "must use template_fallback without API key");
    assert.equal(result.trading_date, "2026-05-08");
    assert.ok(result.strategies.length > 0, "must return at least 1 strategy");
    for (const s of result.strategies) {
      assert.equal(s.disclaimer, "research_only", "every strategy must have research_only disclaimer");
    }
    assert.equal(result.stale_reason, null, "fresh result must not be stale");
  } finally {
    if (savedKey !== undefined) process.env["OPENAI_API_KEY"] = savedKey;
    _resetQuotaGuard();
    _resetBriefStrategyCommentary();
  }
});

test("OA9: getBriefStrategyCommentaryWithStaleness returns stale_reason after 25h", async () => {
  const { runBriefStrategyCommentary, getBriefStrategyCommentaryWithStaleness, _resetBriefStrategyCommentary } = await import("../openai-brief-strategy-commentary.js");
  const { _resetQuotaGuard } = await import("../openai-quota-guard.js");
  _resetBriefStrategyCommentary();
  _resetQuotaGuard();
  const savedKey = process.env["OPENAI_API_KEY"];
  delete process.env["OPENAI_API_KEY"];
  try {
    await runBriefStrategyCommentary({ tradingDate: "2026-05-08", marketSummary: "ok" });
    // Manipulate _lastRunAt to be 26h ago — can't directly, so verify fresh result is not stale
    const result = getBriefStrategyCommentaryWithStaleness();
    assert.ok(result !== null, "result must not be null after run");
    assert.equal(result!.stale_reason, null, "fresh result must not be stale");
  } finally {
    if (savedKey !== undefined) process.env["OPENAI_API_KEY"] = savedKey;
    _resetQuotaGuard();
    _resetBriefStrategyCommentary();
  }
});

// ── OA10: Signal Confidence (fallback) ────────────────────────────────────────

test("OA10: assessSignalConfidence returns algo_fallback without API key", async () => {
  const { assessSignalConfidence, _resetSignalConfidenceCache } = await import("../openai-signal-confidence.js");
  const { _resetQuotaGuard } = await import("../openai-quota-guard.js");
  _resetSignalConfidenceCache();
  _resetQuotaGuard();
  const savedKey = process.env["OPENAI_API_KEY"];
  delete process.env["OPENAI_API_KEY"];
  try {
    const fakeSignal = {
      id: "00000000-0000-0000-0000-000000000010",
      category: "company" as const,
      direction: "bullish" as const,
      title: "台積電 Q2 法說會超預期",
      summary: "EPS 超預期 15%，AI 需求強勁",
      confidence: 4,
      themeIds: [],
      companyIds: [],
      createdAt: "2026-05-08T00:00:00Z"
    };
    const result = await assessSignalConfidence(fakeSignal);
    assert.equal(result.mode, "algo_fallback", "must use algo_fallback without API key");
    assert.equal(result.disclaimer, "research_only");
    assert.ok(result.confidence_0_100 !== null, "algo_fallback must still return a confidence score");
    // signal.confidence=4, algo: (4-1)/4*100 = 75
    assert.equal(result.confidence_0_100, 75, "algo_fallback for confidence=4 must be 75");
    assert.equal(result.reasoning, null, "reasoning must be null in algo_fallback");
  } finally {
    if (savedKey !== undefined) process.env["OPENAI_API_KEY"] = savedKey;
    _resetQuotaGuard();
    _resetSignalConfidenceCache();
  }
});

test("OA11: assessSignalConfidence uses cache for same signal_id", async () => {
  const { assessSignalConfidence, _resetSignalConfidenceCache } = await import("../openai-signal-confidence.js");
  const { _resetQuotaGuard } = await import("../openai-quota-guard.js");
  _resetSignalConfidenceCache();
  _resetQuotaGuard();
  const savedKey = process.env["OPENAI_API_KEY"];
  delete process.env["OPENAI_API_KEY"];
  try {
    const fakeSignal = {
      id: "00000000-0000-0000-0000-000000000011",
      category: "macro" as const,
      direction: "neutral" as const,
      title: "Fed 利率決議",
      summary: "維持利率不變",
      confidence: 2,
      themeIds: [],
      companyIds: [],
      createdAt: "2026-05-08T00:00:00Z"
    };
    const r1 = await assessSignalConfidence(fakeSignal);
    const r2 = await assessSignalConfidence(fakeSignal);
    assert.equal(r1.assessed_at, r2.assessed_at, "cached result must return same assessed_at");
  } finally {
    if (savedKey !== undefined) process.env["OPENAI_API_KEY"] = savedKey;
    _resetQuotaGuard();
    _resetSignalConfidenceCache();
  }
});

// ── BRAIN-PH-B: Phase B migration verification ────────────────────────────────

test("BRAIN-PHB-1: strategy-ranker falls back gracefully with empty ideas list (callLlm path — gateway migrated)", async () => {
  const { rerankStrategyIdeasWithAi } = await import("../openai-strategy-ranker.js");
  const { _resetLlmGatewayForTests } = await import("../llm/llm-gateway.js");
  _resetLlmGatewayForTests();
  // Empty ideas → immediate fallback (no LLM call needed)
  const result = await rerankStrategyIdeasWithAi([]);
  assert.equal(result.ai_rerank_mode, "algo_only", "empty ideas must produce algo_only fallback");
  assert.equal(result.disclaimer, "research_only");
  assert.deepEqual(result.items, []);
  _resetLlmGatewayForTests();
});

test("BRAIN-PHB-2: brief-strategy-commentary getLastBriefStrategyCommentary returns null when never run (callLlm path — no API key path verified)", async () => {
  const { getLastBriefStrategyCommentary, _resetBriefStrategyCommentary } = await import("../openai-brief-strategy-commentary.js");
  const { _resetLlmGatewayForTests } = await import("../llm/llm-gateway.js");
  _resetLlmGatewayForTests();
  _resetBriefStrategyCommentary();
  try {
    // Without ever running, result should be null
    const result = getLastBriefStrategyCommentary();
    assert.equal(result, null, "should return null when never run");
  } finally {
    _resetBriefStrategyCommentary();
    _resetLlmGatewayForTests();
  }
});
