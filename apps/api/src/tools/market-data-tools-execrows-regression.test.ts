// market-data-tools-execrows-regression.test.ts — 2026-07-24 (Jason-2)
//
// Pete's PR #1352 review (evidence/sprint_2026_07_23/pr1352_review.md, 🟡 #1)
// flagged that the 8 sites in this file fixed alongside the orchestrator-v3
// TAIEX EMA60 `.rows` silent-zero bug (postgres-js's db.execute() returns a
// bare row array, not `{ rows: [...] }` — reading `.rows` on it is always
// `undefined`) had zero dedicated regression coverage — only typecheck + the
// existing (pre-fix-agnostic) CI green. This file closes that gap for the
// sites that are actually reachable against the real schema (see below for
// the two sites that are NOT, with the reason).
//
// Each test seeds real rows via drizzle-orm/postgres-js (the same driver
// production runs on — not a re-implementation of the row shape) and calls
// the exported tool function directly. Removing execRows() at the site under
// test (reverting to a naked `.rows` read) makes these tests fail, because
// the seeded data would never be read back — see PR body for the red/green
// self-proof transcript.
//
// ── Site coverage ───────────────────────────────────────────────────────────
//   getCompanyTechnical  — 2 sites (company name lookup, OHLCV rows)   → MDT-1
//   getInstitutionalFlow — 1 site (tw_institutional_buysell rows)     → MDT-2
//   getSupplyChain       — 3 sites (company, theme links, relations)  → MDT-3
//   getSectorRotation    — 2 sites (DB fallback path)                 → NOT COVERED, see below
//   computeTaiexEma60FromDb (orchestrator-v3.ts) — already has its own
//     dedicated DB-mode test (orchestrator-v3-taiex-ema60-db.test.ts,
//     TAIEX-EMA60-DB-1/2) — not duplicated here.
//
// ── getSectorRotation NOT covered (unexpected finding, out of this PR's scope) ──
// getSectorRotation()'s DB fallback issues:
//   SELECT c.industry AS industry, o.close AS close, o_prev.close AS prev_close
//   FROM companies_ohlcv o INNER JOIN companies c ON c.id = o.company_id ...
// `companies.industry` does not exist in the schema (verified against both
// packages/db/src/schema.ts — the `companies` pgTable has no `industry`
// column — and a live Postgres via information_schema.columns: chain_position,
// beneficiary_tier are the only classification columns). This is a
// pre-existing, unrelated bug: the query throws "column c.industry does not
// exist" at the driver level BEFORE the `.rows`/execRows() read is ever
// reached, so the fallback branch fails open to `{ sectors: [] }` today
// regardless of whether execRows() is used correctly at that site — there is
// no reachable "success" state to build a red/green execRows regression test
// against. (The first query in the same function, `SELECT MAX(dt) ...`, has
// no such issue and would execute fine, but the function always proceeds to
// the broken second query right after, so it can't be isolated through the
// public getSectorRotation() API.) Flagging for Elva to route as a separate
// ticket — not fixed here (would be scope creep on a test/guard-only PR, and
// the right fix — add the column, or query a different existing column — is
// a product/data-source decision, not a mechanical execRows swap).
//
// Wired into `pnpm run test:db` (package.json), same lane as
// orchestrator-v3-taiex-ema60-db.test.ts / paper-realized-pnl-db.test.ts.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { before } from "node:test";

import { eq, sql as drizzleSql } from "drizzle-orm";
import {
  companies,
  companiesOhlcv,
  companyRelations,
  companyThemeLinks,
  getDb,
  themes,
  workspaces
} from "@iuf-trading-room/db";

import { getCompanyTechnical, getInstitutionalFlow, getSupplyChain } from "./market-data-tools.js";

let workspaceId = "";

before(async () => {
  const db = getDb();
  assert.ok(db, "this suite requires PERSISTENCE_MODE=database — run via `pnpm run test:db`");
  const [existing] = await db.select().from(workspaces).limit(1);
  if (existing) {
    workspaceId = existing.id;
  } else {
    const [created] = await db
      .insert(workspaces)
      .values({ name: "execrows-regression Test", slug: `execrows-regression-${randomUUID()}` })
      .returning();
    workspaceId = created!.id;
  }
});

// ── MDT-1: getCompanyTechnical — company name lookup + OHLCV rows ────────────

test("MDT-1: getCompanyTechnical reads real companies + companies_ohlcv rows (not null/empty)", async () => {
  const db = getDb()!;
  const ticker = `ZZT${randomUUID().slice(0, 6).toUpperCase()}`;
  const companyName = `execrows-regression MDT-1 ${ticker}`;

  const [company] = await db
    .insert(companies)
    .values({
      workspaceId,
      name: companyName,
      ticker,
      market: "TWSE",
      country: "TW",
      chainPosition: "Core"
    })
    .returning();
  assert.ok(company, "MDT-1 fixture: companies insert must return a row");

  try {
    // 2 rows so `changePct` / MA logic has something to divide against —
    // the regression assertion only needs data.length > 0, but a single row
    // would silently mask a shape bug that only shows up on r.close access
    // for the second element.
    await db.insert(companiesOhlcv).values([
      {
        companyId: company!.id,
        workspaceId,
        dt: "2026-07-20",
        interval: "1d",
        open: "100.00",
        high: "101.00",
        low: "99.00",
        close: "100.50",
        volume: 12345,
        source: "mock"
      },
      {
        companyId: company!.id,
        workspaceId,
        dt: "2026-07-21",
        interval: "1d",
        open: "100.50",
        high: "102.00",
        low: "100.00",
        close: "101.20",
        volume: 23456,
        source: "mock"
      }
    ]);

    const result = await getCompanyTechnical(ticker);

    assert.equal(
      result.companyName,
      companyName,
      "MDT-1: companyName must come back from the real companies row (proves the name-lookup execRows() site is wired, not reading undefined `.rows`)"
    );
    assert.notEqual(
      result.lastPrice,
      null,
      "MDT-1: lastPrice must not be null — with 2 real companies_ohlcv rows seeded, a naked `.rows` read would silently degrade to an empty array here"
    );
    assert.equal(result.lastPrice, 101.2);
    assert.equal(result.source, "companies_ohlcv");
    assert.equal(result.asOf, "2026-07-21");
  } finally {
    await db.delete(companiesOhlcv).where(eq(companiesOhlcv.companyId, company!.id)).catch(() => {});
    await db.delete(companies).where(eq(companies.id, company!.id)).catch(() => {});
  }
});

// ── MDT-2: getInstitutionalFlow — tw_institutional_buysell rows ──────────────
//
// No drizzle schema object exists for tw_institutional_buysell (it's a
// migration-0023 raw-SQL table, same as the production code queries it) —
// seed/cleanup use raw SQL through the same db.execute() the production code
// path uses.

test("MDT-2: getInstitutionalFlow reads real tw_institutional_buysell rows (not null/empty)", async () => {
  const db = getDb()!;
  const ticker = `ZZI${randomUUID().slice(0, 6).toUpperCase()}`;
  const today = new Date().toISOString().slice(0, 10);

  await db.execute(drizzleSql`
    INSERT INTO tw_institutional_buysell (stock_id, date, name, buy, sell, fetched_at, source)
    VALUES (${ticker}, ${today}, 'foreign', 5000, 2000, NOW(), 'test-fixture')
  `);

  try {
    const result = await getInstitutionalFlow(ticker);

    assert.equal(
      result.rowCount,
      1,
      "MDT-2: rowCount must be 1 — with a real tw_institutional_buysell row seeded, a naked `.rows` read would silently degrade to rowCount=0"
    );
    assert.equal(result.foreign30dNetShares, 3000, "MDT-2: 5000 buy - 2000 sell = 3000 net, classified into the 'foreign' bucket");
    assert.equal(result.total30dNetShares, 3000);
    assert.equal(result.latestDate, today);
  } finally {
    await db.execute(drizzleSql`DELETE FROM tw_institutional_buysell WHERE stock_id = ${ticker}`).catch(() => {});
  }
});

// ── MDT-3: getSupplyChain — company / theme-link / relation rows ─────────────

test("MDT-3: getSupplyChain reads real company + theme + relation rows (not null/empty)", async () => {
  const db = getDb()!;
  const tickerA = `ZZA${randomUUID().slice(0, 6).toUpperCase()}`;
  const tickerB = `ZZB${randomUUID().slice(0, 6).toUpperCase()}`;
  const themeName = `execrows-regression MDT-3 theme ${randomUUID().slice(0, 6)}`;

  const [companyA] = await db
    .insert(companies)
    .values({
      workspaceId,
      name: `MDT-3 Source ${tickerA}`,
      ticker: tickerA,
      market: "TWSE",
      country: "TW",
      chainPosition: "CoAP_Chip",
      beneficiaryTier: "Core"
    })
    .returning();
  const [companyB] = await db
    .insert(companies)
    .values({
      workspaceId,
      name: `MDT-3 Target ${tickerB}`,
      ticker: tickerB,
      market: "TWSE",
      country: "TW",
      chainPosition: "EMS"
    })
    .returning();
  assert.ok(companyA && companyB, "MDT-3 fixture: both companies inserts must return rows");

  const [theme] = await db
    .insert(themes)
    .values({ workspaceId, name: themeName, slug: `mdt3-${randomUUID().slice(0, 8)}` })
    .returning();
  assert.ok(theme, "MDT-3 fixture: themes insert must return a row");

  try {
    await db.insert(companyThemeLinks).values({ companyId: companyA!.id, themeId: theme!.id });

    const [relation] = await db
      .insert(companyRelations)
      .values({
        workspaceId,
        companyId: companyA!.id,
        targetCompanyId: companyB!.id,
        targetLabel: `MDT-3 Target ${tickerB}`,
        relationType: "supplier",
        confidence: 0.9,
        sourcePath: "test-fixture"
      })
      .returning();
    assert.ok(relation, "MDT-3 fixture: company_relations insert must return a row");

    const result = await getSupplyChain(tickerA);

    assert.equal(
      result.dataAvailable,
      true,
      "MDT-3: dataAvailable must be true — a naked `.rows` read on the company lookup would degrade to `company === undefined` and return the empty base result"
    );
    assert.equal(result.chainPosition, "CoAP_Chip");
    assert.equal(result.beneficiaryTier, "Core");
    assert.equal(
      result.themes.length,
      1,
      "MDT-3: themes must come back non-empty — proves the theme-links execRows() site is wired"
    );
    assert.equal(result.themes[0]!.name, themeName);
    assert.equal(
      result.suppliers.length,
      1,
      "MDT-3: suppliers must come back non-empty — proves the relations execRows() site is wired"
    );
    assert.equal(result.suppliers[0]!.ticker, tickerB);
  } finally {
    await db.delete(companyRelations).where(eq(companyRelations.companyId, companyA!.id)).catch(() => {});
    await db.delete(companyThemeLinks).where(eq(companyThemeLinks.companyId, companyA!.id)).catch(() => {});
    await db.delete(themes).where(eq(themes.id, theme!.id)).catch(() => {});
    await db.delete(companies).where(eq(companies.id, companyA!.id)).catch(() => {});
    await db.delete(companies).where(eq(companies.id, companyB!.id)).catch(() => {});
  }
});

// Fixtures are cleaned up per-test in their own finally blocks (isolated
// random tickers/ids per test) — nothing suite-wide to tear down.
