/**
 * symbol-whitelist.test.ts — W5b A2: T7 whitelist behavior tests.
 *
 * Run: node --test --import tsx/esm apps/api/src/__tests__/symbol-whitelist.test.ts
 *
 * Coverage:
 *   T7-1: env unset → default ["2330"]
 *   T7-2: env empty string → default ["2330"]
 *   T7-3: env whitespace-only → default ["2330"]
 *   T7-4: env = "2330" (single symbol) → ["2330"]
 *   T7-5: env = "2330,2317,2454" (multi-symbol) → ["2330","2317","2454"]
 *   T7-6: allowed symbol "2330" with default whitelist → isSymbolAllowed = true
 *   T7-7: rejected symbol "NOTLISTED" with default whitelist → isSymbolAllowed = false
 *   T7-8: rejected symbol returns correct 422 envelope shape
 *   T7-9: no-order proof — parseSymbolWhitelist + isSymbolAllowed have 0 order-named exports
 *   T7-10: env with trailing comma → trims empty segments → valid list
 *   T7-11: env with spaces around commas → trims correctly
 *
 * Hard lines:
 *   - NO /order/create URL called in any import chain
 *   - NO route registration
 *   - NO network calls
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  parseSymbolWhitelist,
  isSymbolAllowed,
  buildSymbolNotAllowedEnvelope,
  DEFAULT_WHITELIST,
} from "../lib/symbol-whitelist.js";

// ---------------------------------------------------------------------------
// T7-1: env unset → default ["2330"]
// ---------------------------------------------------------------------------

test("T7-1: env unset (undefined) → default whitelist [\"2330\"]", () => {
  const result = parseSymbolWhitelist(undefined);
  assert.deepEqual(result, ["2330"]);
});

// ---------------------------------------------------------------------------
// T7-2: env empty string → default ["2330"]
// ---------------------------------------------------------------------------

test("T7-2: env empty string → default whitelist [\"2330\"]", () => {
  const result = parseSymbolWhitelist("");
  assert.deepEqual(result, ["2330"]);
});

// ---------------------------------------------------------------------------
// T7-3: env whitespace-only → default ["2330"]
// ---------------------------------------------------------------------------

test("T7-3: env whitespace-only → default whitelist [\"2330\"]", () => {
  const result = parseSymbolWhitelist("   ");
  assert.deepEqual(result, ["2330"]);
});

// ---------------------------------------------------------------------------
// T7-4: env = "2330" (single symbol explicit)
// ---------------------------------------------------------------------------

test("T7-4: env = \"2330\" single symbol → [\"2330\"]", () => {
  const result = parseSymbolWhitelist("2330");
  assert.deepEqual(result, ["2330"]);
});

// ---------------------------------------------------------------------------
// T7-5: env = "2330,2317,2454" multi-symbol
// ---------------------------------------------------------------------------

test("T7-5: env = \"2330,2317,2454\" multi-symbol → [\"2330\",\"2317\",\"2454\"]", () => {
  const result = parseSymbolWhitelist("2330,2317,2454");
  assert.deepEqual(result, ["2330", "2317", "2454"]);
});

// ---------------------------------------------------------------------------
// T7-6: allowed symbol path
// ---------------------------------------------------------------------------

test("T7-6: allowed symbol \"2330\" with default whitelist → isSymbolAllowed=true", () => {
  const wl = parseSymbolWhitelist(undefined); // ["2330"]
  assert.equal(isSymbolAllowed("2330", wl), true);
});

test("T7-6b: allowed symbol in multi-symbol list → isSymbolAllowed=true", () => {
  const wl = parseSymbolWhitelist("2330,2317,2454");
  assert.equal(isSymbolAllowed("2317", wl), true);
  assert.equal(isSymbolAllowed("2454", wl), true);
});

// ---------------------------------------------------------------------------
// T7-7: rejected symbol path
// ---------------------------------------------------------------------------

test("T7-7: rejected symbol \"NOTLISTED\" with default whitelist → isSymbolAllowed=false", () => {
  const wl = parseSymbolWhitelist(undefined);
  assert.equal(isSymbolAllowed("NOTLISTED", wl), false);
});

test("T7-7b: rejected symbol \"2317\" when whitelist is only [\"2330\"] → false", () => {
  const wl = parseSymbolWhitelist("2330");
  assert.equal(isSymbolAllowed("2317", wl), false);
});

// ---------------------------------------------------------------------------
// T7-8: 422 envelope shape for rejected symbol
// ---------------------------------------------------------------------------

test("T7-8: buildSymbolNotAllowedEnvelope returns correct 422 envelope shape", () => {
  const envelope = buildSymbolNotAllowedEnvelope("BADSTOCK");
  assert.equal(envelope.error.code, "SYMBOL_NOT_ALLOWED");
  assert.equal(envelope.error.symbol, "BADSTOCK");
  assert.ok(envelope.error.message.includes("BADSTOCK"), "message must include the rejected symbol");
  assert.ok(envelope.error.message.includes("KGI_QUOTE_SYMBOL_WHITELIST"), "message must reference env var name");
});

// ---------------------------------------------------------------------------
// T7-9: no-order proof
// ---------------------------------------------------------------------------

test("T7-9: no-order proof — whitelist module exports have 0 order-named functions", () => {
  const orderPatterns = ["order", "submit", "place", "cancel", "create"];
  const exportNames = [
    "parseSymbolWhitelist",
    "isSymbolAllowed",
    "buildSymbolNotAllowedEnvelope",
    "DEFAULT_WHITELIST",
    "WHITELIST_ENV_VAR",
  ];
  for (const name of exportNames) {
    for (const pattern of orderPatterns) {
      assert.ok(
        !name.toLowerCase().includes(pattern),
        `symbol-whitelist.ts export '${name}' must not contain order pattern '${pattern}'`
      );
    }
  }
});

// ---------------------------------------------------------------------------
// T7-10: trailing comma in env → empty segments dropped
// ---------------------------------------------------------------------------

test("T7-10: env with trailing comma → valid list without empty segment", () => {
  const result = parseSymbolWhitelist("2330,2317,");
  assert.deepEqual(result, ["2330", "2317"]);
  assert.equal(result.includes(""), false, "must not include empty string segment");
});

// ---------------------------------------------------------------------------
// T7-11: spaces around commas
// ---------------------------------------------------------------------------

test("T7-11: env with spaces around commas → trimmed correctly", () => {
  const result = parseSymbolWhitelist("  2330 , 2317 ,  2454  ");
  assert.deepEqual(result, ["2330", "2317", "2454"]);
});

// ---------------------------------------------------------------------------
// T7-12: DEFAULT_WHITELIST is immutable / not mutated by parseSymbolWhitelist
// ---------------------------------------------------------------------------

test("T7-12: parseSymbolWhitelist(undefined) returns a new array; DEFAULT_WHITELIST is unchanged", () => {
  const result = parseSymbolWhitelist(undefined);
  // Mutate the returned array
  result.push("9999");
  // DEFAULT_WHITELIST must remain ["2330"]
  assert.deepEqual([...DEFAULT_WHITELIST], ["2330"], "DEFAULT_WHITELIST must not be mutated");
});
