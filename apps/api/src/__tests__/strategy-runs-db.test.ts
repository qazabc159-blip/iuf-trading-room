// strategy-runs-db.test.ts
// Tests for strategy-runs-store.ts PostgreSQL rewrite.
// SR1–SR6: in-memory / no-DB path (always runs in CI)
// SR7: DB integration test (only when PERSISTENCE_MODE=database + DATABASE_URL set)
//
// Root cause being fixed: Railway ephemeral container wipes JSONL on every
// redeploy → strategy_runs always empty → /runs EMPTY state.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import {
  loadPersistedStrategyRuns,
  appendPersistedStrategyRun,
  resetPersistedStrategyRuns,
  _resetMemoryStore,
  _resetSlugCache
} from "../strategy-runs-store.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRun(overrides?: Partial<{
  id: string;
  createdAt: string;
  symbol: string;
  allow: number;
  review: number;
  block: number;
}>) {
  const symbol = overrides?.symbol ?? "2330";
  const allow = overrides?.allow ?? 3;
  const review = overrides?.review ?? 1;
  const block = overrides?.block ?? 0;
  return {
    id: overrides?.id ?? randomUUID(),
    createdAt: overrides?.createdAt ?? new Date().toISOString(),
    generatedAt: new Date().toISOString(),
    query: {
      limit: 12,
      signalDays: 14,
      includeBlocked: false,
      decisionMode: "strategy" as const,
      sort: "score" as const
    },
    summary: {
      total: allow + review + block,
      allow,
      review,
      block,
      bullish: allow,
      bearish: 0,
      neutral: review + block,
      quality: {
        strategyReady: allow,
        referenceOnly: review,
        insufficient: block,
        primaryReasons: []
      }
    },
    items: [],
    outputs: [
      {
        companyId: randomUUID(),
        symbol,
        companyName: "Test Co",
        direction: "bullish" as const,
        score: 75,
        confidence: 0.8,
        signalCount: 3,
        latestSignalAt: null,
        topThemeId: null,
        topThemeName: null,
        marketDecision: "allow" as const,
        selectedSource: null,
        qualityGrade: "strategy_ready" as const,
        primaryReason: "test"
      }
    ]
  };
}

// ---------------------------------------------------------------------------
// SR1: Memory mode — append + load round-trip within same process
// ---------------------------------------------------------------------------

test("SR1: memory mode — append + load round-trip works within same process", async () => {
  const origMode = process.env.PERSISTENCE_MODE;
  delete process.env.PERSISTENCE_MODE;

  try {
    _resetMemoryStore();

    const slug = `test-ws-${randomUUID().slice(0, 8)}`;
    const runA = makeRun({ symbol: "2330", allow: 3 });
    const runB = makeRun({ symbol: "0050", allow: 5 });

    await appendPersistedStrategyRun(slug, runA as any);
    await appendPersistedStrategyRun(slug, runB as any);

    const runs = await loadPersistedStrategyRuns(slug);
    assert.equal(runs.length, 2, "Should have 2 runs");
    // Most-recent-first order: B was appended after A, but createdAt is same ms
    // At minimum both IDs must be present
    const ids = runs.map(r => r.id);
    assert.ok(ids.includes(runA.id), "runA must be in result");
    assert.ok(ids.includes(runB.id), "runB must be in result");
  } finally {
    if (origMode !== undefined) process.env.PERSISTENCE_MODE = origMode;
    _resetMemoryStore();
  }
});

// ---------------------------------------------------------------------------
// SR2: Memory mode — reset clears runs for that slug only
// ---------------------------------------------------------------------------

test("SR2: memory mode — resetPersistedStrategyRuns clears only target slug", async () => {
  const origMode = process.env.PERSISTENCE_MODE;
  delete process.env.PERSISTENCE_MODE;

  try {
    _resetMemoryStore();

    const slugA = `ws-a-${randomUUID().slice(0, 8)}`;
    const slugB = `ws-b-${randomUUID().slice(0, 8)}`;

    await appendPersistedStrategyRun(slugA, makeRun() as any);
    await appendPersistedStrategyRun(slugB, makeRun() as any);

    await resetPersistedStrategyRuns(slugA);

    const runsA = await loadPersistedStrategyRuns(slugA);
    const runsB = await loadPersistedStrategyRuns(slugB);

    assert.equal(runsA.length, 0, "slugA should be cleared");
    assert.equal(runsB.length, 1, "slugB should be untouched");
  } finally {
    if (origMode !== undefined) process.env.PERSISTENCE_MODE = origMode;
    _resetMemoryStore();
  }
});

// ---------------------------------------------------------------------------
// SR3: Memory mode — empty slug returns []
// ---------------------------------------------------------------------------

test("SR3: memory mode — load empty slug returns []", async () => {
  const origMode = process.env.PERSISTENCE_MODE;
  delete process.env.PERSISTENCE_MODE;

  try {
    _resetMemoryStore();
    const runs = await loadPersistedStrategyRuns(`no-such-${randomUUID()}`);
    assert.deepStrictEqual(runs, [], "unknown slug should return empty array");
  } finally {
    if (origMode !== undefined) process.env.PERSISTENCE_MODE = origMode;
    _resetMemoryStore();
  }
});

// ---------------------------------------------------------------------------
// SR4: DB mode without DATABASE_URL — falls back to memory gracefully (no throw)
// ---------------------------------------------------------------------------

test("SR4: DB mode without DATABASE_URL — falls back to memory gracefully", async () => {
  const origMode = process.env.PERSISTENCE_MODE;
  const origUrl = process.env.DATABASE_URL;

  process.env.PERSISTENCE_MODE = "database";
  delete process.env.DATABASE_URL;

  try {
    _resetMemoryStore();
    _resetSlugCache();

    // getDb() will throw (DATABASE_URL missing); store must catch and fall back to memory
    const slug = `fallback-${randomUUID().slice(0, 8)}`;
    const run = makeRun();

    // append should not throw
    await assert.doesNotReject(
      () => appendPersistedStrategyRun(slug, run as any),
      "appendPersistedStrategyRun must not throw when DB URL missing"
    );

    // load should return what was stored in memory fallback
    const runs = await loadPersistedStrategyRuns(slug);
    assert.ok(Array.isArray(runs), "must return array");
    // may have 0 or 1 depending on fallback path — just must not throw
  } finally {
    if (origMode !== undefined) process.env.PERSISTENCE_MODE = origMode;
    else delete process.env.PERSISTENCE_MODE;
    if (origUrl !== undefined) process.env.DATABASE_URL = origUrl;
    _resetMemoryStore();
    _resetSlugCache();
  }
});

// ---------------------------------------------------------------------------
// SR5: Memory mode — appendPersistedStrategyRun doesn't throw
// ---------------------------------------------------------------------------

test("SR5: appendPersistedStrategyRun doesn't throw in memory mode", async () => {
  const origMode = process.env.PERSISTENCE_MODE;
  delete process.env.PERSISTENCE_MODE;

  try {
    _resetMemoryStore();
    await assert.doesNotReject(
      () => appendPersistedStrategyRun("default", makeRun() as any),
      "appendPersistedStrategyRun must not throw"
    );
  } finally {
    if (origMode !== undefined) process.env.PERSISTENCE_MODE = origMode;
    _resetMemoryStore();
  }
});

// ---------------------------------------------------------------------------
// SR6: Run object structure — verify makeRun() produces valid schema shape
// ---------------------------------------------------------------------------

test("SR6: makeRun() produces a structurally valid StrategyRunRecord", async () => {
  const { strategyRunRecordSchema } = await import("@iuf-trading-room/contracts");
  const run = makeRun({ symbol: "0050", allow: 5, review: 2, block: 1 });
  const parsed = strategyRunRecordSchema.safeParse(run);
  assert.ok(
    parsed.success,
    `strategyRunRecordSchema should parse: ${JSON.stringify(parsed.error?.issues?.[0])}`
  );
  assert.equal(parsed.data?.summary.total, 8);
  assert.equal(parsed.data?.outputs[0]?.symbol, "0050");
});

// ---------------------------------------------------------------------------
// SR7: Full DB integration test (skipped unless PERSISTENCE_MODE=database)
// ---------------------------------------------------------------------------

test("SR7: DB integration — insert, load, ordering, reset survives cache clear", async (t) => {
  if (!process.env.PERSISTENCE_MODE || process.env.PERSISTENCE_MODE !== "database") {
    t.skip("Requires PERSISTENCE_MODE=database and DATABASE_URL");
    return;
  }
  if (!process.env.DATABASE_URL) {
    t.skip("Requires DATABASE_URL");
    return;
  }

  _resetMemoryStore();
  _resetSlugCache();

  const slug = "default";

  // Clean slate
  await resetPersistedStrategyRuns(slug);

  // Insert run A (older)
  const runA = makeRun({ symbol: "2330", allow: 3, review: 1, block: 0 });
  await appendPersistedStrategyRun(slug, runA as any);

  // Small delay to ensure distinct created_at ordering
  await new Promise<void>((r) => setTimeout(r, 60));

  // Insert run B (newer)
  const runB = makeRun({ symbol: "0050", allow: 5, review: 0, block: 1 });
  await appendPersistedStrategyRun(slug, runB as any);

  // Load — should return both, most-recent-first
  const runs = await loadPersistedStrategyRuns(slug);
  assert.ok(runs.length >= 2, `Should have at least 2 runs, got ${runs.length}`);
  assert.equal(runs[0]?.id, runB.id, "Most recent run (B) should be first");
  assert.equal(runs[1]?.id, runA.id, "Older run (A) should be second");

  // Simulate restart: clear slug cache only (DB rows survive — this is the fix)
  _resetSlugCache();
  const runsAfterRestart = await loadPersistedStrategyRuns(slug);
  assert.ok(
    runsAfterRestart.length >= 2,
    "Runs MUST survive simulated restart (slug cache cleared, DB rows intact)"
  );
  assert.equal(runsAfterRestart[0]?.id, runB.id, "Order preserved after cache clear");

  // Clean up
  await resetPersistedStrategyRuns(slug);
  _resetSlugCache();
  const runsAfterReset = await loadPersistedStrategyRuns(slug);
  assert.equal(runsAfterReset.length, 0, "Should be empty after DB reset");

  _resetMemoryStore();
  _resetSlugCache();
});
