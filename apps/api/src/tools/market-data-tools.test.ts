import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { getSectorRotationFromDb, revenuePeriodKey } from "./market-data-tools.js";

test("monthly revenue uses the accounting period instead of the publication date", () => {
  assert.equal(revenuePeriodKey({
    date: "2026-06-10",
    revenue_year: 2026,
    revenue_month: 5,
  }), "2026-05");
});

test("monthly revenue period falls back to date when FinMind omits period fields", () => {
  assert.equal(revenuePeriodKey({ date: "2026-04-01" }), "2026-04");
});

// ---------------------------------------------------------------------------
// get_sector_rotation DB fallback — 2026-07-24 fix
//
// Root cause: this query used to reference companies.industry, a column that
// has never existed (companies only has chain_position — see schema.ts).
// Postgres threw "column c.industry does not exist" on every call; the error
// was swallowed by getSectorRotationFromDb()'s own try/catch, so this branch
// silently always returned { sectors: [], source: "twse_stock_day_all" }.
//
// Only runs when PERSISTENCE_MODE=database + DATABASE_URL are set (this
// repo's CI has no DB service — same convention as strategy-runs-db.test.ts
// SR7 and broker-account-ownership.test.ts). Skips (green) otherwise.
//
// Red/green self-proof: reverting the fallback query's `c.chain_position` back
// to `c.industry` reproduces the original bug — Postgres throws column-does-
// not-exist, the catch swallows it, and this test's non-empty/source/sector-
// label assertions all fail.
// ---------------------------------------------------------------------------

test("get_sector_rotation DB fallback — column exists + fixture data returns non-empty sectors", async (t) => {
  if (!process.env.PERSISTENCE_MODE || process.env.PERSISTENCE_MODE !== "database") {
    t.skip("Requires PERSISTENCE_MODE=database and DATABASE_URL");
    return;
  }
  if (!process.env.DATABASE_URL) {
    t.skip("Requires DATABASE_URL");
    return;
  }

  const { getDb, execRows } = await import("@iuf-trading-room/db");
  const { sql } = await import("drizzle-orm");
  const db = getDb();
  assert.ok(db, "getDb() must return a client when DATABASE_URL is set");

  // ── Field-existence guard (matches the RCA method: information_schema
  // against the real table, not just schema.ts) ──────────────────────────
  const colRes = await db!.execute(sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'companies' AND column_name IN ('industry', 'chain_position')
  `);
  const cols = new Set(execRows<{ column_name: string }>(colRes).map((r) => r.column_name));
  assert.ok(cols.has("chain_position"), "companies.chain_position must exist");
  assert.ok(!cols.has("industry"), "companies.industry must NOT exist (sanity check on the bug's premise)");

  // ── Fixture: one workspace, two companies (distinct chain_position), two
  // trading days of OHLCV so changePct is computable ─────────────────────
  const workspaceId = randomUUID();
  const companyAId = randomUUID();
  const companyBId = randomUUID();
  const tickerA = `T${randomUUID().slice(0, 6).toUpperCase()}`;
  const tickerB = `T${randomUUID().slice(0, 6).toUpperCase()}`;
  const sectorA = `測試半導體業-${workspaceId.slice(0, 8)}`;
  const sectorB = `測試金融業-${workspaceId.slice(0, 8)}`;
  // Far-future dates so this fixture is deterministically MAX(dt) across the
  // whole companies_ohlcv table (getSectorRotationFromDb() looks up the
  // globally most-recent date, not workspace-scoped) — avoids flaking against
  // real ingested market data that may already be at today's trade date.
  const prevDt = "2099-01-01";
  const latestDt = "2099-01-02";

  try {
    await db!.execute(sql`
      INSERT INTO workspaces (id, name, slug) VALUES (${workspaceId}, 'sector-rotation-test', ${`sr-test-${workspaceId}`})
    `);
    await db!.execute(sql`
      INSERT INTO companies (id, workspace_id, name, ticker, market, country, chain_position)
      VALUES
        (${companyAId}, ${workspaceId}, 'Sector Test A', ${tickerA}, 'TWSE', 'TW', ${sectorA}),
        (${companyBId}, ${workspaceId}, 'Sector Test B', ${tickerB}, 'TWSE', 'TW', ${sectorB})
    `);
    // Company A: 100 -> 110 (+10%); Company B: 100 -> 95 (-5%)
    await db!.execute(sql`
      INSERT INTO companies_ohlcv (company_id, workspace_id, dt, interval, open, high, low, close, volume, source)
      VALUES
        (${companyAId}, ${workspaceId}, ${prevDt}, '1d', 100, 100, 100, 100, 1000, 'mock'),
        (${companyAId}, ${workspaceId}, ${latestDt}, '1d', 110, 110, 110, 110, 1000, 'mock'),
        (${companyBId}, ${workspaceId}, ${prevDt}, '1d', 100, 100, 100, 100, 1000, 'mock'),
        (${companyBId}, ${workspaceId}, ${latestDt}, '1d', 95, 95, 95, 95, 1000, 'mock')
    `);

    const result = await getSectorRotationFromDb(20, new Date().toISOString());

    assert.equal(result.source, "db_ohlcv_fallback", "must take the DB fallback path, not fail-open to empty");
    assert.ok(result.sectors.length > 0, "fixture data must produce a non-empty sectors array");

    const bySector = new Map(result.sectors.map((s) => [s.sector, s]));
    const rowA = bySector.get(sectorA);
    const rowB = bySector.get(sectorB);
    assert.ok(rowA, `sector ${sectorA} (chain_position) must appear in the result`);
    assert.ok(rowB, `sector ${sectorB} (chain_position) must appear in the result`);
    assert.equal(rowA!.avgChangePct, 10, "company A +10% must roll up correctly");
    assert.equal(rowB!.avgChangePct, -5, "company B -5% must roll up correctly");
  } finally {
    await db!.execute(sql`DELETE FROM companies_ohlcv WHERE workspace_id = ${workspaceId}`);
    await db!.execute(sql`DELETE FROM companies WHERE workspace_id = ${workspaceId}`);
    await db!.execute(sql`DELETE FROM workspaces WHERE id = ${workspaceId}`);
  }
});
