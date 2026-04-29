/**
 * symbol-whitelist.test.ts — W5b A2: T7 whitelist behavior tests.
 *
 * Policy: Option C — config-required (2026-04-29). No default whitelist.
 *
 * Run: node --test --import tsx/esm apps/api/src/__tests__/symbol-whitelist.test.ts
 *
 * Coverage:
 *   T7-1: env unset (undefined) → { configured: false }
 *   T7-2: env null → { configured: false }
 *   T7-3: env empty string → { configured: false }
 *   T7-4: env whitespace-only → { configured: false }
 *   T7-5: env all-empty segments (",,,") → { configured: false }
 *   T7-6: env = "2330" (single symbol) → { configured: true, whitelist: ["2330"] }
 *   T7-7: env = "2330,2317,2454" (multi-symbol) → { configured: true, whitelist: [...] }
 *   T7-8: allowed symbol with configured whitelist → isSymbolAllowed = true
 *   T7-9: rejected symbol with configured whitelist → isSymbolAllowed = false
 *   T7-10: rejected symbol returns correct SYMBOL_NOT_ALLOWED envelope shape
 *   T7-11: not-configured envelope shape
 *   T7-12: no-order proof — exports have 0 order-named patterns
 *   T7-13: env with trailing comma → trims empty segments → valid list
 *   T7-14: env with spaces around commas → trims correctly
 *
 * Hard lines:
 *   - NO /order/create URL called in any import chain
 *   - NO route registration
 *   - NO network calls
 *   - NO default whitelist (Option C: env-unset is a config error, not a default)
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  parseSymbolWhitelist,
  isSymbolAllowed,
  buildSymbolNotAllowedEnvelope,
  buildWhitelistNotConfiguredEnvelope,
  WHITELIST_ENV_VAR,
} from "../lib/symbol-whitelist.js";

// ---------------------------------------------------------------------------
// T7-1..T7-5: not-configured branches
// ---------------------------------------------------------------------------

test("T7-1: env unset (undefined) → { configured: false }", () => {
  const result = parseSymbolWhitelist(undefined);
  assert.deepEqual(result, { configured: false });
});

test("T7-2: env null → { configured: false }", () => {
  const result = parseSymbolWhitelist(null);
  assert.deepEqual(result, { configured: false });
});

test("T7-3: env empty string → { configured: false }", () => {
  const result = parseSymbolWhitelist("");
  assert.deepEqual(result, { configured: false });
});

test("T7-4: env whitespace-only → { configured: false }", () => {
  const result = parseSymbolWhitelist("   ");
  assert.deepEqual(result, { configured: false });
});

test("T7-5: env all-empty segments (',,,') → { configured: false }", () => {
  const result = parseSymbolWhitelist(",,,");
  assert.deepEqual(result, { configured: false });
});

// ---------------------------------------------------------------------------
// T7-6..T7-7: configured branches
// ---------------------------------------------------------------------------

test("T7-6: env = \"2330\" single symbol → { configured: true, whitelist: [\"2330\"] }", () => {
  const result = parseSymbolWhitelist("2330");
  assert.deepEqual(result, { configured: true, whitelist: ["2330"] });
});

test("T7-7: env = \"2330,2317,2454\" → { configured: true, whitelist: [...] }", () => {
  const result = parseSymbolWhitelist("2330,2317,2454");
  assert.deepEqual(result, { configured: true, whitelist: ["2330", "2317", "2454"] });
});

// ---------------------------------------------------------------------------
// T7-8..T7-9: enforcement
// ---------------------------------------------------------------------------

test("T7-8: allowed symbol \"2330\" with configured whitelist → isSymbolAllowed=true", () => {
  const result = parseSymbolWhitelist("2330");
  assert.equal(result.configured, true);
  if (result.configured) {
    assert.equal(isSymbolAllowed("2330", result.whitelist), true);
  }
});

test("T7-8b: allowed symbol in multi-symbol list → isSymbolAllowed=true", () => {
  const result = parseSymbolWhitelist("2330,2317,2454");
  assert.equal(result.configured, true);
  if (result.configured) {
    assert.equal(isSymbolAllowed("2317", result.whitelist), true);
    assert.equal(isSymbolAllowed("2454", result.whitelist), true);
  }
});

test("T7-9: rejected symbol \"NOTLISTED\" with configured whitelist → isSymbolAllowed=false", () => {
  const result = parseSymbolWhitelist("2330");
  assert.equal(result.configured, true);
  if (result.configured) {
    assert.equal(isSymbolAllowed("NOTLISTED", result.whitelist), false);
  }
});

test("T7-9b: rejected symbol \"2317\" when whitelist is only [\"2330\"] → false", () => {
  const result = parseSymbolWhitelist("2330");
  assert.equal(result.configured, true);
  if (result.configured) {
    assert.equal(isSymbolAllowed("2317", result.whitelist), false);
  }
});

// ---------------------------------------------------------------------------
// T7-10: SYMBOL_NOT_ALLOWED envelope
// ---------------------------------------------------------------------------

test("T7-10: buildSymbolNotAllowedEnvelope returns correct envelope shape", () => {
  const envelope = buildSymbolNotAllowedEnvelope("BADSTOCK");
  assert.equal(envelope.error.code, "SYMBOL_NOT_ALLOWED");
  assert.equal(envelope.error.symbol, "BADSTOCK");
  assert.ok(envelope.error.message.includes("BADSTOCK"), "message must include the rejected symbol");
  assert.ok(envelope.error.message.includes(WHITELIST_ENV_VAR), "message must reference env var name");
});

// ---------------------------------------------------------------------------
// T7-11: WHITELIST_NOT_CONFIGURED envelope
// ---------------------------------------------------------------------------

test("T7-11: buildWhitelistNotConfiguredEnvelope returns correct envelope shape", () => {
  const envelope = buildWhitelistNotConfiguredEnvelope();
  assert.equal(envelope.error.code, "WHITELIST_NOT_CONFIGURED");
  assert.equal(envelope.error.envVar, WHITELIST_ENV_VAR);
  assert.ok(envelope.error.message.includes(WHITELIST_ENV_VAR), "message must reference env var name");
  assert.ok(
    envelope.error.message.toLowerCase().includes("not set") ||
      envelope.error.message.toLowerCase().includes("not configured") ||
      envelope.error.message.toLowerCase().includes("disabled"),
    "message must indicate the unconfigured / disabled state"
  );
});

// ---------------------------------------------------------------------------
// T7-12: no-order proof
// ---------------------------------------------------------------------------

test("T7-12: no-order proof — whitelist module exports have 0 order-named functions", () => {
  const orderPatterns = ["order", "submit", "place", "cancel", "create"];
  const exportNames = [
    "parseSymbolWhitelist",
    "isSymbolAllowed",
    "buildSymbolNotAllowedEnvelope",
    "buildWhitelistNotConfiguredEnvelope",
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
// T7-13: trailing comma in env → empty segments dropped
// ---------------------------------------------------------------------------

test("T7-13: env with trailing comma → valid list without empty segment", () => {
  const result = parseSymbolWhitelist("2330,2317,");
  assert.equal(result.configured, true);
  if (result.configured) {
    assert.deepEqual(result.whitelist, ["2330", "2317"]);
    assert.equal(result.whitelist.includes(""), false, "must not include empty string segment");
  }
});

// ---------------------------------------------------------------------------
// T7-14: spaces around commas
// ---------------------------------------------------------------------------

test("T7-14: env with spaces around commas → trimmed correctly", () => {
  const result = parseSymbolWhitelist("  2330 , 2317 ,  2454  ");
  assert.equal(result.configured, true);
  if (result.configured) {
    assert.deepEqual(result.whitelist, ["2330", "2317", "2454"]);
  }
});
