// twse-openapi-client-index-history.test.ts — 2026-07-14
//
// index_history (migration 0057) is the DB-backed fallback tier for
// fetchTaiexMonthDailyCloses()'s per-month in-memory cache. The in-memory
// cache is wiped on every deploy restart; if the live TWSE MI_5MINS_HIST
// fetch that follows a restart transiently fails (rate limit / network
// hiccup — 2026-07-14 saw 12 same-day deploys), the homepage TAIEX line
// chart (marketContext.index.history) went empty for that request/window
// with no fallback at all.
//
// This is a genuine DB-mode regression lock: it proves (a) a successful live
// fetch is persisted to the real index_history table, and (b) a subsequent
// failed live fetch for the SAME month falls back to those persisted rows
// instead of returning empty — reading back from the real table, not a
// re-implementation of the persistence logic in this test file.
//
// Wired into `pnpm run test:db` (package.json), same lane as
// scheduler-cursor-persistence.test.ts.
//
// CAUTION: fetchTaiexMonthDailyCloses() hardcodes index_symbol="^TWII" (it is
// not parameterized — there is only one production TAIEX writer), so this
// test necessarily writes/deletes real "^TWII" rows for 2026-06 and 2026-07,
// same as prod would. Safe in CI's db-tests job (a fresh, throwaway
// postgres:16-alpine container per run — see .github/workflows/ci.yml) but
// this test must NEVER be pointed at a real shared/staging DATABASE_URL.

import assert from "node:assert/strict";
import test, { after } from "node:test";

import { eq } from "drizzle-orm";
import { getDb, indexHistory } from "@iuf-trading-room/db";

import { getIndexHistoryRows, upsertIndexHistoryRows } from "../index-history-store.js";
import { _resetTaiexHistCache, getTaiexDailyCloses } from "./twse-openapi-client.js";

const TEST_SYMBOL = "^TWII";

after(async () => {
  const db = getDb();
  if (!db) return;
  await db.delete(indexHistory).where(eq(indexHistory.indexSymbol, TEST_SYMBOL)).catch(() => {});
});

test("INDEX-HISTORY-DB-1: upsertIndexHistoryRows + getIndexHistoryRows round-trip against the real table", async () => {
  const db = getDb();
  assert.ok(db, "this test requires PERSISTENCE_MODE=database with a live Postgres connection");

  await upsertIndexHistoryRows(db, [
    { indexSymbol: TEST_SYMBOL, date: "2026-06-10", close: 22000.5, source: "twse:MI_5MINS_HIST" },
    { indexSymbol: TEST_SYMBOL, date: "2026-06-11", close: 22150.25, source: "twse:MI_5MINS_HIST" },
  ]);

  const rows = await getIndexHistoryRows(db, TEST_SYMBOL, "2026-06-01", "2026-06-30");
  assert.deepEqual(rows, [
    { date: "2026-06-10", close: 22000.5 },
    { date: "2026-06-11", close: 22150.25 },
  ]);

  // Idempotent upsert — re-inserting the same date with a new close updates, not duplicates.
  await upsertIndexHistoryRows(db, [
    { indexSymbol: TEST_SYMBOL, date: "2026-06-10", close: 22005.0, source: "twse:MI_5MINS_HIST" },
  ]);
  const afterUpdate = await getIndexHistoryRows(db, TEST_SYMBOL, "2026-06-01", "2026-06-30");
  assert.equal(afterUpdate.length, 2, "INDEX-HISTORY-DB-1: re-upserting the same date must update, not duplicate");
  assert.equal(afterUpdate.find((r) => r.date === "2026-06-10")?.close, 22005.0);
});

test("INDEX-HISTORY-DB-2: fetchTaiexMonthDailyCloses persists a successful live fetch, then falls back to it when the next live fetch fails", async () => {
  const db = getDb();
  assert.ok(db, "this test requires PERSISTENCE_MODE=database with a live Postgres connection");

  _resetTaiexHistCache();

  // Mock a successful TWSE MI_5MINS_HIST response for July 2026.
  const okFetch = (async () =>
    new Response(
      JSON.stringify({
        stat: "OK",
        data: [
          ["115/07/13", "-", "-", "-", "22,500.00", "-"],
          ["115/07/14", "-", "-", "-", "22,600.75", "-"],
        ],
      }),
      { status: 200 }
    )) as unknown as typeof fetch;

  const rowsFromLive = await getTaiexDailyCloses("2026-07-01", "2026-07-31", okFetch);
  assert.ok(
    rowsFromLive.some((r) => r.date === "2026-07-14" && r.close === 22600.75),
    "INDEX-HISTORY-DB-2: live fetch must return the mocked rows"
  );

  // Give the best-effort persist (fire-and-forget-shaped, but actually awaited
  // internally before fetchTaiexMonthDailyCloses returns) a moment, then wipe
  // the in-memory cache to force the next call to hit "the network" again.
  _resetTaiexHistCache();

  // Mock a failing live fetch for the SAME month (simulates a post-restart
  // transient TWSE failure) — must now fall back to the persisted rows above.
  const failFetch = (async () => new Response("", { status: 503 })) as unknown as typeof fetch;
  const rowsFromFallback = await getTaiexDailyCloses("2026-07-01", "2026-07-31", failFetch);

  assert.ok(
    rowsFromFallback.some((r) => r.date === "2026-07-14" && r.close === 22600.75),
    "INDEX-HISTORY-DB-2: a failed live fetch must fall back to the persisted index_history rows, not return empty"
  );
});
