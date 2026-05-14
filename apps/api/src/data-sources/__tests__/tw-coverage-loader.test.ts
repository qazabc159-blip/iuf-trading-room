/**
 * tw-coverage-loader.test.ts
 *
 * Unit tests for My-TW-Coverage loader functions.
 * These tests read REAL files from the My-TW-Coverage sibling repo or bundled copy.
 * They are file-I/O only — no DB, no network, no secrets.
 *
 * Run:
 *   node --import tsx --test apps/api/src/data-sources/__tests__/tw-coverage-loader.test.ts
 *
 * Skip gracefully when coverage files are absent (e.g. Railway build context).
 */

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  _resetCoverageCache,
  findCompaniesByWikilink,
  getCompanyCoverageBrief,
  listSectorCompanies,
} from "../tw-coverage-loader.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Check if coverage data is available (either bundled or sibling repo)
const bundledPath = path.resolve(__dirname, "../../../../data/tw-coverage");
const siblingPath = path.resolve(__dirname, "../../../../../../My-TW-Coverage/Pilot_Reports");
const coverageAvailable = existsSync(bundledPath) || existsSync(siblingPath);

const skipIfNoCoverage = coverageAvailable
  ? (name: string, fn: () => Promise<void>) => test(name, fn)
  : (name: string, _fn: () => Promise<void>) =>
      test(name, { skip: "Coverage data not available in this environment" }, async () => {});

test("TWCV0: exports are functions", () => {
  assert.equal(typeof getCompanyCoverageBrief, "function", "getCompanyCoverageBrief must be a function");
  assert.equal(typeof findCompaniesByWikilink, "function", "findCompaniesByWikilink must be a function");
  assert.equal(typeof listSectorCompanies, "function", "listSectorCompanies must be a function");
});

skipIfNoCoverage("TWCV1: getCompanyCoverageBrief('2330') returns 台積電 with Apple customer + ASML supplier", async () => {
  _resetCoverageCache();
  const brief = await getCompanyCoverageBrief("2330");
  assert.ok(brief !== null, "TWCV1: 2330 brief must not be null");
  assert.equal(brief!.ticker, "2330", "TWCV1: ticker field");
  assert.ok(
    brief!.companyName.includes("台積電"),
    `TWCV1: companyName must include 台積電, got: ${brief!.companyName}`
  );
  assert.ok(
    brief!.businessOverview.length > 20,
    "TWCV1: businessOverview must be non-trivial"
  );
  // Apple must appear in customers or supply chain
  const hasApple =
    brief!.majorCustomers.some((c) => c.includes("Apple")) ||
    brief!.supplyChain.downstream.some((g) =>
      g.companies.some((c) => c.includes("Apple"))
    );
  assert.ok(hasApple, "TWCV1: Apple must appear as customer or downstream");

  // ASML must appear in suppliers or upstream
  const hasASML =
    brief!.majorSuppliers.some((s) => s.includes("ASML")) ||
    brief!.supplyChain.upstream.some((g) =>
      g.companies.some((c) => c.includes("ASML"))
    );
  assert.ok(hasASML, "TWCV1: ASML must appear as supplier or upstream");

  // rawMarkdown must be present
  assert.ok(brief!.rawMarkdown.length > 100, "TWCV1: rawMarkdown must be non-trivial");
});

skipIfNoCoverage("TWCV2: findCompaniesByWikilink('Apple') returns multiple tickers including 2330", async () => {
  const result = await findCompaniesByWikilink("Apple");
  assert.equal(result.token, "Apple", "TWCV2: token field");
  assert.ok(result.matches.length >= 2, `TWCV2: Apple must appear in ≥2 companies, got ${result.matches.length}`);
  const has2330 = result.matches.some((m) => m.ticker === "2330");
  assert.ok(has2330, "TWCV2: 2330 must be in Apple wikilink matches");
  // All matches must have required fields
  for (const m of result.matches) {
    assert.ok(m.ticker, "TWCV2: each match must have ticker");
    assert.ok(m.companyName, "TWCV2: each match must have companyName");
    assert.ok(m.sector, "TWCV2: each match must have sector");
    assert.ok(
      ["customer", "supplier", "upstream", "downstream", "related"].includes(m.relation),
      `TWCV2: relation must be valid enum, got ${m.relation}`
    );
  }
});

skipIfNoCoverage("TWCV3: listSectorCompanies('Semiconductors') returns 155+ tickers", async () => {
  const companies = await listSectorCompanies("Semiconductors");
  assert.ok(
    companies.length >= 155,
    `TWCV3: Semiconductors must have ≥155 companies, got ${companies.length}`
  );
  const tsmc = companies.find((c) => c.ticker === "2330");
  assert.ok(tsmc, "TWCV3: 2330 must be in Semiconductors sector");
  assert.ok(tsmc!.companyName.includes("台積電"), "TWCV3: 2330 companyName must include 台積電");
});

skipIfNoCoverage("TWCV4: getCompanyCoverageBrief for missing ticker returns null", async () => {
  _resetCoverageCache();
  const brief = await getCompanyCoverageBrief("9999");
  assert.equal(brief, null, "TWCV4: missing ticker must return null");
});

skipIfNoCoverage("TWCV5: getCompanyCoverageBrief result is cached (2nd call returns same object)", async () => {
  _resetCoverageCache();
  const brief1 = await getCompanyCoverageBrief("2330");
  const brief2 = await getCompanyCoverageBrief("2330");
  assert.ok(brief1 !== null && brief2 !== null, "TWCV5: both results must be non-null");
  // Same identity from cache
  assert.strictEqual(brief1, brief2, "TWCV5: 2nd call must return cached object (strict identity)");
});
