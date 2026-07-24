/**
 * taiwan-market-session-weekday.test.ts — 2026-07-24
 *
 * R2 fix (reports/design_redesign_20260722/DUAL_CRITERIA_AUDIT_20260723.md):
 * server.ts's composeTaiwanMarketState() used to judge OPEN/CLOSED purely
 * from the wall-clock minute, with NO day-of-week check — Sat/Sun
 * 09:00-13:30 was reported "OPEN". Both this and 4 other duplicate
 * session-window judgements in server.ts now route through the single
 * lib/trading-calendar.ts helper (`getTaiwanMarketSession` /
 * `isTaiwanTradingDayNow`).
 *
 * Coverage:
 *   T1-T5: getTaiwanMarketSession() (lib/trading-calendar.ts) — pinned
 *          weekday/weekend/holiday-injected fixtures, boundary preserved.
 *   T6-T8: composeTaiwanMarketState() (server.ts, exported) delegates to the
 *          same helper — same acceptance-criteria fixtures at the server.ts
 *          call surface.
 *   T9:    isTaiwanTradingDayNow() date derivation is TZ-independent (fixed
 *          +8h epoch arithmetic, not the known todayTaipei() double-offset
 *          pattern).
 *   T10:   Regression guard — the 4 other duplicate session-window sites in
 *          server.ts (isMisWindow, /realtime/snapshot isTradingHours,
 *          _isTwseLiveSessionNow, _misIndexOverviewSnapshot) must call
 *          isTaiwanTradingDayNow (grep-based, catches future re-duplication).
 *
 * Run: node --test --import tsx/esm apps/api/src/__tests__/taiwan-market-session-weekday.test.ts
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { getTaiwanMarketSession, isTaiwanTradingDayNow, taipeiDateFromMs } from "../lib/trading-calendar.js";
import { composeTaiwanMarketState } from "../server.js";

// Construct a UTC instant whose Taipei-local (+8) wall clock reads y-m-d hh:mm.
function taipeiMs(y: number, m: number, d: number, hh: number, mm: number): number {
  return Date.UTC(y, m - 1, d, hh - 8, mm);
}

// 2026-07-24 is a Friday (weekday, real trading day per weekend-only fallback).
// 2026-07-25/26 is Sat/Sun (weekend, no DB needed to prove it).
const FRI_1000 = taipeiMs(2026, 7, 24, 10, 0);
const SAT_1000 = taipeiMs(2026, 7, 25, 10, 0);
const SUN_1000 = taipeiMs(2026, 7, 26, 10, 0);

// ── T1-T5: getTaiwanMarketSession() ─────────────────────────────────────────

test("T1: Friday 10:00 -> OPEN (weekday, in-session)", async () => {
  const session = await getTaiwanMarketSession(FRI_1000);
  assert.equal(session.state, "OPEN");
  assert.equal(session.isTradingDay, true);
});

test("T2: Saturday 10:00 -> CLOSED, not OPEN and not POST-CLOSE (R2 acceptance fixture)", async () => {
  const session = await getTaiwanMarketSession(SAT_1000);
  assert.equal(session.state, "CLOSED");
  assert.equal(session.isTradingDay, false);
  assert.notEqual(session.state, "OPEN");
  assert.notEqual(session.state, "POST-CLOSE");
});

test("T3: Sunday 10:00 -> CLOSED", async () => {
  const session = await getTaiwanMarketSession(SUN_1000);
  assert.equal(session.state, "CLOSED");
  assert.equal(session.isTradingDay, false);
});

test("T4: national holiday (weekday, calendar says non-trading) -> CLOSED — injected isTradingDayCheck", async () => {
  // Simulates a weekday national holiday: the day-of-week fast path alone
  // would say "trading day", so this only passes if the wall-clock CLOSED
  // branch is actually gated on the injected trading-day answer, not on
  // getUTCDay() directly.
  const holidayCheck = async () => false;
  const session = await getTaiwanMarketSession(FRI_1000, holidayCheck);
  assert.equal(session.state, "CLOSED");
  assert.equal(session.isTradingDay, false);
});

test("T5: trading-day boundary states preserved (PRE-OPEN/MIDDAY/POST-CLOSE unchanged on a real trading day)", async () => {
  const preOpen = await getTaiwanMarketSession(taipeiMs(2026, 7, 24, 8, 45));
  assert.equal(preOpen.state, "PRE-OPEN");
  const midday = await getTaiwanMarketSession(taipeiMs(2026, 7, 24, 13, 32));
  assert.equal(midday.state, "MIDDAY");
  const postClose = await getTaiwanMarketSession(taipeiMs(2026, 7, 24, 20, 0));
  assert.equal(postClose.state, "POST-CLOSE");
});

// ── T6-T8: composeTaiwanMarketState() (server.ts, real production function) ─

test("T6: composeTaiwanMarketState — Friday 10:00 -> OPEN", async () => {
  const result = await composeTaiwanMarketState(FRI_1000);
  assert.equal(result.state, "OPEN");
});

test("T7: composeTaiwanMarketState — Saturday 10:00 -> CLOSED (was OPEN pre-fix)", async () => {
  const result = await composeTaiwanMarketState(SAT_1000);
  assert.equal(result.state, "CLOSED");
});

test("T8: composeTaiwanMarketState — countdownSec stays non-negative finite on CLOSED", async () => {
  const result = await composeTaiwanMarketState(SAT_1000);
  assert.ok(Number.isFinite(result.countdownSec));
  assert.ok(result.countdownSec >= 0);
});

// ── T9: TZ-independence (double-offset avoidance) ───────────────────────────

test("T9: taipeiDateFromMs is derived from fixed +8h epoch arithmetic, matches expected Taipei date across a UTC midnight crossing", () => {
  // UTC 2026-07-23T20:00:00Z = Taipei 2026-07-24T04:00 (+8h) — a case that
  // would be WRONG under todayTaipei()'s getTimezoneOffset() approach on a
  // host whose own TZ is already Asia/Taipei (offset cancels to 0, yielding
  // the UTC date "2026-07-23" instead of the correct Taipei date "2026-07-24").
  const ms = Date.UTC(2026, 6, 23, 20, 0, 0);
  assert.equal(taipeiDateFromMs(ms), "2026-07-24");
});

test("T9b: isTaiwanTradingDayNow derives the same Friday date and resolves true", async () => {
  const result = await isTaiwanTradingDayNow(FRI_1000);
  assert.equal(result, true);
});

test("T9c: isTaiwanTradingDayNow resolves false on Saturday", async () => {
  const result = await isTaiwanTradingDayNow(SAT_1000);
  assert.equal(result, false);
});

// ── T10: regression guard — the other 4 duplicate sites must import the ────
// shared helper, not re-derive weekday locally (grep-based, catches future
// re-duplication the same way kgi-wire-qty-unit-call-site-guard.test.ts does
// for its own bug class).

test("T10: server.ts's other 4 session-window sites all call isTaiwanTradingDayNow (not a bare getUTCDay() check)", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const serverSrc = readFileSync(join(here, "..", "server.ts"), "utf8");

  // The 4 sites this fix unified (see PR body for before/after per site):
  //   1. isMisWindow (market-data/overview MIS enrich window)
  //   2. isTradingHours (/realtime/snapshot MIS-vs-EOD tile gate)
  //   3. _isTwseLiveSessionNow (/companies/:id/quote/realtime MIS freshness)
  //   4. _misIndexOverviewSnapshot (TAIEX/OTC index snapshot gate)
  const callCount = (serverSrc.match(/isTaiwanTradingDayNow\(/g) ?? []).length;
  // 1 in the shared import statement's re-export is not a call; count only
  // actual call sites (function invocations with a following paren already
  // matched above). Expect at least the 4 unified sites.
  assert.ok(
    callCount >= 4,
    `expected >=4 call sites of isTaiwanTradingDayNow() in server.ts, found ${callCount} — a duplicate weekday-only check may have crept back in`
  );

  // No remaining bare `getUTCDay() >= 1 && ... <= 5` weekday-only pattern
  // should exist for a *session/trading-hours* judgement — the pattern class
  // this fix eliminated. (Scoped to the market-session helper functions this
  // PR touched; not a whole-file ban, since other unrelated getUTCDay() uses
  // may legitimately exist elsewhere for non-session purposes.)
  for (const fnName of ["_isTwseLiveSessionNow", "_misIndexOverviewSnapshot"]) {
    const idx = serverSrc.indexOf(`function ${fnName}`);
    assert.ok(idx >= 0, `${fnName} must still exist in server.ts`);
    const windowSrc = serverSrc.slice(idx, idx + 800);
    assert.ok(
      !/getUTCDay\(\)\s*>=\s*1/.test(windowSrc),
      `${fnName} must not re-derive weekday locally via getUTCDay() — it must delegate to isTaiwanTradingDayNow()`
    );
  }
});
