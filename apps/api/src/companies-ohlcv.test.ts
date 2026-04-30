/**
 * companies-ohlcv.test.ts — W7 D3 unit tests
 *
 * Coverage (T1-T8):
 *   T1: generateMockOhlcv — returns exactly 200 bars
 *   T2: generateMockOhlcv — output is deterministic (same seed → same output)
 *   T3: generateMockOhlcv — bars are in ascending date order
 *   T4: generateMockOhlcv — OHLCV invariants: high >= max(open,close), low <= min(open,close)
 *   T5: generateMockOhlcv — no Saturday or Sunday in dt
 *   T6: getCompanyOhlcv  — memory mode returns mock bars (no DB)
 *   T7: getCompanyOhlcv  — from/to filter applied correctly
 *   T8: getCompanyOhlcvBulk — returns keyed result for all requested ids
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  generateMockOhlcv,
  getCompanyOhlcv,
  getCompanyOhlcvBulk
} from "./companies-ohlcv.js";
import type { AppSession } from "@iuf-trading-room/contracts";

// ── Test helpers ──────────────────────────────────────────────────────────────

function fakeSession(): AppSession {
  return {
    workspace: { id: "00000000-0000-0000-0000-000000000001", slug: "test", name: "Test" },
    user: { id: "00000000-0000-0000-0000-000000000002", name: "Test User", email: "test@example.com", role: "Owner" },
    persistenceMode: "memory"
  };
}

// ── T1: generates exactly 200 bars ───────────────────────────────────────────

test("T1: generateMockOhlcv returns exactly 200 bars", () => {
  const bars = generateMockOhlcv("test-company-id-001");
  assert.equal(bars.length, 200, "Should return 200 trading day bars");
});

// ── T2: output is deterministic ───────────────────────────────────────────────

test("T2: generateMockOhlcv is deterministic (same seed = same output)", () => {
  const id = "deterministic-company-abc-123";
  const bars1 = generateMockOhlcv(id);
  const bars2 = generateMockOhlcv(id);

  assert.equal(bars1.length, bars2.length);
  for (let i = 0; i < bars1.length; i++) {
    assert.equal(bars1[i]!.open,   bars2[i]!.open,   `open mismatch at index ${i}`);
    assert.equal(bars1[i]!.close,  bars2[i]!.close,  `close mismatch at index ${i}`);
    assert.equal(bars1[i]!.volume, bars2[i]!.volume,  `volume mismatch at index ${i}`);
    assert.equal(bars1[i]!.dt,     bars2[i]!.dt,     `dt mismatch at index ${i}`);
  }
});

// ── T3: ascending date order ──────────────────────────────────────────────────

test("T3: generateMockOhlcv bars are in ascending date order", () => {
  const bars = generateMockOhlcv("order-check-xyz");
  for (let i = 1; i < bars.length; i++) {
    const prev = bars[i - 1]!.dt;
    const curr = bars[i]!.dt;
    assert.ok(curr >= prev, `Date at index ${i} (${curr}) should be >= previous (${prev})`);
  }
});

// ── T4: OHLCV invariants ──────────────────────────────────────────────────────

test("T4: generateMockOhlcv OHLCV invariants (high >= max(o,c), low <= min(o,c))", () => {
  const bars = generateMockOhlcv("invariant-check-company");
  for (let i = 0; i < bars.length; i++) {
    const { open, high, low, close, dt } = bars[i]!;
    assert.ok(
      high >= Math.max(open, close),
      `Bar ${dt}: high (${high}) should >= max(open=${open}, close=${close})`
    );
    assert.ok(
      low <= Math.min(open, close),
      `Bar ${dt}: low (${low}) should <= min(open=${open}, close=${close})`
    );
    assert.ok(open > 0, `Bar ${dt}: open should be positive`);
    assert.ok(close > 0, `Bar ${dt}: close should be positive`);
    assert.ok(high > 0, `Bar ${dt}: high should be positive`);
    assert.ok(low > 0, `Bar ${dt}: low should be positive`);
  }
});

// ── T5: no weekend bars ───────────────────────────────────────────────────────

test("T5: generateMockOhlcv contains no Saturday or Sunday bars", () => {
  const bars = generateMockOhlcv("weekend-filter-test");
  for (const bar of bars) {
    const d = new Date(bar.dt + "T12:00:00Z");
    const dow = d.getUTCDay();
    assert.ok(
      dow !== 0 && dow !== 6,
      `Bar ${bar.dt} falls on a weekend (dow=${dow})`
    );
  }
});

// ── T6: memory mode returns mock bars ────────────────────────────────────────

test("T6: getCompanyOhlcv in memory mode returns mock bars", async () => {
  // process.env.PERSISTENCE_MODE is not set / not 'database' in test env.
  // The function should fall back to generateMockOhlcv.
  const bars = await getCompanyOhlcv("company-id-memory-test", fakeSession());
  assert.ok(bars.length > 0, "Should return some bars");
  assert.equal(bars[0]!.source, "mock", "Source should be 'mock'");
});

// ── T7: from/to filter ────────────────────────────────────────────────────────

test("T7: getCompanyOhlcv filters by from and to", async () => {
  // First get all bars to find a valid date range in the middle
  const allBars = generateMockOhlcv("filter-range-test");
  const mid = Math.floor(allBars.length / 2);
  const from = allBars[mid - 5]!.dt;
  const to   = allBars[mid + 5]!.dt;

  const filtered = await getCompanyOhlcv("filter-range-test", fakeSession(), { from, to });

  assert.ok(filtered.length > 0, "Filtered bars should not be empty");
  for (const bar of filtered) {
    assert.ok(bar.dt >= from, `Bar ${bar.dt} should be >= from=${from}`);
    assert.ok(bar.dt <= to,   `Bar ${bar.dt} should be <= to=${to}`);
  }
});

// ── T8: bulk endpoint returns keyed map ───────────────────────────────────────

test("T8: getCompanyOhlcvBulk returns keyed map for all requested ids", async () => {
  const ids = ["bulk-company-aaa", "bulk-company-bbb", "bulk-company-ccc"];
  const result = await getCompanyOhlcvBulk(ids, fakeSession());

  assert.equal(Object.keys(result).length, ids.length, "Should return entry for each id");
  for (const id of ids) {
    assert.ok(Array.isArray(result[id]), `Entry for ${id} should be an array`);
    assert.ok(result[id]!.length > 0, `Entry for ${id} should have bars`);
  }
});
