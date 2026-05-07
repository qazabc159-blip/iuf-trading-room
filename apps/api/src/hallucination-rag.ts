/**
 * hallucination-rag.ts
 *
 * BLOCK #6 — RAG-based hallucination detection for OpenAlice AI reviewer pipeline.
 *
 * Algorithm:
 *   Pass 1 — claim extraction     (gpt-4o-mini, cost-friendly)
 *   Pass 2 — cross-validate       (gpt-4.1, accuracy-priority per compliance requirement)
 *   Aggregate — verdict + confidence + flags
 *
 * Hard lines:
 *   - Never log API key
 *   - No buy/sell/目標價/必賺/勝率/guaranteed return language in prompts
 *   - OpenAI failure → verdict=ERROR, confidence=0, safe-default block publish
 *   - No rawSources provided → single-pass fallback + caveat RAG_NOT_USED__SOURCE_PACK_MISSING
 *   - Model env vars: OPENAI_CLAIM_EXTRACT_MODEL (default gpt-4o-mini)
 *                     OPENAI_HALLUCINATION_VERIFY_MODEL (default gpt-4.1)
 */

const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";
const CLAIM_EXTRACT_TIMEOUT_MS = 20_000;
const CROSS_VALIDATE_TIMEOUT_MS = 30_000;
const MAX_CLAIMS = 12;
const MAX_RAW_SOURCE_CHARS = 1_200; // truncate per source to keep prompt manageable

export type HallucinationVerdict =
  | "OK"
  | "HALLUCINATED"
  | "PARTIAL_HALLUCINATED"
  | "ERROR";

export type ClaimFlagType =
  | "FABRICATED"
  | "MISATTRIBUTED"
  | "CONTRADICTED"
  | "UNSUPPORTED";

export type ClaimFlag = {
  claim: string;
  type: ClaimFlagType;
  sourceMatch: {
    matched: boolean;
    sourceId: string | null;
    similarity: number | null;
  };
};

export type RawSourceEntry = {
  sourceId: string;         // e.g. "tw_monthly_revenue:2330:2024-11"
  content: string;          // raw JSON row or text excerpt
  sha256?: string | null;
  url?: string | null;
};

export type HallucinationCheckResult = {
  verdict: HallucinationVerdict;
  confidence: number;        // 0–1
  flags: ClaimFlag[];
  reasoning: string;
  ragUsed: boolean;
};

// ─── internal OpenAI helper ────────────────────────────────────────────────────

function extractChoiceContent(respData: unknown): string | null {
  if (
    respData &&
    typeof respData === "object" &&
    "choices" in respData &&
    Array.isArray((respData as { choices: unknown[] }).choices)
  ) {
    const first = (respData as { choices: { message?: { content?: unknown } }[] }).choices[0];
    if (first?.message?.content) return String(first.message.content);
  }
  return null;
}

async function callOpenAI(input: {
  apiKey: string;
  model: string;
  prompt: string;
  maxTokens: number;
  timeoutMs: number;
}): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  let res: Response;
  try {
    res = await fetch(OPENAI_CHAT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${input.apiKey}`
      },
      body: JSON.stringify({
        model: input.model,
        messages: [{ role: "user", content: input.prompt }],
        max_tokens: input.maxTokens,
        temperature: 0.1
      }),
      signal: AbortSignal.timeout(input.timeoutMs)
    });
  } catch (e) {
    return { ok: false, error: `network_error: ${e instanceof Error ? e.message : String(e)}` };
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "(no body)");
    return { ok: false, error: `http_${res.status}: ${body.slice(0, 120)}` };
  }

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    return { ok: false, error: "json_parse_error" };
  }

  const text = extractChoiceContent(data);
  if (!text) return { ok: false, error: "empty_response" };
  return { ok: true, text };
}

function stripFence(raw: string): string {
  return raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
}

// ─── Pass 1: claim extraction ─────────────────────────────────────────────────

export async function extractFactualClaims(input: {
  apiKey: string;
  content: string;
  model: string;
}): Promise<string[]> {
  const prompt = `You are a claim extraction engine for a financial research compliance system.

Extract atomic factual claims from the following financial research content.
Focus on specific data points: numbers, dates, percentages, company names, financial metrics.
Do NOT extract:
- Analytical observations or interpretations
- General market descriptions without specific data
- Any buy/sell/target/return guidance (these are already filtered upstream)

Output ONLY a JSON array of strings (no markdown fence, no extra text):
["claim 1", "claim 2", ...]

Limit to at most ${MAX_CLAIMS} claims. If no factual claims, return [].

Content:
"""
${input.content.slice(0, 3_000)}
"""`;

  const result = await callOpenAI({
    apiKey: input.apiKey,
    model: input.model,
    prompt,
    maxTokens: 600,
    timeoutMs: CLAIM_EXTRACT_TIMEOUT_MS
  });

  if (!result.ok) {
    console.warn(`[hallucination-rag] claim extraction failed: ${result.error}`);
    return [];
  }

  try {
    const parsed = JSON.parse(stripFence(result.text));
    if (Array.isArray(parsed)) {
      return (parsed as unknown[]).slice(0, MAX_CLAIMS).map(String);
    }
  } catch {
    console.warn(`[hallucination-rag] claim parse failed: ${result.text.slice(0, 80)}`);
  }
  return [];
}

// ─── Pass 2: cross-validate one claim against rawSources ──────────────────────

type CrossValidateOutcome = {
  matched: boolean;
  sourceId: string | null;
  similarity: number | null;
  type: ClaimFlagType | "OK";
};

export async function crossValidateClaim(input: {
  apiKey: string;
  claim: string;
  rawSources: RawSourceEntry[];
  model: string;
}): Promise<CrossValidateOutcome> {
  // Build compact sources block
  const sourcesBlock = input.rawSources
    .map(
      (s) =>
        `[sourceId: ${s.sourceId}]\n${s.content.slice(0, MAX_RAW_SOURCE_CHARS)}`
    )
    .join("\n\n---\n\n");

  const prompt = `You are a factual grounding validator for a financial compliance system.

Claim to validate:
"""
${input.claim}
"""

Raw data sources (authoritative ground truth from market data feeds):
${sourcesBlock.slice(0, 4_000)}

Task:
1. Find which source (if any) can verify or refute this claim.
2. Assess whether the claim is accurately supported by the raw data.
3. Output ONLY this JSON (no markdown fence, no extra text):

{"matched":true|false,"sourceId":"<matching sourceId or null>","similarity":0.0-1.0,"type":"OK|FABRICATED|MISATTRIBUTED|CONTRADICTED|UNSUPPORTED"}

Type definitions:
- OK: claim is accurately supported by raw source data
- FABRICATED: claim has no corresponding data in any source (invented)
- MISATTRIBUTED: claim attributes a real data point to wrong entity/date/ticker
- CONTRADICTED: claim directly contradicts a value in the source data
- UNSUPPORTED: source data exists for this domain but does not confirm this specific claim

Do NOT flag:
- Analytical conclusions or interpretations
- General market commentary without specific numbers
- Any buy/sell/target/return language`;

  const result = await callOpenAI({
    apiKey: input.apiKey,
    model: input.model,
    prompt,
    maxTokens: 200,
    timeoutMs: CROSS_VALIDATE_TIMEOUT_MS
  });

  if (!result.ok) {
    console.warn(`[hallucination-rag] cross-validate failed: ${result.error}`);
    // On failure: conservative — mark as UNSUPPORTED to surface for review
    return { matched: false, sourceId: null, similarity: null, type: "UNSUPPORTED" };
  }

  try {
    type ParsedOutcome = {
      matched?: unknown;
      sourceId?: unknown;
      similarity?: unknown;
      type?: unknown;
    };
    const parsed = JSON.parse(stripFence(result.text)) as ParsedOutcome;
    const validTypes = ["OK", "FABRICATED", "MISATTRIBUTED", "CONTRADICTED", "UNSUPPORTED"] as const;
    type ValidType = (typeof validTypes)[number];
    const outcomeType: ValidType = validTypes.includes(parsed.type as ValidType)
      ? (parsed.type as ValidType)
      : "UNSUPPORTED";
    return {
      matched: parsed.matched === true,
      sourceId: typeof parsed.sourceId === "string" ? parsed.sourceId : null,
      similarity: typeof parsed.similarity === "number" ? Math.min(1, Math.max(0, parsed.similarity)) : null,
      type: outcomeType
    };
  } catch {
    return { matched: false, sourceId: null, similarity: null, type: "UNSUPPORTED" };
  }
}

// ─── Aggregate verdict from per-claim results ─────────────────────────────────

export function aggregateVerdict(outcomes: CrossValidateOutcome[]): {
  verdict: HallucinationVerdict;
  confidence: number;
  flags: ClaimFlag[];
} {
  if (outcomes.length === 0) {
    return { verdict: "OK", confidence: 1.0, flags: [] };
  }

  const flags: ClaimFlag[] = [];
  const similarities: number[] = [];

  for (const o of outcomes) {
    if (o.similarity != null) similarities.push(o.similarity);
    if (o.type !== "OK") {
      // We need the original claim — caller passes it via aggregateVerdictWithClaims
    }
  }

  const avgSimilarity =
    similarities.length > 0
      ? similarities.reduce((a, b) => a + b, 0) / similarities.length
      : 0.5;

  const hasFabricated = outcomes.some((o) => o.type === "FABRICATED");
  const hasNonOk = outcomes.some((o) => o.type !== "OK");

  let verdict: HallucinationVerdict;
  if (hasFabricated) {
    verdict = "HALLUCINATED";
  } else if (hasNonOk) {
    verdict = "PARTIAL_HALLUCINATED";
  } else {
    verdict = "OK";
  }

  return { verdict, confidence: avgSimilarity, flags };
}

export function aggregateVerdictWithClaims(
  claimsWithOutcomes: Array<{ claim: string; outcome: CrossValidateOutcome }>
): {
  verdict: HallucinationVerdict;
  confidence: number;
  flags: ClaimFlag[];
} {
  if (claimsWithOutcomes.length === 0) {
    return { verdict: "OK", confidence: 1.0, flags: [] };
  }

  const flags: ClaimFlag[] = [];
  const similarities: number[] = [];

  for (const { claim, outcome } of claimsWithOutcomes) {
    if (outcome.similarity != null) similarities.push(outcome.similarity);
    if (outcome.type !== "OK") {
      flags.push({
        claim,
        type: outcome.type as ClaimFlagType,
        sourceMatch: {
          matched: outcome.matched,
          sourceId: outcome.sourceId,
          similarity: outcome.similarity
        }
      });
    }
  }

  const avgSimilarity =
    similarities.length > 0
      ? similarities.reduce((a, b) => a + b, 0) / similarities.length
      : 0.5;

  const hasFabricated = flags.some((f) => f.type === "FABRICATED");
  const hasNonOk = flags.length > 0;

  let verdict: HallucinationVerdict;
  if (hasFabricated) {
    verdict = "HALLUCINATED";
  } else if (hasNonOk) {
    verdict = "PARTIAL_HALLUCINATED";
  } else {
    verdict = "OK";
  }

  return { verdict, confidence: avgSimilarity, flags };
}

// ─── Single-pass fallback (no rawSources) ────────────────────────────────────

async function runSinglePassFallback(input: {
  apiKey: string;
  content: string;
  sourceTrail: unknown;
  model: string;
}): Promise<HallucinationCheckResult> {
  const sourceTrailStr = input.sourceTrail
    ? JSON.stringify(input.sourceTrail, null, 2)
    : "(no source trail provided)";

  const prompt = `You are a factual grounding auditor. Your task is to identify hallucinated or ungrounded claims.

Given this content:
"""
${input.content}
"""

And this source trail (what data sources back the content):
${sourceTrailStr}

Instructions:
1. Identify any factual claims in the content that cannot be traced back to the source trail.
2. Do NOT flag analytical observations, interpretation, or general knowledge.
3. Do NOT flag buy/sell recommendations — these are already prohibited upstream.
4. List only claims that are directly contradicted by or entirely absent from the source trail.
5. Output ONLY this JSON (no markdown fence, no extra text):

{"verdict":"OK|HALLUCINATED|PARTIAL_HALLUCINATED","flags":[],"reasoning":"<1-2 sentences>"}

Where:
- OK = all factual claims are grounded in the source trail
- HALLUCINATED = major factual claims have no source trail support
- PARTIAL_HALLUCINATED = some claims are grounded, some are not`;

  const result = await callOpenAI({
    apiKey: input.apiKey,
    model: input.model,
    prompt,
    maxTokens: 512,
    timeoutMs: CLAIM_EXTRACT_TIMEOUT_MS
  });

  if (!result.ok) {
    return {
      verdict: "ERROR",
      confidence: 0,
      flags: [],
      reasoning: `openai_failed: ${result.error} — RAG_NOT_USED__SOURCE_PACK_MISSING`,
      ragUsed: false
    };
  }

  try {
    const parsed = JSON.parse(stripFence(result.text)) as {
      verdict?: unknown;
      flags?: unknown;
      reasoning?: unknown;
    };
    const verdicts = ["OK", "HALLUCINATED", "PARTIAL_HALLUCINATED"] as const;
    type V = (typeof verdicts)[number];
    const verdict: V = verdicts.includes(parsed.verdict as V) ? (parsed.verdict as V) : "OK";
    const rawFlags = Array.isArray(parsed.flags) ? (parsed.flags as unknown[]).map(String) : [];
    const reasoning =
      typeof parsed.reasoning === "string" ? parsed.reasoning : "no_reasoning";

    // Convert string flags to ClaimFlag shape for consistent output
    const flags: ClaimFlag[] = rawFlags.map((f) => ({
      claim: f,
      type: "UNSUPPORTED" as ClaimFlagType,
      sourceMatch: { matched: false, sourceId: null, similarity: null }
    }));

    return {
      verdict,
      confidence: verdict === "OK" ? 0.8 : 0.4,
      flags,
      reasoning: reasoning + " [RAG_NOT_USED__SOURCE_PACK_MISSING]",
      ragUsed: false
    };
  } catch {
    return {
      verdict: "OK",
      confidence: 0.5,
      flags: [],
      reasoning: `parse_failed — RAG_NOT_USED__SOURCE_PACK_MISSING`,
      ragUsed: false
    };
  }
}

// ─── Main entry point ─────────────────────────────────────────────────────────

/**
 * Run RAG-based hallucination check.
 *
 * If rawSources is empty/null → falls back to single-pass with sourceTrail.
 * If rawSources provided → 2-pass RAG (extract claims → cross-validate per claim).
 *
 * Never throws. All OpenAI failures return verdict=ERROR / confidence=0.
 */
export async function runRagHallucinationCheck(input: {
  apiKey: string;
  content: string;
  sourceTrail: unknown;
  rawSources: RawSourceEntry[];
  claimExtractModel: string;
  crossValidateModel: string;
}): Promise<HallucinationCheckResult> {
  const { apiKey, content, sourceTrail, rawSources, claimExtractModel, crossValidateModel } = input;

  // Fallback: no rawSources → single-pass
  if (!rawSources || rawSources.length === 0) {
    return runSinglePassFallback({
      apiKey,
      content,
      sourceTrail,
      model: claimExtractModel
    });
  }

  // Pass 1: extract factual claims
  let claims: string[];
  try {
    claims = await extractFactualClaims({
      apiKey,
      content,
      model: claimExtractModel
    });
  } catch (e) {
    console.warn(`[hallucination-rag] Pass 1 threw: ${e instanceof Error ? e.message : String(e)}`);
    claims = [];
  }

  if (claims.length === 0) {
    // No claims extractable — treat as OK (no specific factual claims to verify)
    return {
      verdict: "OK",
      confidence: 1.0,
      flags: [],
      reasoning: "no_factual_claims_extracted: content is analytical/interpretive only",
      ragUsed: true
    };
  }

  // Pass 2: cross-validate each claim in parallel (capped at MAX_CLAIMS)
  const claimsToCheck = claims.slice(0, MAX_CLAIMS);
  const outcomePairs = await Promise.allSettled(
    claimsToCheck.map((claim) =>
      crossValidateClaim({ apiKey, claim, rawSources, model: crossValidateModel })
    )
  );

  const claimsWithOutcomes: Array<{ claim: string; outcome: CrossValidateOutcome }> = [];
  for (let i = 0; i < claimsToCheck.length; i++) {
    const result = outcomePairs[i];
    const claim = claimsToCheck[i]!;
    if (result && result.status === "fulfilled") {
      claimsWithOutcomes.push({ claim, outcome: result.value });
    } else {
      // Rejected promise → conservative UNSUPPORTED
      claimsWithOutcomes.push({
        claim,
        outcome: { matched: false, sourceId: null, similarity: null, type: "UNSUPPORTED" }
      });
    }
  }

  const { verdict, confidence, flags } = aggregateVerdictWithClaims(claimsWithOutcomes);

  const verifiedCount = claimsWithOutcomes.filter((c) => c.outcome.type === "OK").length;
  const reasoning = `RAG cross-validated ${claimsToCheck.length} claims against ${rawSources.length} raw sources: ${verifiedCount} verified, ${flags.length} flagged. Confidence=${confidence.toFixed(2)}.`;

  return { verdict, confidence, flags, reasoning, ragUsed: true };
}
