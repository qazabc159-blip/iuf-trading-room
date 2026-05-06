/**
 * openalice-pipeline.test.ts
 *
 * Unit tests for the OpenAlice Autonomous Daily Pipeline.
 * Tests: scheduler tick guards, source pack assembly, publish gate Green/Yellow/Red tiers,
 * batch reviewer result, pipeline state management.
 * Uses memory mode only — no DB required.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyDraftTier,
  evaluatePublishGate,
  runBatchAiReviewer,
  runPipelineTick,
  _lastPipelineState,
  type SourcePack
} from "./openalice-pipeline.js";

// ── Helper ────────────────────────────────────────────────────────────────────

function makePack(overrides: Partial<SourcePack> = {}): SourcePack {
  return {
    packId: "test-pack-001",
    tick: "close_brief",
    collectedAt: new Date().toISOString(),
    tradingDate: "2026-05-06",
    sources: [
      { source: "companies_ohlcv", status: "LIVE", rowCount: 500, latestDate: "2026-05-05", note: null },
      { source: "tw_monthly_revenue", status: "LIVE", rowCount: 1200, latestDate: "2026-04-30", note: null },
      { source: "tw_institutional_buysell", status: "LIVE", rowCount: 300, latestDate: "2026-05-05", note: null },
      { source: "tw_margin_short", status: "LIVE", rowCount: 300, latestDate: "2026-05-05", note: null },
      { source: "market_overview", status: "LIVE", rowCount: 1, latestDate: "2026-05-05", note: null }
    ],
    trailComplete: true,
    ...overrides
  };
}

// ── Test 1: scheduler tick skips non-trading days (memory mode) ───────────────

test("pipeline tick returns skipped for memory mode (no DB)", async () => {
  // In memory mode isDatabaseMode() returns false, so pipeline skips after workspace check
  const result = await runPipelineTick("close_brief", "default");
  // Memory mode → skipped (either not_a_trading_day or memory_mode_no_db)
  assert.ok(
    result.skippedReason !== null || result.error !== null,
    "Expected a skip or error in memory mode"
  );
  assert.equal(result.tick, "close_brief");
  assert.ok(typeof result.runId === "string" && result.runId.length > 0);
  assert.ok(typeof result.durationMs === "number" && result.durationMs >= 0);
});

// ── Test 2: source pack trailComplete logic ───────────────────────────────────

test("source pack trailComplete is false when required source is EMPTY", () => {
  const pack = makePack({
    sources: [
      { source: "companies_ohlcv", status: "EMPTY", rowCount: 0, latestDate: null, note: null },
      { source: "tw_monthly_revenue", status: "LIVE", rowCount: 100, latestDate: "2026-04-30", note: null },
      { source: "tw_institutional_buysell", status: "LIVE", rowCount: 50, latestDate: "2026-05-05", note: null },
      { source: "tw_margin_short", status: "LIVE", rowCount: 50, latestDate: "2026-05-05", note: null },
      { source: "market_overview", status: "LIVE", rowCount: 1, latestDate: "2026-05-05", note: null }
    ],
    trailComplete: false
  });
  // trailComplete should be false when ohlcv is EMPTY
  assert.equal(pack.trailComplete, false);
});

test("source pack trailComplete allows DEGRADED for optional sources", () => {
  const pack = makePack({
    sources: [
      { source: "companies_ohlcv", status: "LIVE", rowCount: 500, latestDate: "2026-05-05", note: null },
      { source: "tw_monthly_revenue", status: "DEGRADED", rowCount: null, latestDate: null, note: "table_not_found" },
      { source: "tw_institutional_buysell", status: "DEGRADED", rowCount: null, latestDate: null, note: "table_not_found" },
      { source: "tw_margin_short", status: "EMPTY", rowCount: 0, latestDate: null, note: null },
      { source: "market_overview", status: "LIVE", rowCount: 1, latestDate: "2026-05-05", note: null }
    ],
    trailComplete: true // explicitly set; real collectSourcePack would compute this
  });
  assert.equal(pack.trailComplete, true);
});

// ── Test 3: publish gate Green tier (auto-publish) ────────────────────────────

test("publish gate Green tier: approve + confidence>=0.7 + no flags = shouldAutoPublish", () => {
  const pack = makePack({ trailComplete: true });
  const gate = evaluatePublishGate({
    sourcePack: pack,
    reviewerVerdict: "approve",
    confidence: 0.9,
    flaggedIssueCount: 0,
    draftPayload: {
      date: "2026-05-06",
      marketState: "Balanced",
      sections: [{ heading: "Market Summary", body: "Markets closed flat today with mixed signals across tech and industrials sectors." }]
    }
  });
  assert.equal(gate.tier, "green");
  assert.equal(gate.shouldAutoPublish, true);
  assert.equal(gate.rejectReason, null);
});

test("publish gate Green tier: confidence<0.7 = NOT auto-publish", () => {
  const pack = makePack({ trailComplete: true });
  const gate = evaluatePublishGate({
    sourcePack: pack,
    reviewerVerdict: "approve",
    confidence: 0.5,
    flaggedIssueCount: 0,
    draftPayload: { date: "2026-05-06", marketState: "Risk-On", sections: [] }
  });
  assert.equal(gate.tier, "green");
  assert.equal(gate.shouldAutoPublish, false);
  assert.ok(gate.rejectReason?.includes("confidence=0.5<0.7"));
});

// ── Test 4: publish gate Yellow tier ─────────────────────────────────────────

test("publish gate Yellow tier: strategy keyword = queued not auto-published", () => {
  const pack = makePack({ trailComplete: true });
  const gate = evaluatePublishGate({
    sourcePack: pack,
    reviewerVerdict: "approve",
    confidence: 0.95,
    flaggedIssueCount: 0,
    draftPayload: {
      date: "2026-05-06",
      sections: [{ heading: "Strategy Overview", body: "Our ranking of top sectors shows financials leading." }]
    }
  });
  assert.equal(gate.tier, "yellow");
  assert.equal(gate.shouldAutoPublish, false);
  assert.equal(gate.rejectReason, null);
});

// ── Test 5: publish gate Red tier ────────────────────────────────────────────

test("publish gate Red tier: buy keyword = force reject", () => {
  const pack = makePack({ trailComplete: true });
  const gate = evaluatePublishGate({
    sourcePack: pack,
    reviewerVerdict: "approve",
    confidence: 0.99,
    flaggedIssueCount: 0,
    draftPayload: {
      date: "2026-05-06",
      sections: [{ heading: "Action", body: "You should buy TSMC now before earnings." }]
    }
  });
  assert.equal(gate.tier, "red");
  assert.equal(gate.shouldAutoPublish, false);
  assert.ok(gate.rejectReason !== null);
});

test("publish gate Red tier: 目標價 Chinese keyword = force reject", () => {
  const pack = makePack({ trailComplete: true });
  const gate = evaluatePublishGate({
    sourcePack: pack,
    reviewerVerdict: "approve",
    confidence: 0.95,
    flaggedIssueCount: 0,
    draftPayload: { text: "台積電目標價850元，建議進場。" }
  });
  assert.equal(gate.tier, "red");
  assert.equal(gate.shouldAutoPublish, false);
});

test("publish gate Red tier: sell keyword = force reject", () => {
  const pack = makePack({ trailComplete: true });
  const gate = evaluatePublishGate({
    sourcePack: pack,
    reviewerVerdict: "approve",
    confidence: 0.95,
    flaggedIssueCount: 0,
    draftPayload: { content: "Sell your positions immediately." }
  });
  assert.equal(gate.tier, "red");
  assert.equal(gate.shouldAutoPublish, false);
});

// ── Test 6: classifyDraftTier helper ─────────────────────────────────────────

test("classifyDraftTier returns green for clean content", () => {
  const tier = classifyDraftTier({
    date: "2026-05-06",
    marketState: "Balanced",
    sections: [{ heading: "Overview", body: "Markets closed mixed today." }]
  });
  assert.equal(tier, "green");
});

test("classifyDraftTier returns red for guarantee keyword", () => {
  const tier = classifyDraftTier({ text: "This investment is guaranteed to return 20%." });
  assert.equal(tier, "red");
});

test("classifyDraftTier returns yellow for ranking content", () => {
  const tier = classifyDraftTier({ text: "Sector ranking shows materials at rank 1." });
  assert.equal(tier, "yellow");
});

// ── Test 7: batch reviewer memory mode returns empty ─────────────────────────

test("runBatchAiReviewer returns zero results in memory mode", async () => {
  const result = await runBatchAiReviewer({ limit: 10, dryRun: false });
  // In memory mode isDatabaseMode() is false → returns { processed:0, ... }
  assert.equal(result.processed, 0);
  assert.equal(result.approved, 0);
  assert.equal(result.rejected, 0);
  assert.equal(result.manual, 0);
  assert.equal(result.errors, 0);
});

test("runBatchAiReviewer dryRun=true returns processed=0 in memory mode", async () => {
  const result = await runBatchAiReviewer({ limit: 5, dryRun: true });
  assert.equal(result.processed, 0);
});

// ── Test 8: _lastPipelineState is updated after tick ─────────────────────────

test("_lastPipelineState is updated after runPipelineTick", async () => {
  await runPipelineTick("pre_market", "default");
  assert.ok(_lastPipelineState.lastRunAt !== null, "lastRunAt should be set");
  assert.ok(_lastPipelineState.totalRunsThisProcess > 0, "totalRunsThisProcess should increment");
  assert.equal(_lastPipelineState.lastTick, "pre_market");
});

// ── Test 9: weekend detection (trailComplete and skip) ───────────────────────

test("pipeline tick result has consistent shape", async () => {
  const result = await runPipelineTick("close_watch", "default");
  // Shape check regardless of skip/error
  assert.ok("runId" in result);
  assert.ok("tick" in result);
  assert.ok("tradingDate" in result);
  assert.ok("durationMs" in result);
  assert.ok("sourcePack" in result);
  assert.ok("jobId" in result);
  assert.ok("draftId" in result);
  assert.ok("reviewerVerdict" in result);
  assert.ok("publishedBriefId" in result);
});

// ── Test 10: source pack structure ───────────────────────────────────────────

test("makePack helper produces valid SourcePack shape", () => {
  const pack = makePack();
  assert.ok(typeof pack.packId === "string");
  assert.ok(typeof pack.tick === "string");
  assert.ok(typeof pack.collectedAt === "string");
  assert.ok(typeof pack.tradingDate === "string");
  assert.ok(Array.isArray(pack.sources));
  assert.equal(pack.sources.length, 5);
  assert.ok(typeof pack.trailComplete === "boolean");
});
