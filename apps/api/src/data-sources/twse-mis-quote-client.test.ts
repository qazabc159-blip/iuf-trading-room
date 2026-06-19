import assert from "node:assert/strict";
import test from "node:test";

import { getTwseMisQuoteSnapshot } from "./twse-mis-quote-client.js";

test("retries a transient MIS failure before declaring the product quote unavailable", async () => {
  let calls = 0;
  const fetchMock = async () => {
    calls += 1;
    if (calls === 1) throw new Error("transient timeout");
    return new Response(JSON.stringify({
      rtcode: "0000",
      msgArray: [{
        z: "62.50",
        y: "62.00",
        v: "12345",
        d: "20260619",
        t: "09:07:00",
      }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  const result = await getTwseMisQuoteSnapshot("0050", fetchMock as typeof fetch);

  assert.equal(calls, 2);
  assert.equal(result?.source, "twse_mis");
  assert.equal(result?.lastPrice, 62.5);
});
