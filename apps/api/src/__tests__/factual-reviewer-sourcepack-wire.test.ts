/**
 * factual-reviewer-sourcepack-wire.test.ts
 *
 * Unit coverage for the Layer 5 factual reviewer sourcePack pipe-through fix.
 * Pete audit 2026-05-08 finding: evaluatePipelinePublishGate always received
 * sourcePack=null because the job registry only stored summary strings.
 * Fix: _jobSourcePackMap stores full SourcePack objects; loadSourcePackForDraft
 * retrieves them at the gate call-site.
 *
 * Coverage:
 *   FS01: registerJobSourcePack → loadSourcePackForDraft returns the same pack
 *   FS02: loadSourcePackForDraft(null) → null (non-pipeline draft)
 *   FS03: loadSourcePackForDraft("unknown-job-id") → null (not registered / process restart)
 *   FS04: Registry eviction — after 101 insertions, oldest entry is gone
 *   FS05: sourcePack with sampleRows — load round-trips sampleRows intact
 *
 * Hard lines:
 *   - No HTTP. No DB. No OpenAI calls.
 *   - Only tests the registry + loadSourcePackForDraft pure functions.
 *   - Does NOT test the full gate (that requires DB mock or integration test).
 *
 * Run:
 *   node --test --import tsx/esm apps/api/src/__tests__/factual-reviewer-sourcepack-wire.test.ts
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  registerJobSourcePack,
  loadSourcePackForDraft,
  type SourcePack,
  type SourcePackEntry
} from "../openalice-pipeline.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeSourcePack(jobId: string, sampleRows?: Record<string, unknown>[]): SourcePack {
  const entry: SourcePackEntry = {
    source: "companies_ohlcv",
    status: "LIVE",
    rowCount: 10,
    latestDate: "2026-05-08",
    note: null,
    sampleRows: sampleRows ?? null
  };
  return {
    packId: `pack-${jobId}`,
    tick: "close_brief",
    collectedAt: new Date().toISOString(),
    tradingDate: "2026-05-08",
    sources: [entry],
    trailComplete: true
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test("FS01: registerJobSourcePack → loadSourcePackForDraft returns registered pack", () => {
  const jobId = `test-job-fs01-${Date.now()}`;
  const pack = makeSourcePack(jobId);
  registerJobSourcePack(jobId, pack);

  const result = loadSourcePackForDraft(jobId);
  assert.ok(result !== null, "Expected non-null SourcePack for registered jobId");
  assert.strictEqual(result!.packId, pack.packId, "packId should round-trip");
  assert.strictEqual(result!.trailComplete, true, "trailComplete should round-trip");
  assert.strictEqual(result!.sources.length, 1, "sources array should have 1 entry");
  assert.strictEqual(result!.sources[0]!.source, "companies_ohlcv", "source name should round-trip");
});

test("FS02: loadSourcePackForDraft(null) → null (non-pipeline draft)", () => {
  const result = loadSourcePackForDraft(null);
  assert.strictEqual(result, null, "null sourceJobId must return null (graceful degradation)");
});

test("FS03: loadSourcePackForDraft with unknown jobId → null (not registered)", () => {
  const result = loadSourcePackForDraft("job-that-was-never-registered-xyzzy");
  assert.strictEqual(result, null, "Unregistered jobId must return null (process restart case)");
});

test("FS04: Registry eviction — after 101 insertions, oldest entry is evicted", () => {
  // Insert 101 unique jobs; first one should be evicted
  const firstJobId = `eviction-test-job-0-${Date.now()}`;
  registerJobSourcePack(firstJobId, makeSourcePack(firstJobId));

  for (let i = 1; i <= 100; i++) {
    const jid = `eviction-test-job-${i}-${Date.now()}-${i}`;
    registerJobSourcePack(jid, makeSourcePack(jid));
  }

  // First inserted job should now be evicted (map capped at 100)
  const evicted = loadSourcePackForDraft(firstJobId);
  assert.strictEqual(evicted, null, "Oldest entry should be evicted once map exceeds 100 entries");
});

test("FS05: sampleRows round-trip — sourcePackEntry.sampleRows preserved through registry", () => {
  const jobId = `test-job-fs05-${Date.now()}`;
  const sampleRows: Record<string, unknown>[] = [
    { ticker: "2330", close: 850, volume: 30000 },
    { ticker: "2317", close: 105, volume: 15000 }
  ];
  const pack = makeSourcePack(jobId, sampleRows);
  registerJobSourcePack(jobId, pack);

  const result = loadSourcePackForDraft(jobId);
  assert.ok(result !== null, "Expected non-null result");
  const entry = result!.sources[0]!;
  assert.ok(Array.isArray(entry.sampleRows), "sampleRows should be an array");
  assert.strictEqual(entry.sampleRows!.length, 2, "sampleRows should have 2 entries");
  assert.strictEqual(entry.sampleRows![0]!["ticker"], "2330", "first sampleRow ticker should be 2330");
  assert.strictEqual(entry.sampleRows![1]!["close"], 105, "second sampleRow close should be 105");
});
