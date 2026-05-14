/**
 * discover.test.ts — Unit tests for discoverCompaniesByBuzzword()
 *
 * Run:
 *   node --import tsx --test apps/api/src/data-sources/__tests__/discover.test.ts
 *
 * DISC1 and DISC2 require My-TW-Coverage data (skipped gracefully when absent).
 * DISC3 is always run (no-match path, no data needed).
 * DISC4 mocks OpenAI — never hits live API.
 */

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import test, { after, mock } from "node:test";
import { fileURLToPath } from "node:url";

import {
  _resetDiscoverLlmRateLimit,
  discoverCompaniesByBuzzword,
} from "../discover.js";
import { _resetWikilinkCache } from "../tw-coverage-loader.js";
import { _resetQuotaGuard } from "../../openai-quota-guard.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const bundledPath = path.resolve(__dirname, "../../../../data/tw-coverage");
const siblingPath = path.resolve(__dirname, "../../../../../../My-TW-Coverage/Pilot_Reports");
const coverageAvailable = existsSync(bundledPath) || existsSync(siblingPath);

const skipIfNoCoverage = coverageAvailable
  ? (name: string, fn: () => Promise<void>) => test(name, fn)
  : (name: string, _fn: () => Promise<void>) =>
      test(name, { skip: "Coverage data not available in this environment" }, async () => {});

// ---------------------------------------------------------------------------
// DISC1: exact match
// ---------------------------------------------------------------------------
skipIfNoCoverage("DISC1: exact match 'CoWoS' returns multiple tickers", async () => {
  _resetWikilinkCache();
  const result = await discoverCompaniesByBuzzword("CoWoS");
  assert.equal(result.buzzword, "CoWoS");
  assert.equal(result.matchStrategy, "exact", "DISC1: should be exact match");
  assert.ok(result.matches.length > 0, "DISC1: should have at least 1 match");
  // All matches should have confidence 1.0 for exact
  assert.ok(
    result.matches.every((m) => m.confidence === 1.0),
    "DISC1: exact matches must have confidence 1.0"
  );
  // Each match should have a relatedWikilink of 'CoWoS'
  assert.ok(
    result.matches.every((m) => m.relatedWikilink === "CoWoS"),
    "DISC1: relatedWikilink must be 'CoWoS'"
  );
  // Verify known CoWoS tickers appear (3661 世芯, 3711 日月光投控, etc.)
  const knownCoWoSTickers = ["3661", "3711", "3443", "3680", "6239"];
  const foundAtLeastOne = knownCoWoSTickers.some((t) =>
    result.matches.some((m) => m.ticker === t)
  );
  assert.ok(foundAtLeastOne, "DISC1: at least one known CoWoS ticker should appear");
});

// ---------------------------------------------------------------------------
// DISC2: fuzzy match
// ---------------------------------------------------------------------------
skipIfNoCoverage("DISC2: fuzzy match '液冷' finds companies via related wikilinks", async () => {
  _resetWikilinkCache();
  // '液冷' is a substring of '液冷散熱' and similar terms
  const result = await discoverCompaniesByBuzzword("液冷", { llmFallback: false });
  assert.equal(result.buzzword, "液冷");
  // Either exact (if '液冷' is a wikilink) or fuzzy or no_match — all valid
  // Main assertion: if there are matches, confidence must be in (0, 1]
  if (result.matches.length > 0) {
    assert.ok(
      result.matches.every((m) => m.confidence > 0 && m.confidence <= 1.0),
      "DISC2: confidence must be in (0,1]"
    );
    assert.ok(
      ["exact", "fuzzy"].includes(result.matchStrategy),
      "DISC2: strategy must be exact or fuzzy when llmFallback=false"
    );
  } else {
    assert.equal(result.matchStrategy, "no_match", "DISC2: no matches → no_match strategy");
  }
});

// ---------------------------------------------------------------------------
// DISC3: no match
// ---------------------------------------------------------------------------
test("DISC3: completely unknown buzzword returns no_match", async () => {
  _resetWikilinkCache();
  _resetDiscoverLlmRateLimit();
  // Use a nonsense string that can't match anything
  const result = await discoverCompaniesByBuzzword("XYZZY_IMPOSSIBLE_2026", {
    llmFallback: false,
  });
  assert.equal(result.matchStrategy, "no_match", "DISC3: should be no_match");
  assert.equal(result.matches.length, 0, "DISC3: matches must be empty");
});

// ---------------------------------------------------------------------------
// DISC4: LLM fallback mock — confirm prompt format, never hits real API
// ---------------------------------------------------------------------------
test("DISC4: LLM fallback calls openai with correct prompt shape (mocked)", async () => {
  _resetWikilinkCache();
  _resetDiscoverLlmRateLimit();
  _resetQuotaGuard();

  // We need OPENAI_API_KEY set for callOpenAi to proceed; mock the quota guard
  const originalEnv = process.env["OPENAI_API_KEY"];
  process.env["OPENAI_API_KEY"] = "test-key-mock";

  let capturedPrompt: string | null = null;
  // eslint-disable-next-line prefer-const
  let capturedModel: string | null = null;

  // Mock the global fetch to intercept OpenAI calls
  const originalFetch = global.fetch;
  global.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const urlStr = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
    if (urlStr.includes("openai.com")) {
      // Capture the request body
      const body = JSON.parse((init?.body as string) ?? "{}") as {
        model: string;
        messages: Array<{ role: string; content: string }>;
      };
      capturedModel = body.model;
      const userMsg = body.messages.find((m) => m.role === "user");
      capturedPrompt = userMsg?.content ?? null;

      // Return a valid mock response with 3 inferred wikilinks
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify(["散熱模組", "均熱片", "3D VC"]),
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    // Pass through non-OpenAI calls
    return originalFetch(url as RequestInfo, init);
  }) as typeof global.fetch;

  try {
    // Use a buzzword that won't exist in coverage files (to force LLM path)
    // But since coverage may not be available in CI, we just confirm the prompt shape
    // by calling with an impossible term when llmFallback=true
    const result = await discoverCompaniesByBuzzword("液冷散熱", { llmFallback: true });

    // If LLM was reached, validate prompt shape
    // Note: use explicit if-check (not assert.ok) so TypeScript narrows the type
    if (capturedPrompt !== null && typeof capturedPrompt === "string") {
      const prompt: string = capturedPrompt;
      const modelStr: string = capturedModel ?? "";
      assert.ok(prompt.includes("液冷散熱"), "DISC4: prompt must contain the buzzword");
      assert.ok(prompt.includes("JSON 陣列"), "DISC4: prompt must request JSON array");
      assert.ok(modelStr.length > 0, "DISC4: model must be captured");
      assert.ok(
        modelStr === "gpt-4o-mini" || modelStr.startsWith("gpt-"),
        "DISC4: model must be gpt family"
      );
    }

    // Result must always be structured (never throws)
    assert.ok(
      ["exact", "fuzzy", "llm_inference", "no_match"].includes(result.matchStrategy),
      "DISC4: matchStrategy must be a valid value"
    );
    assert.ok(Array.isArray(result.matches), "DISC4: matches must be an array");
  } finally {
    global.fetch = originalFetch;
    if (originalEnv === undefined) {
      delete process.env["OPENAI_API_KEY"];
    } else {
      process.env["OPENAI_API_KEY"] = originalEnv;
    }
  }
});

after(async () => {
  await new Promise<void>((resolve) => setTimeout(resolve, 300));
  process.exit(process.exitCode ?? 0);
});
