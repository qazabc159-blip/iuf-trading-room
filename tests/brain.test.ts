/**
 * brain.test.ts — Brain Phase A isolated tests (2026-05-17)
 * Run via: node --import ./tests/setup-test-env.mjs --import tsx --test tests/brain.test.ts
 *
 * Tests run in memory mode (PERSISTENCE_MODE defaults to memory).
 * OpenAI calls are mocked via global fetch override — no real API calls.
 *
 * Test coverage (Yang mandate: 5+ test cases, 0 BLOCKER):
 *   BRAIN-1: callLlm() success path (mocked OpenAI) — content + usage returned
 *   BRAIN-2: cost calculation correctness (token × rate = expected cost)
 *   BRAIN-3: budget enforcement — LLMBudgetExceeded thrown when over limit
 *   BRAIN-4: model fallback — unknown model uses gpt-4o-mini pricing
 *   BRAIN-5: admin endpoints schema — getLlmModels returns well-formed array
 *   BRAIN-6: quota exhaustion — callLlm returns null when quota exceeded
 */

import assert from "node:assert/strict";
import test, { after, before } from "node:test";

import {
  callLlm,
  estimateCostUsd,
  getDailyBudgetUsd,
  getTodayUtc,
  LLMBudgetExceeded,
  _resetLlmGatewayForTests,
  type LlmMessage,
} from "../apps/api/src/llm/llm-gateway.ts";

import { getLlmModels } from "../apps/api/src/admin-brain-llm.ts";

// ── Mock helpers ──────────────────────────────────────────────────────────────

interface MockOpenAiUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

function mockOpenAiFetch(content: string, usage?: MockOpenAiUsage): typeof fetch {
  return async (_url: string | URL | Request, _init?: RequestInit) => {
    const resp = {
      choices: [{ message: { content } }],
      usage: usage ?? { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 }
    };
    return new Response(JSON.stringify(resp), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  };
}

function mockOpenAiErrorFetch(status: number): typeof fetch {
  return async () => new Response("Unauthorized", { status });
}

// Save/restore global fetch
const _originalFetch = global.fetch;
let _fetchOverride: typeof fetch | null = null;

before(() => {
  // Override global fetch for all tests
  // @ts-expect-error — test harness fetch mock
  global.fetch = async (url: string | URL | Request, init?: RequestInit) => {
    if (_fetchOverride) return _fetchOverride(url, init);
    return _originalFetch(url, init);
  };
  // Set OPENAI_API_KEY so quota guard does not short-circuit
  process.env["OPENAI_API_KEY"] = "sk-test-fake-key-for-tests";
  // Set a generous budget for most tests
  process.env["LLM_DAILY_BUDGET_USD"] = "100";
  // Reset in-memory state
  _resetLlmGatewayForTests();
});

after(() => {
  global.fetch = _originalFetch;
  _fetchOverride = null;
  delete process.env["LLM_DAILY_BUDGET_USD"];
});

// ── BRAIN-1: Success path ──────────────────────────────────────────────────────

test("BRAIN-1: callLlm() success path returns content + usage", async () => {
  _resetLlmGatewayForTests();
  _fetchOverride = mockOpenAiFetch("Hello from mocked GPT!", {
    prompt_tokens: 80,
    completion_tokens: 20,
    total_tokens: 100
  });

  const messages: LlmMessage[] = [
    { role: "user", content: "Say hello" }
  ];
  const result = await callLlm(messages, {
    callerModule: "test_module",
    taskType: "test_greeting",
    modelKey: "gpt-4o-mini"
  });

  assert.ok(result !== null, "BRAIN-1: result must not be null");
  assert.equal(result.content, "Hello from mocked GPT!", "BRAIN-1: content must match mock");
  assert.equal(result.usage.promptTokens, 80, "BRAIN-1: promptTokens must be 80");
  assert.equal(result.usage.completionTokens, 20, "BRAIN-1: completionTokens must be 20");
  assert.equal(result.usage.totalTokens, 100, "BRAIN-1: totalTokens must be 100");
  assert.ok(result.costUsd >= 0, "BRAIN-1: costUsd must be >= 0");
});

// ── BRAIN-2: Cost calculation ──────────────────────────────────────────────────

test("BRAIN-2: estimateCostUsd calculates token × rate correctly", () => {
  // gpt-4o-mini: $0.15/1M input, $0.60/1M output
  const cost = estimateCostUsd("gpt-4o-mini", 1_000_000, 1_000_000);
  // Expected: (1M × 0.15 + 1M × 0.60) / 1M = 0.75
  assert.ok(Math.abs(cost - 0.75) < 0.0001, `BRAIN-2: gpt-4o-mini 1M+1M cost should be ~$0.75, got ${cost}`);

  // gpt-4o: $2.50/1M input, $10.00/1M output
  const costGpt4o = estimateCostUsd("gpt-4o", 100_000, 10_000);
  // Expected: (100k × 2.50 + 10k × 10.00) / 1M = 0.25 + 0.10 = 0.35
  assert.ok(Math.abs(costGpt4o - 0.35) < 0.0001, `BRAIN-2: gpt-4o cost should be ~$0.35, got ${costGpt4o}`);

  // 0 tokens = 0 cost
  const zeroCost = estimateCostUsd("gpt-4o-mini", 0, 0);
  assert.equal(zeroCost, 0, "BRAIN-2: 0 tokens must have 0 cost");

  // Unknown model falls back to gpt-4o-mini pricing
  const unknownCost = estimateCostUsd("unknown-model-xyz", 1_000_000, 0);
  const expectedFallback = estimateCostUsd("gpt-4o-mini", 1_000_000, 0);
  assert.ok(
    Math.abs(unknownCost - expectedFallback) < 0.0001,
    "BRAIN-2: unknown model must use gpt-4o-mini pricing as fallback"
  );
});

// ── BRAIN-3: Budget enforcement ────────────────────────────────────────────────

test("BRAIN-3: callLlm() throws LLMBudgetExceeded when daily budget exceeded", async () => {
  _resetLlmGatewayForTests();

  // Set budget to $0 (immediately exceeded)
  process.env["LLM_DAILY_BUDGET_USD"] = "0.0000001";

  // Accumulate cost by simulating a successful call that sets in-memory cost
  // Inject a fake cost via direct in-memory manipulation by calling with high-token mock
  _fetchOverride = mockOpenAiFetch("test", {
    prompt_tokens: 10_000_000,  // 10M tokens → $1.50 with gpt-4o-mini >> budget
    completion_tokens: 10_000_000,
    total_tokens: 20_000_000
  });

  // First call succeeds (budget check happens BEFORE cost accumulation)
  // but subsequent calls should fail
  // Actually: budget guard checks BEFORE the call, so we need to set cost state directly
  // Reset and set budget to something very small, then call once to accumulate cost
  _resetLlmGatewayForTests();
  process.env["LLM_DAILY_BUDGET_USD"] = "0.000001"; // $0.000001 tiny budget

  _fetchOverride = mockOpenAiFetch("first call", {
    prompt_tokens: 1000, completion_tokens: 1000, total_tokens: 2000
  });

  // First call: budget check passes ($0 < $0.000001), cost accumulated after
  const first = await callLlm([{ role: "user", content: "test" }], {
    callerModule: "test_budget", taskType: "test", modelKey: "gpt-4o-mini"
  });
  // first may succeed or fail depending on in-memory state
  // After this call, in-memory cost is > $0.000001

  // Second call: should throw LLMBudgetExceeded (in-memory cost now > budget)
  await assert.rejects(
    () => callLlm([{ role: "user", content: "test2" }], {
      callerModule: "test_budget2", taskType: "test", modelKey: "gpt-4o-mini"
    }),
    (err: unknown) => {
      assert.ok(err instanceof LLMBudgetExceeded, "BRAIN-3: error must be LLMBudgetExceeded");
      assert.ok(err.todayCost > 0, "BRAIN-3: todayCost must be > 0");
      assert.ok(err.budget > 0, "BRAIN-3: budget must be > 0");
      return true;
    },
    "BRAIN-3: must throw LLMBudgetExceeded when budget exceeded"
  );

  // Restore budget for subsequent tests
  process.env["LLM_DAILY_BUDGET_USD"] = "100";
  _resetLlmGatewayForTests();
});

// ── BRAIN-4: Model fallback pricing ───────────────────────────────────────────

test("BRAIN-4: unknown model falls back to gpt-4o-mini pricing", () => {
  const unknownCost = estimateCostUsd("completely-unknown-model", 500_000, 250_000);
  const fallbackCost = estimateCostUsd("gpt-4o-mini", 500_000, 250_000);

  assert.ok(
    Math.abs(unknownCost - fallbackCost) < 0.000001,
    `BRAIN-4: unknown model pricing must equal gpt-4o-mini. unknown=${unknownCost}, fallback=${fallbackCost}`
  );
});

// ── BRAIN-5: Admin endpoints schema ───────────────────────────────────────────

test("BRAIN-5: getLlmModels() returns well-formed model entries (memory mode)", async () => {
  // Memory mode (no DB) returns the hardcoded fallback
  const models = await getLlmModels();

  assert.ok(Array.isArray(models), "BRAIN-5: getLlmModels must return array");
  assert.ok(models.length > 0, "BRAIN-5: must have at least 1 model");

  const first = models[0];
  assert.ok(typeof first?.modelKey === "string" && first.modelKey.length > 0,
    "BRAIN-5: modelKey must be a non-empty string");
  assert.ok(typeof first?.provider === "string" && first.provider.length > 0,
    "BRAIN-5: provider must be a non-empty string");
  assert.ok(typeof first?.displayName === "string",
    "BRAIN-5: displayName must be a string");
  assert.ok(
    first?.provider === "openai" || first?.provider === "anthropic" || first?.provider === "local",
    "BRAIN-5: provider must be one of openai|anthropic|local"
  );
  assert.ok(
    typeof first?.inputPricePer1mTokens === "string" || typeof first?.inputPricePer1mTokens === "number",
    "BRAIN-5: inputPricePer1mTokens must be a string or number"
  );
});

// ── BRAIN-6: Quota exhaustion ─────────────────────────────────────────────────

test("BRAIN-6: callLlm() returns null when OPENAI_API_KEY is absent", async () => {
  _resetLlmGatewayForTests();
  const savedKey = process.env["OPENAI_API_KEY"];
  delete process.env["OPENAI_API_KEY"];

  _fetchOverride = mockOpenAiFetch("should not reach here");

  const result = await callLlm(
    [{ role: "user", content: "test" }],
    { callerModule: "test_no_key", taskType: "test", modelKey: "gpt-4o-mini" }
  );

  assert.equal(result, null, "BRAIN-6: must return null when API key absent");

  // Restore
  process.env["OPENAI_API_KEY"] = savedKey;
  _resetLlmGatewayForTests();
});

// ── BRAIN-7: LLMBudgetExceeded structure ──────────────────────────────────────

test("BRAIN-7: LLMBudgetExceeded has correct todayCost and budget fields", () => {
  const err = new LLMBudgetExceeded(3.5, 2.0);
  assert.equal(err.name, "LLMBudgetExceeded", "BRAIN-7: name must be LLMBudgetExceeded");
  assert.equal(err.todayCost, 3.5, "BRAIN-7: todayCost must be 3.5");
  assert.equal(err.budget, 2.0, "BRAIN-7: budget must be 2.0");
  assert.ok(err.message.includes("3.5000"), "BRAIN-7: message must contain todayCost");
  assert.ok(err.message.includes("2.0000"), "BRAIN-7: message must contain budget");
  assert.ok(err instanceof Error, "BRAIN-7: must be instanceof Error");
});
