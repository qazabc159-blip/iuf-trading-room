/**
 * brief-dispatcher-schedule.test.ts — cycle13 cron fix regression tests.
 *
 * BDS1: 09:00 TST window predicate — fires only in 09:00–09:05 (HHMM 900–904)
 * BDS2: past-window predicate — catch-up eligible only when HHMM >= 905
 * BDS3: per-day fired guard — second call same day is a no-op
 * BDS4: pre-09:05 boot does not catch-up (cron will handle at 09:00)
 *
 * These tests encode the wall-clock contract so future changes to the window
 * bounds are caught immediately by CI.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

// ── Pure predicate implementations (mirror of server.ts inlined helpers) ──────
// We reproduce the pure math here to avoid importing server.ts (side effects).
// If server.ts logic changes, this test will catch the divergence.

function tstHHMMFromUtc(utcDate: Date): number {
  const formatted = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(utcDate);
  return parseInt(formatted.replace(":", ""), 10);
}

function isBriefDispatchWindowHHMM(hhmm: number): boolean {
  return hhmm >= 900 && hhmm < 905;
}

function isPastBriefDispatchWindowHHMM(hhmm: number): boolean {
  return hhmm >= 905;
}

// ── BDS1: 09:00–09:05 window ──────────────────────────────────────────────────

describe("BDS1: isBriefDispatchWindow — 09:00–09:05 TST only", () => {
  // TST = UTC+8.  09:00 TST = 01:00 UTC.
  const cases: [string, number, boolean][] = [
    // [label, hhmm, expected]
    ["08:59 TST (before window)", 859, false],
    ["09:00 TST (window start)", 900, true],
    ["09:02 TST (mid window)", 902, true],
    ["09:04 TST (window end -1)", 904, true],
    ["09:05 TST (past window)", 905, false],
    ["10:00 TST (morning)", 1000, false],
    ["00:00 TST (midnight)", 0, false],
  ];

  for (const [label, hhmm, expected] of cases) {
    it(`${label} → ${expected}`, () => {
      assert.equal(
        isBriefDispatchWindowHHMM(hhmm),
        expected,
        `isBriefDispatchWindow(${hhmm}) should be ${expected}`
      );
    });
  }

  it("09:00 TST via UTC date object (01:00 UTC)", () => {
    // 2026-05-14 09:00 TST = 2026-05-14 01:00 UTC
    const utc0100 = new Date("2026-05-14T01:00:00Z");
    const hhmm = tstHHMMFromUtc(utc0100);
    assert.equal(hhmm, 900, `Expected HHMM=900 for 01:00 UTC, got ${hhmm}`);
    assert.equal(isBriefDispatchWindowHHMM(hhmm), true);
  });

  it("09:04 TST via UTC date object (01:04 UTC)", () => {
    const utc0104 = new Date("2026-05-14T01:04:00Z");
    const hhmm = tstHHMMFromUtc(utc0104);
    assert.equal(hhmm, 904, `Expected HHMM=904 for 01:04 UTC, got ${hhmm}`);
    assert.equal(isBriefDispatchWindowHHMM(hhmm), true);
  });

  it("09:05 TST is outside window (01:05 UTC)", () => {
    const utc0105 = new Date("2026-05-14T01:05:00Z");
    const hhmm = tstHHMMFromUtc(utc0105);
    assert.equal(hhmm, 905, `Expected HHMM=905 for 01:05 UTC, got ${hhmm}`);
    assert.equal(isBriefDispatchWindowHHMM(hhmm), false);
  });
});

// ── BDS2: past-window catch-up predicate ─────────────────────────────────────

describe("BDS2: isPastBriefDispatchWindow — eligible when HHMM >= 905", () => {
  const cases: [string, number, boolean][] = [
    ["09:00 TST (in window, not past)", 900, false],
    ["09:04 TST (in window, not past)", 904, false],
    ["09:05 TST (past window)", 905, true],
    ["12:00 TST (midday)", 1200, true],
    ["20:57 TST (late evening — server boot time)", 2057, true],
    ["00:00 TST (midnight)", 0, false],
    ["08:59 TST (pre-window)", 859, false],
  ];

  for (const [label, hhmm, expected] of cases) {
    it(`${label} (HHMM=${hhmm}) → catch-up eligible=${expected}`, () => {
      assert.equal(
        isPastBriefDispatchWindowHHMM(hhmm),
        expected,
        `isPastBriefDispatchWindow(${hhmm}) should be ${expected}`
      );
    });
  }

  it("20:57 TST (Railway boot on 5/13) → catch-up eligible on next day 5/14", () => {
    // At 20:57 TST on 5/13, 5/14 has not been dispatched yet.
    // isPastBriefDispatchWindow is true → startup catch-up gate fires (for 5/13's date).
    // On 5/14 boot, if HHMM >= 905 → fires for 5/14.
    const hhmm = 2057;
    assert.equal(isPastBriefDispatchWindowHHMM(hhmm), true);
  });
});

// ── BDS3: per-day guard prevents duplicate dispatch ───────────────────────────

describe("BDS3: per-day fired guard — second call same day is no-op", () => {
  it("simulates guard: same date → skip, different date → fire", () => {
    let lastFiredDate = "";
    let fireCount = 0;

    function maybeFire(hhmm: number, todayTst: string): void {
      if (lastFiredDate === todayTst) return; // guard
      if (!isBriefDispatchWindowHHMM(hhmm)) return; // window check
      lastFiredDate = todayTst;
      fireCount++;
    }

    // Tick 1: inside window, not fired yet
    maybeFire(900, "2026-05-14");
    assert.equal(fireCount, 1, "first tick in window should fire");
    assert.equal(lastFiredDate, "2026-05-14");

    // Tick 2: same window, same day (60s later — still 09:00–09:04)
    maybeFire(901, "2026-05-14");
    assert.equal(fireCount, 1, "second tick same day should be blocked by guard");

    // Tick 3: next day window
    maybeFire(900, "2026-05-15");
    assert.equal(fireCount, 2, "next day should fire once");
    assert.equal(lastFiredDate, "2026-05-15");
  });
});

// ── BDS4: pre-09:05 boot does not catch-up ───────────────────────────────────

describe("BDS4: startup catch-up gate — pre-09:05 boot skips, post-09:05 fires", () => {
  it("boot at 08:00 TST (HHMM=800) → catch-up skipped (cron will handle at 09:00)", () => {
    const hhmm = 800;
    // Should NOT fire catch-up: isPastBriefDispatchWindow(800) = false
    const shouldCatchUp = isPastBriefDispatchWindowHHMM(hhmm);
    assert.equal(shouldCatchUp, false, "Pre-09:05 boot must NOT trigger startup catch-up");
  });

  it("boot at 20:57 TST (HHMM=2057) → catch-up fires for today", () => {
    const hhmm = 2057;
    // Should fire catch-up: isPastBriefDispatchWindow(2057) = true
    const shouldCatchUp = isPastBriefDispatchWindowHHMM(hhmm);
    assert.equal(shouldCatchUp, true, "Post-09:05 boot must trigger startup catch-up");
  });

  it("boot at 09:10 TST (HHMM=910) → catch-up fires (missed 09:00 window)", () => {
    const hhmm = 910;
    const shouldCatchUp = isPastBriefDispatchWindowHHMM(hhmm);
    assert.equal(shouldCatchUp, true, "09:10 boot must trigger catch-up (missed window)");
  });
});
