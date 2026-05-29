import assert from "node:assert/strict";
import test from "node:test";

import { _resetLlmGatewayForTests, callLlm } from "../llm/llm-gateway.js";

test("callLlm sends JSON response_format when requested", async () => {
  _resetLlmGatewayForTests();

  const savedKey = process.env["OPENAI_API_KEY"];
  const savedLimit = process.env["OPENAI_DAILY_LIMIT"];
  const originalFetch = globalThis.fetch;
  process.env["OPENAI_API_KEY"] = "test-key";
  process.env["OPENAI_DAILY_LIMIT"] = "1000";

  let requestBody: Record<string, unknown> | null = null;
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    requestBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    return new Response(JSON.stringify({
      choices: [{ message: { content: "{\"selected\":[]}" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }) as typeof fetch;

  try {
    const result = await callLlm(
      [
        { role: "system", content: "Return JSON only." },
        { role: "user", content: "Return a JSON object." }
      ],
      {
        callerModule: "test_json_mode",
        taskType: "unit",
        responseFormat: "json_object"
      }
    );

    assert.equal(result?.content, "{\"selected\":[]}");
    assert.deepEqual(requestBody?.["response_format"], { type: "json_object" });
  } finally {
    globalThis.fetch = originalFetch;
    if (savedKey === undefined) delete process.env["OPENAI_API_KEY"];
    else process.env["OPENAI_API_KEY"] = savedKey;
    if (savedLimit === undefined) delete process.env["OPENAI_DAILY_LIMIT"];
    else process.env["OPENAI_DAILY_LIMIT"] = savedLimit;
    _resetLlmGatewayForTests();
  }
});
