// scheduler-cursor-persistence.test.ts — 2026-07-12 (#1229 A5/A6 finding)
//
// The FinMind sync schedulers' round-robin batch cursor
// (`takeFinMindSchedulerBatch` in server.ts) used to live ONLY in an
// in-memory Map, so every process restart reset every job's cursor to 0.
// This repo deploys many times a day — low-sort-order tickers got refreshed
// on every reset while high-sort-order tickers (e.g. 8069) could starve for
// days between resets.
//
// This is a genuine DB-mode regression lock: it proves the cursor survives
// an in-memory wipe (`_resetFinMindSchedulerCursorsForTest()` simulates the
// process restart) by reading back from the real `scheduler_cursors` table,
// not from a re-implementation of the persistence logic in this test file.
// Memory-mode behavior (no DB — round-robin still works, just doesn't
// survive a restart) is covered separately in tests/ci.test.ts.
//
// Wired into `pnpm run test:db` (package.json), same lane as
// idempotency-race.test.ts / paper-executor.test.ts / strategy-ideas.test.ts.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";

import { eq } from "drizzle-orm";
import { getDb, schedulerCursors } from "@iuf-trading-room/db";

import { _resetFinMindSchedulerCursorsForTest, takeFinMindSchedulerBatch } from "../server.js";

type Ticker = { ticker: string };

function makeTickers(count: number): Ticker[] {
  return Array.from({ length: count }, (_, i) => ({ ticker: String(1000 + i) }));
}

const testJobs: string[] = [];

after(async () => {
  const db = getDb();
  if (!db || testJobs.length === 0) return;
  for (const job of testJobs) {
    await db.delete(schedulerCursors).where(eq(schedulerCursors.job, job)).catch(() => {});
  }
});

test("CURSOR-PERSIST-1: cursor survives an in-memory wipe by reading back from scheduler_cursors", async () => {
  const db = getDb();
  assert.ok(db, "this test requires PERSISTENCE_MODE=database with a live Postgres connection");

  const job = `test-cursor-persist-${randomUUID()}`;
  testJobs.push(job);
  const tickers = makeTickers(5); // sorted: 1000,1001,1002,1003,1004

  // First batch of 2: expect 1000,1001, cursor persisted at 2.
  const first = await takeFinMindSchedulerBatch(job, tickers, 2);
  assert.deepEqual(first.map((t) => t.ticker), ["1000", "1001"]);

  // Simulate a process restart: the in-memory fast-path cache is wiped, but
  // the DB row must still hold cursor=2.
  _resetFinMindSchedulerCursorsForTest();

  const persisted = await db
    .select({ cursor: schedulerCursors.cursor })
    .from(schedulerCursors)
    .where(eq(schedulerCursors.job, job))
    .limit(1);
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0]?.cursor, 2);

  // Second batch after the simulated restart must resume from the persisted
  // cursor (1002,1003) — NOT restart at 0 (which would incorrectly
  // re-return 1000,1001 and starve 1002-1004, the exact bug this fixes).
  const second = await takeFinMindSchedulerBatch(job, tickers, 2);
  assert.deepEqual(second.map((t) => t.ticker), ["1002", "1003"]);
});

test("CURSOR-PERSIST-2: cursor wraps around the ticker list and persists the wrap", async () => {
  const db = getDb();
  assert.ok(db, "this test requires PERSISTENCE_MODE=database with a live Postgres connection");

  const job = `test-cursor-wrap-${randomUUID()}`;
  testJobs.push(job);
  const tickers = makeTickers(5); // 1000..1004

  await takeFinMindSchedulerBatch(job, tickers, 3); // 1000,1001,1002 -> cursor=3
  _resetFinMindSchedulerCursorsForTest();
  const wrapped = await takeFinMindSchedulerBatch(job, tickers, 3); // 1003,1004,1000 -> cursor=1
  assert.deepEqual(wrapped.map((t) => t.ticker), ["1003", "1004", "1000"]);

  _resetFinMindSchedulerCursorsForTest();
  const afterWrap = await db
    .select({ cursor: schedulerCursors.cursor })
    .from(schedulerCursors)
    .where(eq(schedulerCursors.job, job))
    .limit(1);
  assert.equal(afterWrap[0]?.cursor, 1);
});
