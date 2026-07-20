/**
 * mis-sweep-market-mapping.test.ts — 2026-07-20
 * (quote_close_0050_forensics_20260720)
 *
 * `_mapMisSweepCompanyMarket()` maps a `companies.market` DB string to the
 * canonical Market enum used to tag TWSE-MIS-QUOTE-CRON's full-universe
 * sweep quotes (`_runMisFullSweepSlice` in server.ts).
 *
 * Live prod forensics (railway ssh, 2026-07-20): `companies.market` holds
 * non-exchange-venue values for 3 real TWSE-listed tickers — "ETF" for 0050
 * (元大台灣50), "食品工業" (an industry-sector label) for 1216 (統一企業),
 * "存託憑證" (depositary-receipt label) for 9105 (泰金寶-DR). The OLD version
 * of this function defaulted any unrecognized value to "OTHER", while every
 * other quote source for the same real symbol (including this function's
 * own sibling `_misSwpExPrefix`, which already defaults to "tse"/TWSE) kept
 * tagging it "TWSE" — two different (symbol, market) identity keys for one
 * real security, which is the root cause of the
 * `?symbols=2330,0050,2454` duplicate-item bug (resolveMarketQuotes groups
 * by buildQuoteIdentityKey(symbol, market)) and of "0050 shows no fresh MIS
 * source under a market=TWSE filter" (the fresh quote was tagged "OTHER",
 * so a TWSE-only filter silently excluded it).
 *
 * Run: node --test --import tsx/esm apps/api/src/__tests__/mis-sweep-market-mapping.test.ts
 */
import assert from "node:assert/strict";
import test from "node:test";

import { _mapMisSweepCompanyMarket } from "../server.js";

test("recognized exchange-venue values map through unchanged", () => {
  assert.equal(_mapMisSweepCompanyMarket("TWSE"), "TWSE");
  assert.equal(_mapMisSweepCompanyMarket("TPEX"), "TPEX");
  assert.equal(_mapMisSweepCompanyMarket("TWO"), "TWO");
  assert.equal(_mapMisSweepCompanyMarket("TW_EMERGING"), "TW_EMERGING");
  assert.equal(_mapMisSweepCompanyMarket("上市"), "TWSE");
  assert.equal(_mapMisSweepCompanyMarket("上櫃"), "TPEX");
});

test("REGRESSION (2026-07-20 prod bug): instrument-type/industry values leaked into companies.market default to TWSE, not OTHER", () => {
  // Live-verified values from the `companies` table for real TWSE-listed
  // tickers (0050 / 1216 / 9105) — see this function's docstring.
  assert.equal(_mapMisSweepCompanyMarket("ETF"), "TWSE", "0050 元大台灣50 — was defaulting to OTHER, split its (symbol,market) identity key from the TWSE-tagged manual/EOD-cron quote for the same symbol");
  assert.equal(_mapMisSweepCompanyMarket("食品工業"), "TWSE", "1216 統一企業");
  assert.equal(_mapMisSweepCompanyMarket("存託憑證"), "TWSE", "9105 泰金寶-DR");
});

test("case/whitespace insensitive", () => {
  assert.equal(_mapMisSweepCompanyMarket("  tpex  "), "TPEX");
  assert.equal(_mapMisSweepCompanyMarket("two"), "TWO");
});

test("empty string defaults to TWSE (matches _misSwpExPrefix's own default of tse)", () => {
  assert.equal(_mapMisSweepCompanyMarket(""), "TWSE");
});
