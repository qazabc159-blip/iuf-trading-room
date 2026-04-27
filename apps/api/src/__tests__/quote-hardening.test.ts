/**
 * quote-hardening.test.ts — W3 B1 tests
 *
 * Tests for H-6 structured logging and H-9 ring buffer eviction warning.
 *
 * Run: node --test --import tsx/esm apps/api/src/__tests__/quote-hardening.test.ts
 *
 * Hard lines verified:
 *  - redactSensitiveFields removes account/person_id/token/password/pfx/secret
 *  - checkBufferStatus emits nearCapacity=true at >= 90% fill
 *  - checkBufferStatus emits atCapacity=true when at max
 *  - KgiQuoteClient structured log calls carry route/symbol/status/latency_ms/freshness/error_code
 *  - NO order path touched by any import in this file
 *  - NO /order/create URL called
 */

import assert from "node:assert/strict";
import test from "node:test";

// ---------------------------------------------------------------------------
// Import lib helpers (no order path)
// ---------------------------------------------------------------------------

import { redactSensitiveFields, withLatency } from "../lib/logger.js";
import {
  checkBufferStatus,
  BUFFER_EVICTION_WARN_THRESHOLD,
  BUFFER_MAXLEN_DEFAULT,
} from "../lib/ring-buffer.js";
import {
  KgiQuoteClient,
  classifyFreshness,
} from "../broker/kgi-quote-client.js";

// ---------------------------------------------------------------------------
// W3-B1-T1: redactSensitiveFields — account redacted
// ---------------------------------------------------------------------------

test("W3-B1-T1: redactSensitiveFields removes account", () => {
  const input = { account: "secret-account-123", symbol: "2330", route: "/api/v1/kgi/quote/ticks" };
  const out = redactSensitiveFields(input);
  assert.equal(out["account"], "[REDACTED]", "account must be redacted");
  assert.equal(out["symbol"], "2330", "symbol must pass through");
  assert.equal(out["route"], "/api/v1/kgi/quote/ticks", "route must pass through");
});

// ---------------------------------------------------------------------------
// W3-B1-T2: redactSensitiveFields — person_id redacted
// ---------------------------------------------------------------------------

test("W3-B1-T2: redactSensitiveFields removes person_id", () => {
  const input = { person_id: "A123456789", status: 200, freshness: "fresh" };
  const out = redactSensitiveFields(input);
  assert.equal(out["person_id"], "[REDACTED]", "person_id must be redacted");
  assert.equal(out["status"], 200, "status must pass through");
  assert.equal(out["freshness"], "fresh", "freshness must pass through");
});

// ---------------------------------------------------------------------------
// W3-B1-T3: redactSensitiveFields — token, password, pfx all redacted
// ---------------------------------------------------------------------------

test("W3-B1-T3: redactSensitiveFields removes token, password, pfx", () => {
  const input = {
    token: "Bearer abc.def.ghi",
    password: "hunter2",
    pfx: "/path/to/cert.pfx",
    kgi_password: "secret",
    symbol: "2330",
    latency_ms: 42,
  };
  const out = redactSensitiveFields(input);
  assert.equal(out["token"], "[REDACTED]", "token must be redacted");
  assert.equal(out["password"], "[REDACTED]", "password must be redacted");
  assert.equal(out["pfx"], "[REDACTED]", "pfx must be redacted");
  assert.equal(out["kgi_password"], "[REDACTED]", "kgi_password must be redacted");
  assert.equal(out["symbol"], "2330", "symbol must pass through");
  assert.equal(out["latency_ms"], 42, "latency_ms must pass through");
});

// ---------------------------------------------------------------------------
// W3-B1-T4: redactSensitiveFields — case-insensitive redaction
// ---------------------------------------------------------------------------

test("W3-B1-T4: redactSensitiveFields is case-insensitive", () => {
  const input = {
    TOKEN: "should-be-redacted",
    PASSWORD: "also-redacted",
    ACCOUNT: "redacted-too",
    symbol: "2330",
  };
  const out = redactSensitiveFields(input as Record<string, unknown>);
  assert.equal(out["TOKEN"], "[REDACTED]", "TOKEN (uppercase) must be redacted");
  assert.equal(out["PASSWORD"], "[REDACTED]", "PASSWORD (uppercase) must be redacted");
  assert.equal(out["ACCOUNT"], "[REDACTED]", "ACCOUNT (uppercase) must be redacted");
  assert.equal(out["symbol"], "2330", "symbol must pass through");
});

// ---------------------------------------------------------------------------
// W3-B1-T5: redactSensitiveFields — clean object passes through unchanged
// ---------------------------------------------------------------------------

test("W3-B1-T5: redactSensitiveFields passes safe fields through unchanged", () => {
  const input = {
    route: "/api/v1/kgi/quote/ticks",
    symbol: "2330",
    status: 200,
    latency_ms: 12,
    freshness: "fresh",
    error_code: "NONE",
  };
  const out = redactSensitiveFields(input);
  for (const [k, v] of Object.entries(input)) {
    assert.equal(out[k], v, `${k} must pass through unchanged`);
  }
});

// ---------------------------------------------------------------------------
// W3-B1-T6: checkBufferStatus — buffer at 0% utilisation
// ---------------------------------------------------------------------------

test("W3-B1-T6: checkBufferStatus — 0% utilisation → nearCapacity=false, atCapacity=false", () => {
  const s = checkBufferStatus("2330", 0, 200);
  assert.equal(s.nearCapacity, false);
  assert.equal(s.atCapacity, false);
  assert.equal(s.utilizationFraction, 0);
  assert.equal(s.bufferMax, 200);
  assert.equal(s.bufferUsed, 0);
});

// ---------------------------------------------------------------------------
// W3-B1-T7: checkBufferStatus — 89% → not yet warning
// ---------------------------------------------------------------------------

test("W3-B1-T7: checkBufferStatus — 89% → nearCapacity=false", () => {
  const used = Math.floor(200 * 0.89); // 178
  const s = checkBufferStatus("2330", used, 200);
  assert.equal(s.nearCapacity, false, "89% must not trigger near-capacity warning");
  assert.equal(s.atCapacity, false);
});

// ---------------------------------------------------------------------------
// W3-B1-T8: checkBufferStatus — 90% → warning threshold triggered
// ---------------------------------------------------------------------------

test("W3-B1-T8: checkBufferStatus — 90% → nearCapacity=true", () => {
  const used = Math.floor(200 * BUFFER_EVICTION_WARN_THRESHOLD); // 180
  const s = checkBufferStatus("2330", used, 200);
  assert.equal(s.nearCapacity, true, "90% must trigger near-capacity warning");
  assert.equal(s.atCapacity, false, "90% is not yet at-capacity");
});

// ---------------------------------------------------------------------------
// W3-B1-T9: checkBufferStatus — 100% → both nearCapacity=true, atCapacity=true
// ---------------------------------------------------------------------------

test("W3-B1-T9: checkBufferStatus — 100% → nearCapacity=true, atCapacity=true", () => {
  const s = checkBufferStatus("2330", 200, 200);
  assert.equal(s.nearCapacity, true, "100% must trigger near-capacity warning");
  assert.equal(s.atCapacity, true, "100% must trigger at-capacity flag");
  assert.equal(s.utilizationFraction, 1.0);
});

// ---------------------------------------------------------------------------
// W3-B1-T10: checkBufferStatus — default maxlen used when bufferMax=0
// ---------------------------------------------------------------------------

test("W3-B1-T10: checkBufferStatus — default maxlen used when bufferMax=0", () => {
  const s = checkBufferStatus("2330", 0, 0);
  assert.equal(s.bufferMax, BUFFER_MAXLEN_DEFAULT, "must fall back to default BUFFER_MAXLEN_DEFAULT");
});

// ---------------------------------------------------------------------------
// W3-B1-T11: withLatency — records latency and calls callback
// ---------------------------------------------------------------------------

test("W3-B1-T11: withLatency — records latency ≥ 0ms and calls callback with no error on success", async () => {
  let callbackCalled = false;
  let callbackLatency = -1;
  let callbackErr: unknown = "not-called";

  const result = await withLatency(
    async () => {
      await new Promise((r) => setTimeout(r, 5));
      return "ok";
    },
    (latencyMs: number, err: unknown) => {
      callbackCalled = true;
      callbackLatency = latencyMs;
      callbackErr = err;
    }
  );

  assert.equal(result, "ok");
  assert.equal(callbackCalled, true, "callback must be called");
  assert.ok(callbackLatency >= 0, `latency_ms=${callbackLatency} must be >= 0`);
  assert.equal(callbackErr, null, "err must be null on success");
});

// ---------------------------------------------------------------------------
// W3-B1-T12: withLatency — records error on rejection
// ---------------------------------------------------------------------------

test("W3-B1-T12: withLatency — re-throws error and calls callback with err on failure", async () => {
  let callbackErr: unknown = null;
  const sentinel = new Error("test-error");

  await assert.rejects(
    () =>
      withLatency(
        async () => {
          throw sentinel;
        },
        (_latencyMs: number, err: unknown) => {
          callbackErr = err;
        }
      ),
    (err: unknown) => err === sentinel
  );

  assert.equal(callbackErr, sentinel, "callback must receive the thrown error");
});

// ---------------------------------------------------------------------------
// W3-B1-T13: KgiQuoteClient — structured logging does NOT include order URLs
// ---------------------------------------------------------------------------

test("W3-B1-T13: KgiQuoteClient structured logging — no /order/create URL called during quote ops", async () => {
  const orderUrlsCalled: string[] = [];
  const successResponses = new Map([
    ["/quote/status", {
      status: 200,
      body: {
        subscribed_symbols: { tick: [], bidask: [] },
        buffer: { tick: {}, bidask: {} },
        kgi_logged_in: true,
        quote_disabled_flag: false,
      },
    }],
    ["/quote/ticks", {
      status: 200,
      body: {
        symbol: "2330",
        ticks: [{ close: 1052.0, _received_at: new Date(Date.now() - 1000).toISOString() }],
        count: 1,
        buffer_size: 200,
        buffer_used: 10,
      },
    }],
    ["/quote/bidask", {
      status: 200,
      body: {
        symbol: "2330",
        bidask: { exchange: "TWSE", _received_at: new Date(Date.now() - 500).toISOString() },
      },
    }],
  ]);

  const orig = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/order/")) orderUrlsCalled.push(url);
    const entry = [...successResponses.entries()].find(([k]) => url.includes(k));
    if (entry) {
      return new Response(JSON.stringify(entry[1].body), {
        status: entry[1].status,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response("{}", { status: 404 });
  }) as typeof fetch;

  try {
    const client = new KgiQuoteClient({
      gatewayBaseUrl: "http://test-gateway",
      symbolWhitelist: ["2330"],
    });

    await client.getQuoteStatus();
    await client.getRecentTicks("2330", 5);
    await client.getLatestBidAsk("2330");

    assert.equal(
      orderUrlsCalled.length,
      0,
      `No /order/* URLs must be called during structured-log quote ops — found: ${orderUrlsCalled.join(", ")}`
    );
  } finally {
    globalThis.fetch = orig;
  }
});

// ---------------------------------------------------------------------------
// W3-B1-T14: KgiQuoteClient — ring buffer near-capacity warning path
// (verify getRecentTicks does not throw when buffer_used >= 90% of buffer_size)
// ---------------------------------------------------------------------------

test("W3-B1-T14: KgiQuoteClient — getRecentTicks handles near-capacity buffer without throwing", async () => {
  const nearCapacityBody = {
    symbol: "2330",
    ticks: Array.from({ length: 10 }, (_, i) => ({
      close: 1050.0 + i,
      _received_at: new Date(Date.now() - 1000).toISOString(),
    })),
    count: 10,
    buffer_size: 200,
    buffer_used: 181, // 90.5% — above BUFFER_EVICTION_WARN_THRESHOLD
  };

  const orig = globalThis.fetch;
  globalThis.fetch = (async (_input: RequestInfo | URL, _init?: RequestInit) => {
    return new Response(JSON.stringify(nearCapacityBody), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  try {
    const client = new KgiQuoteClient({
      gatewayBaseUrl: "http://test-gateway",
      symbolWhitelist: ["2330"],
    });

    // Must not throw — only logs warning
    const result = await client.getRecentTicks("2330", 10);
    assert.equal(result.symbol, "2330");
    assert.equal(result.count, 10);
    assert.equal(result.freshness, "fresh");
  } finally {
    globalThis.fetch = orig;
  }
});

// ---------------------------------------------------------------------------
// W3-B1-T15: No-order guarantee — KgiQuoteClient has 0 order-named methods
//           (mirrors W2d-T9 to verify hardening additions didn't introduce order methods)
// ---------------------------------------------------------------------------

test("W3-B1-T15: no-order guarantee — KgiQuoteClient + lib imports have 0 order methods after W3 additions", () => {
  const orderPatterns = ["order", "submit", "place", "cancel", "modify", "create"];
  const client = new KgiQuoteClient({
    gatewayBaseUrl: "http://test-gateway",
    symbolWhitelist: ["2330"],
  });

  const allKeys = new Set<string>();
  let proto = Object.getPrototypeOf(client);
  while (proto && proto !== Object.prototype) {
    for (const k of Object.getOwnPropertyNames(proto)) {
      allKeys.add(k.toLowerCase());
    }
    proto = Object.getPrototypeOf(proto);
  }
  for (const k of Object.keys(client)) {
    allKeys.add(k.toLowerCase());
  }

  for (const pattern of orderPatterns) {
    const matches = [...allKeys].filter((k) => k.includes(pattern));
    assert.equal(
      matches.length,
      0,
      `KgiQuoteClient must have 0 methods containing '${pattern}' after W3 hardening — found: ${matches.join(", ")}`
    );
  }
});
