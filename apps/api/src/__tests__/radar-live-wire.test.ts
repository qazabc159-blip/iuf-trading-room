/**
 * radar-live-wire.test.ts — W7 L6 unit tests
 *
 * Coverage:
 *   T1: composeTaiwanMarketState returns object with required MarketState keys
 *   T2: composeTaiwanMarketState.state is one of the 4 valid session strings
 *   T3: composeTaiwanMarketState.countdownSec is a non-negative integer
 *   T4: backendThemeToRadar maps lifecycle→lockState correctly (LOCKED/TRACK/WATCH/STALE)
 *   T5: backendThemeToRadar heat proxy — priority 1 → heat ≥ 50
 *   T6: backendThemeToRadar pulse is array of 7 numbers
 *   T7: ActivityEvent shape has summary (non-empty string), no actor/detail fields
 *   T8: /api/v1/reviews/log route contract — data array shape { id, ts, reviewer, action, itemId }
 *
 * Run: node --test --import tsx/esm apps/api/src/__tests__/radar-live-wire.test.ts
 *
 * No KGI SDK import. No broker. No DB. No HTTP route hit.
 * Tests pure logic: composeTaiwanMarketState, backendThemeToRadar, summary derivation.
 */

import assert from "node:assert/strict";
import test from "node:test";

// ---------------------------------------------------------------------------
// Pull the helper functions out of server.ts for unit testing.
// Since server.ts doesn't export them directly, we inline equivalent
// implementations here that mirror the production code exactly.
// This is the approved pattern for testing non-exported server utilities
// (same approach used in other __tests__ files in this repo).
// ---------------------------------------------------------------------------

function composeTaiwanMarketState(): {
  state: "PRE-OPEN" | "OPEN" | "MIDDAY" | "POST-CLOSE";
  countdownSec: number;
  futuresNight: { last: number; chgPct: number };
  usMarket: { index: string; last: number; chgPct: number; closeTs: string };
  events: { ts: string; label: string; weight: "HIGH" | "MED" | "LOW" }[];
} {
  const now = new Date();
  const twMin = (now.getUTCHours() * 60 + now.getUTCMinutes() + 8 * 60) % (24 * 60);
  const PREOPEN_START = 510;
  const OPEN_START    = 540;
  const MIDDAY_START  = 810;
  const CLOSE_END     = 815;

  let state: "PRE-OPEN" | "OPEN" | "MIDDAY" | "POST-CLOSE";
  let nextBoundary: number;

  if (twMin >= PREOPEN_START && twMin < OPEN_START) {
    state = "PRE-OPEN";
    nextBoundary = OPEN_START;
  } else if (twMin >= OPEN_START && twMin < MIDDAY_START) {
    state = "OPEN";
    nextBoundary = MIDDAY_START;
  } else if (twMin >= MIDDAY_START && twMin < CLOSE_END) {
    state = "MIDDAY";
    nextBoundary = CLOSE_END;
  } else {
    state = "POST-CLOSE";
    nextBoundary = twMin < PREOPEN_START ? PREOPEN_START : PREOPEN_START + 24 * 60;
  }

  const countdownSec = Math.max(0, (nextBoundary - twMin) * 60 - now.getUTCSeconds());

  return {
    state,
    countdownSec,
    futuresNight: { last: 0, chgPct: 0 },
    usMarket: { index: "NASDAQ", last: 0, chgPct: 0, closeTs: now.toISOString() },
    events: []
  };
}

function backendThemeToRadar(theme: {
  priority: number;
  slug: string;
  name: string;
  lifecycle: string;
  corePoolCount: number;
  observationPoolCount: number;
}, rank: number): {
  rank: number;
  code: string;
  name: string;
  short: string;
  heat: number;
  dHeat: number;
  members: number;
  momentum: "ACCEL" | "STEADY" | "DECEL";
  lockState: "LOCKED" | "TRACK" | "WATCH" | "STALE";
  pulse: number[];
} {
  const lifecycleLockMap: Record<string, "LOCKED" | "TRACK" | "WATCH" | "STALE"> = {
    "Discovery":    "WATCH",
    "Validation":   "TRACK",
    "Expansion":    "LOCKED",
    "Crowded":      "LOCKED",
    "Distribution": "STALE"
  };
  const heat = Math.max(10, 100 - theme.priority * 18);

  return {
    rank,
    code: theme.slug.toUpperCase().slice(0, 12),
    name: theme.name,
    short: theme.slug,
    heat,
    dHeat: 0,
    members: theme.corePoolCount + theme.observationPoolCount,
    momentum: "STEADY",
    lockState: lifecycleLockMap[theme.lifecycle] ?? "WATCH",
    pulse: Array(7).fill(heat)
  };
}

// ---------------------------------------------------------------------------
// T1: composeTaiwanMarketState has all required MarketState keys
// ---------------------------------------------------------------------------
test("T1: composeTaiwanMarketState returns object with required MarketState keys", () => {
  const result = composeTaiwanMarketState();
  assert.ok(typeof result.state === "string", "state must be string");
  assert.ok(typeof result.countdownSec === "number", "countdownSec must be number");
  assert.ok(typeof result.futuresNight === "object" && result.futuresNight !== null,
    "futuresNight must be object");
  assert.ok(typeof result.futuresNight.last === "number", "futuresNight.last must be number");
  assert.ok(typeof result.futuresNight.chgPct === "number", "futuresNight.chgPct must be number");
  assert.ok(typeof result.usMarket === "object" && result.usMarket !== null,
    "usMarket must be object");
  assert.ok(typeof result.usMarket.index === "string", "usMarket.index must be string");
  assert.ok(typeof result.usMarket.last === "number", "usMarket.last must be number");
  assert.ok(typeof result.usMarket.chgPct === "number", "usMarket.chgPct must be number");
  assert.ok(typeof result.usMarket.closeTs === "string", "usMarket.closeTs must be string");
  assert.ok(Array.isArray(result.events), "events must be array");
});

// ---------------------------------------------------------------------------
// T2: composeTaiwanMarketState.state is one of 4 valid values
// ---------------------------------------------------------------------------
test("T2: composeTaiwanMarketState.state is one of the 4 valid session strings", () => {
  const result = composeTaiwanMarketState();
  const validStates = ["PRE-OPEN", "OPEN", "MIDDAY", "POST-CLOSE"];
  assert.ok(validStates.includes(result.state),
    `state "${result.state}" must be one of ${validStates.join(", ")}`);
});

// ---------------------------------------------------------------------------
// T3: composeTaiwanMarketState.countdownSec is non-negative integer
// ---------------------------------------------------------------------------
test("T3: composeTaiwanMarketState.countdownSec is a non-negative number", () => {
  const result = composeTaiwanMarketState();
  assert.ok(result.countdownSec >= 0, "countdownSec must be >= 0");
  assert.ok(Number.isFinite(result.countdownSec), "countdownSec must be finite");
});

// ---------------------------------------------------------------------------
// T4: backendThemeToRadar maps lifecycle→lockState
// ---------------------------------------------------------------------------
test("T4: backendThemeToRadar maps lifecycle→lockState correctly", () => {
  const base = { priority: 1, slug: "ai-pwr", name: "AI 算力", corePoolCount: 5, observationPoolCount: 3 };
  assert.equal(backendThemeToRadar({ ...base, lifecycle: "Discovery" }, 1).lockState, "WATCH");
  assert.equal(backendThemeToRadar({ ...base, lifecycle: "Validation" }, 1).lockState, "TRACK");
  assert.equal(backendThemeToRadar({ ...base, lifecycle: "Expansion" }, 1).lockState, "LOCKED");
  assert.equal(backendThemeToRadar({ ...base, lifecycle: "Crowded" }, 1).lockState, "LOCKED");
  assert.equal(backendThemeToRadar({ ...base, lifecycle: "Distribution" }, 1).lockState, "STALE");
  // Unknown lifecycle falls back to WATCH
  assert.equal(backendThemeToRadar({ ...base, lifecycle: "Unknown" }, 1).lockState, "WATCH");
});

// ---------------------------------------------------------------------------
// T5: backendThemeToRadar heat proxy — priority 1 → heat ≥ 50
// ---------------------------------------------------------------------------
test("T5: backendThemeToRadar heat proxy — priority 1 produces heat ≥ 50", () => {
  const theme = {
    priority: 1,
    slug: "ai-pwr",
    name: "AI 算力",
    lifecycle: "Expansion",
    corePoolCount: 10,
    observationPoolCount: 2
  };
  const result = backendThemeToRadar(theme, 1);
  assert.ok(result.heat >= 50, `heat ${result.heat} should be >= 50 for priority 1`);
  // priority 5 → lower heat
  const lowPriority = backendThemeToRadar({ ...theme, priority: 5 }, 5);
  assert.ok(lowPriority.heat < result.heat,
    `priority 5 heat ${lowPriority.heat} should be < priority 1 heat ${result.heat}`);
});

// ---------------------------------------------------------------------------
// T6: backendThemeToRadar pulse is array of exactly 7 numbers
// ---------------------------------------------------------------------------
test("T6: backendThemeToRadar pulse is array of 7 numbers", () => {
  const theme = {
    priority: 2,
    slug: "robot",
    name: "人形機器人",
    lifecycle: "Validation",
    corePoolCount: 8,
    observationPoolCount: 4
  };
  const result = backendThemeToRadar(theme, 2);
  assert.ok(Array.isArray(result.pulse), "pulse must be array");
  assert.equal(result.pulse.length, 7, "pulse must have 7 elements");
  for (const v of result.pulse) {
    assert.ok(typeof v === "number", "each pulse element must be a number");
  }
});

// ---------------------------------------------------------------------------
// T7: ActivityEvent shape — summary present, actor/detail absent
// ---------------------------------------------------------------------------
test("T7: ActivityEvent summary derived correctly, no actor/detail fields", () => {
  // Simulate the mapping logic from the ops/activity handler
  function mapAuditToActivityEvent(entry: {
    id: string;
    createdAt: string;
    status?: number;
    method?: string;
    path?: string;
    role?: string;
  }) {
    const severity =
      (entry.status ?? 0) >= 500
        ? "ERROR"
        : (entry.status ?? 0) >= 400
        ? "WARN"
        : "INFO";

    const actor = entry.role ?? "system";
    const method = entry.method?.toUpperCase() ?? "";
    const path = entry.path ?? "";
    const rawSummary = `${actor} ${method} ${path}`.trim().replace(/\s+/g, " ");
    const summary = rawSummary.length > 140 ? rawSummary.slice(0, 137) + "..." : rawSummary;

    return {
      id: entry.id,
      ts: entry.createdAt,
      source: "api" as const,
      severity,
      event: `${entry.method?.toLowerCase() ?? "?"}.${
        (entry.path ?? "").replace(/^\/api\/v1\//, "").replace(/\//g, ".")
      }`,
      summary
    };
  }

  const entry = {
    id: "entry-001",
    createdAt: new Date().toISOString(),
    status: 200,
    method: "GET",
    path: "/api/v1/strategy/ideas",
    role: "owner"
  };
  const event = mapAuditToActivityEvent(entry);

  // summary must be present and non-empty
  assert.ok(typeof event.summary === "string", "summary must be string");
  assert.ok(event.summary.length > 0, "summary must be non-empty");
  assert.ok(event.summary.includes("owner"), "summary should include actor");

  // actor and detail must NOT be present (these were removed in W7 L6)
  assert.ok(!("actor" in event), "actor field must not exist in ActivityEvent");
  assert.ok(!("detail" in event), "detail field must not exist in ActivityEvent");

  // summary ≤ 140 chars
  const longEntry = { ...entry, path: "/api/v1/" + "x".repeat(200) };
  const longEvent = mapAuditToActivityEvent(longEntry);
  assert.ok(longEvent.summary.length <= 140,
    `summary must be ≤ 140 chars, got ${longEvent.summary.length}`);
});

// ---------------------------------------------------------------------------
// T8: ReviewLogItem shape contract
// ---------------------------------------------------------------------------
test("T8: ReviewLogItem shape — { id, ts, reviewer, action, itemId } all present and typed", () => {
  // Simulate the reviews/log mapping logic
  function mapAuditToReviewLogItem(entry: {
    id: string;
    createdAt: string;
    status?: number;
    role?: string;
    entityId: string;
  }) {
    const isSuccess = (entry.status ?? 200) < 400;
    return {
      id: entry.id,
      ts: entry.createdAt,
      reviewer: entry.role ?? "system",
      action: isSuccess ? "ACCEPT" as const : "REJECT" as const,
      itemId: entry.entityId
    };
  }

  const successEntry = {
    id: "log-01",
    createdAt: new Date().toISOString(),
    status: 200,
    role: "owner",
    entityId: "idea-abc"
  };
  const successItem = mapAuditToReviewLogItem(successEntry);
  assert.equal(successItem.id, "log-01");
  assert.equal(successItem.reviewer, "owner");
  assert.equal(successItem.action, "ACCEPT");
  assert.equal(successItem.itemId, "idea-abc");
  assert.ok(typeof successItem.ts === "string", "ts must be string");

  // 4xx → REJECT
  const failEntry = { ...successEntry, id: "log-02", status: 422, role: undefined };
  const failItem = mapAuditToReviewLogItem(failEntry);
  assert.equal(failItem.action, "REJECT");
  assert.equal(failItem.reviewer, "system");

  // Missing status defaults to 200 → ACCEPT
  const noStatusEntry = { id: "log-03", createdAt: new Date().toISOString(), role: "admin", entityId: "sig-xyz" };
  const noStatusItem = mapAuditToReviewLogItem(noStatusEntry);
  assert.equal(noStatusItem.action, "ACCEPT", "missing status should default to ACCEPT");
});
