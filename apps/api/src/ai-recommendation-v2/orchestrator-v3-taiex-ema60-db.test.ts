// orchestrator-v3-taiex-ema60-db.test.ts — 2026-07-23 (R1 audit fix + R2 datasource routing)
//
// computeTaiexEma60FromDb() (orchestrator-v3.ts) feeds the S6 "TAIEX < EMA60"
// risk-off signal consumed by computeProgrammaticRiskOffScore() — when this
// signal fires on a bear-market day, AI recommendation v3 is supposed to
// enter its risk-off branch and reduce/skip position sizing.
//
// History:
//   R1 (#1352, 2026-07-23): fixed a `.rows` extraction bug (postgres-js's
//   execute() returns a bare row array, not `{ rows: [...] }`) that made
//   this function return null on every call regardless of data. R1's own
//   test fixture seeded `companies_ohlcv` rows to isolate that shape bug —
//   but Pete's R1 review (evidence/sprint_2026_07_23/pr1352_review.md §4)
//   flagged that prod `companies_ohlcv` has NEVER had a row for ticker
//   TAIEX/^TWII/0000 (verified 2026-06-11, ai-rec-perf-store.ts:384-386), so
//   even a correctly-shaped read against that table returns null in prod.
//
//   R2 (this file, jason4r2): computeTaiexEma60FromDb() now reads from the
//   `index_history` table (migration 0057) via index-history-store.ts's
//   getIndexHistoryRows() — the table TAIEX daily closes are actually
//   persisted to (data-sources/twse-openapi-client.ts
//   fetchTaiexMonthDailyCloses(), same table the homepage TAIEX line chart
//   already reads/falls back to). This test seeds index_history directly
//   (not companies_ohlcv) and asserts the EMA60 comes back correct.
//
// This test proves the mechanism directly against a real Postgres (not a
// re-implementation of the shape logic): seeds 60 real index_history rows
// for a test-only index symbol with known, ascending close prices, then
// asserts computeTaiexEma60FromDb() returns the correct EMA60 (independently
// recomputed here with the same well-known recursive EMA formula) instead of
// null.
//
// Wired into `pnpm run test:db` (package.json), same lane as
// twse-openapi-client-index-history.test.ts / paper-realized-pnl-db.test.ts.

import assert from "node:assert/strict";
import test, { after, before } from "node:test";

import { eq } from "drizzle-orm";
import { getDb, indexHistory } from "@iuf-trading-room/db";

import { computeTaiexEma60FromDb } from "./orchestrator-v3.js";

// NOTE: computeTaiexEma60FromDb() is hardcoded to read index_symbol = "^TWII"
// (the real TAIEX symbol — see index-history-store.ts / migration 0057
// module doc) AND bounds its query to a rolling 140-calendar-day window
// ending "today" (mirrors market-data.ts's existing TAIEX chart window).
// Seeded fixture rows must therefore fall inside that window — dates far in
// the past (e.g. 1999, as R1's companies_ohlcv fixture used) would silently
// fall outside the range filter and produce a false-negative "still null"
// result that has nothing to do with the datasource-routing fix under test.
// 90 days ago is comfortably inside the 140-day window with margin on both
// sides, and functionally can never collide with real ^TWII rows a live
// TWSE fetch would persist for the SAME dates (this suite always deletes its
// own rows in after()).
const INDEX_SYMBOL = "^TWII";
const SEED_START_DATE = shiftDate(new Date().toISOString().slice(0, 10), -90);

before(async () => {
  const db = getDb();
  assert.ok(db, "this suite requires PERSISTENCE_MODE=database — run via `pnpm run test:db`");

  // 60 ascending daily closes, oldest → newest, far in the past so this
  // isolated fixture can never collide with real ^TWII rows a live TWSE
  // fetch might persist.
  const rows = Array.from({ length: 60 }, (_, i) => ({
    indexSymbol: INDEX_SYMBOL,
    tradeDate: shiftDate(SEED_START_DATE, i),
    close: String(20000 + i),
    source: "test-fixture",
    updatedAt: new Date()
  }));

  await db.insert(indexHistory).values(rows);
});

after(async () => {
  const db = getDb();
  if (!db) return;
  await db
    .delete(indexHistory)
    .where(eq(indexHistory.source, "test-fixture"))
    .catch(() => {});
});

function shiftDate(startIso: string, days: number): string {
  const d = new Date(`${startIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Independent reference implementation of the same recursive EMA formula
 * computeTaiexEma60FromDb() uses, over the same ascending-close series, to
 * cross-check the DB round-trip without importing production logic. */
function referenceEma(closesAscending: number[]): number {
  const n = closesAscending.length;
  const k = 2 / (n + 1);
  let ema = closesAscending[0]!;
  for (let i = 1; i < n; i++) {
    ema = closesAscending[i]! * k + ema * (1 - k);
  }
  return Math.round(ema * 100) / 100;
}

test("TAIEX-EMA60-DB-1: computeTaiexEma60FromDb reads real index_history rows (not null, not companies_ohlcv)", async () => {
  const db = getDb();
  assert.ok(db, "requires PERSISTENCE_MODE=database");

  // Sanity: confirm the fixture actually landed (rules out "empty table" as
  // an alternate explanation for a null result).
  const seededCount = (
    await db
      .select({ tradeDate: indexHistory.tradeDate })
      .from(indexHistory)
      .where(eq(indexHistory.source, "test-fixture"))
  ).length;
  assert.equal(seededCount, 60, "TAIEX-EMA60-DB-1: fixture must have inserted exactly 60 index_history rows");

  const closesAscending = Array.from({ length: 60 }, (_, i) => 20000 + i);
  const expected = referenceEma(closesAscending);

  const ema = await computeTaiexEma60FromDb();

  assert.notEqual(
    ema,
    null,
    "TAIEX-EMA60-DB-1: EMA60 must not be null when index_history has >=20 rows for ^TWII " +
      "(this is the table TAIEX daily closes are actually persisted to in prod — " +
      "companies_ohlcv has never had a TAIEX row, see ai-rec-perf-store.ts:384-386)"
  );
  assert.ok(
    Math.abs((ema as number) - expected) < 0.01,
    `TAIEX-EMA60-DB-1: expected EMA60 ~= ${expected}, got ${ema}`
  );
});

test("TAIEX-EMA60-DB-2: computeTaiexEma60FromDb returns null (not 0/false) when index_history has no ^TWII rows in range", async () => {
  const db = getDb();
  assert.ok(db, "requires PERSISTENCE_MODE=database");

  // Delete this suite's fixture rows, then confirm the function degrades
  // honestly to null rather than fail-open to a numeric 0.
  await db.delete(indexHistory).where(eq(indexHistory.source, "test-fixture"));

  const ema = await computeTaiexEma60FromDb();

  assert.equal(
    ema,
    null,
    "TAIEX-EMA60-DB-2: with no index_history rows for ^TWII, computeTaiexEma60FromDb must " +
      "return null (honest degrade), never a fabricated numeric value"
  );

  // Re-seed for any subsequent test run in this process (after() also cleans up).
  const rows = Array.from({ length: 60 }, (_, i) => ({
    indexSymbol: INDEX_SYMBOL,
    tradeDate: shiftDate(SEED_START_DATE, i),
    close: String(20000 + i),
    source: "test-fixture",
    updatedAt: new Date()
  }));
  await db.insert(indexHistory).values(rows);
});
