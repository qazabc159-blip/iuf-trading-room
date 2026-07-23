// orchestrator-v3-taiex-ema60-db.test.ts — 2026-07-23 (R1 audit fix, dual-criteria audit)
//
// computeTaiexEma60FromDb() (orchestrator-v3.ts) feeds the S6 "TAIEX < EMA60"
// risk-off signal consumed by computeProgrammaticRiskOffScore() — when this
// signal fires on a bear-market day, AI recommendation v3 is supposed to
// enter its risk-off branch and reduce/skip position sizing.
//
// Root cause (DUAL_CRITERIA_AUDIT_20260723.md, finding R1): the function cast
// db.execute()'s result to `{ rows: Array<{ close: string }> }` and read
// `.rows ?? []`. This repo's driver is drizzle-orm/postgres-js, whose
// execute() returns the row array DIRECTLY (see packages/db/src/client.ts
// execRows() doc comment + CLAUDE.md "常見陷阱"). `.rows` on a bare array is
// always `undefined`, so `rows.rows ?? []` was always `[]`, `closes.length`
// was always `0` (`< 20`), and the function returned `null` on every call —
// the EMA60 signal silently died regardless of what companies_ohlcv held.
//
// This test proves the mechanism directly against a real Postgres (not a
// re-implementation of the shape logic): seeds 60 real companies_ohlcv rows
// for ticker 'TAIEX' with known, ascending close prices, then asserts
// computeTaiexEma60FromDb() returns the correct EMA60 (independently
// recomputed here with the same well-known recursive EMA formula) instead of
// null. Before the R1 fix this assertion fails (`ema === null`); after the
// fix it returns a value within 0.01 of the independently-computed EMA60.
//
// Wired into `pnpm run test:db` (package.json), same lane as
// twse-openapi-client-index-history.test.ts / paper-realized-pnl-db.test.ts.
//
// KNOWN SEPARATE GAP (not fixed by this PR, flagged for follow-up routing):
// production `companies_ohlcv` has never had a row for ticker
// 'TAIEX'/'^TWII'/'0000' (see apps/api/src/ai-rec-perf-store.ts:384-386,
// verified on prod 2026-06-11) — real TAIEX daily closes are persisted to
// the separate `index_history` table instead. So even with this R1 fix
// applied, computeTaiexEma60FromDb() may still return null in prod today
// because its source table is empty for this ticker, independent of the
// `.rows` shape bug this test targets. This test's fixture supplies the
// missing companies_ohlcv rows itself to isolate and prove the shape-bug
// fix in isolation.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after, before } from "node:test";

import { eq, sql as drizzleSql } from "drizzle-orm";
import { getDb, companies, companiesOhlcv, workspaces } from "@iuf-trading-room/db";

import { computeTaiexEma60FromDb } from "./orchestrator-v3.js";

const TEST_TICKER = "TAIEX";
let workspaceId = "";
let companyId = "";

before(async () => {
  const db = getDb();
  assert.ok(db, "this suite requires PERSISTENCE_MODE=database — run via `pnpm run test:db`");

  const [ws] = await db
    .insert(workspaces)
    .values({ name: "TAIEX EMA60 DB Test", slug: `taiex-ema60-db-test-${randomUUID()}` })
    .returning();
  if (!ws) throw new Error("before: workspaces INSERT returned no row");
  workspaceId = ws.id;

  const [company] = await db
    .insert(companies)
    .values({
      workspaceId,
      name: "TAIEX Index (test fixture)",
      ticker: TEST_TICKER,
      market: "TWSE",
      country: "TW",
      chainPosition: "Index"
    })
    .returning();
  if (!company) throw new Error("before: companies INSERT returned no row");
  companyId = company.id;

  // 60 ascending daily closes, oldest → newest, far in the past so this
  // isolated fixture can never collide with real TAIEX/^TWII/0000 rows a
  // future writer might add to companies_ohlcv.
  const rows = Array.from({ length: 60 }, (_, i) => ({
    companyId,
    workspaceId,
    dt: shiftDate("1999-01-01", i),
    close: String(20000 + i),
    open: String(20000 + i),
    high: String(20000 + i),
    low: String(20000 + i),
    volume: 0,
    source: "mock" as const
  }));

  await db.insert(companiesOhlcv).values(rows);
});

after(async () => {
  const db = getDb();
  if (!db) return;
  await db.delete(companiesOhlcv).where(eq(companiesOhlcv.companyId, companyId)).catch(() => {});
  await db.delete(companies).where(eq(companies.id, companyId)).catch(() => {});
  await db.delete(workspaces).where(eq(workspaces.id, workspaceId)).catch(() => {});
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

test("TAIEX-EMA60-DB-1: computeTaiexEma60FromDb reads real companies_ohlcv rows via execRows (not null)", async () => {
  const db = getDb();
  assert.ok(db, "requires PERSISTENCE_MODE=database");

  // Sanity: confirm the fixture actually landed (rules out "empty table" as
  // an alternate explanation for a null result, isolating the .rows bug).
  const countRows = await db.execute(
    drizzleSql`SELECT COUNT(*)::int AS n FROM companies_ohlcv WHERE company_id = ${companyId}::uuid`
  );
  const seededCount = Array.isArray(countRows) ? (countRows[0] as { n: number })?.n : undefined;
  assert.equal(seededCount, 60, "TAIEX-EMA60-DB-1: fixture must have inserted exactly 60 rows");

  const closesAscending = Array.from({ length: 60 }, (_, i) => 20000 + i);
  const expected = referenceEma(closesAscending);

  const ema = await computeTaiexEma60FromDb();

  assert.notEqual(
    ema,
    null,
    "TAIEX-EMA60-DB-1: EMA60 must not be null when companies_ohlcv has >=20 rows for TAIEX " +
      "(pre-fix regression: `.rows` on a postgres-js bare-array result is always undefined, " +
      "so closes was always [] and this returned null unconditionally)"
  );
  assert.ok(
    Math.abs((ema as number) - expected) < 0.01,
    `TAIEX-EMA60-DB-1: expected EMA60 ~= ${expected}, got ${ema}`
  );
});
