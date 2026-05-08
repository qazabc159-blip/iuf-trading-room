# BLOCK #6 Follow-up Letter to Jason — Pete 2026-05-07

Origin: PR #259 post-review — 4 suggestions cleared by Elva/Yang ACK.
Scope of this letter: (1) concrete action items remaining for Jason; (2) adversarial reviewer prompt design for BLOCK #6 RAG upgrade.

---

## Part 1 — PR #259 Suggestion Closeout

### Suggestion 1 — Scope bundle ACK [CLOSED, no action]

Elva has explicitly ACK'd the bundled scope. BROKEN/DEPRECATED filter cleanup is already addressed across PR #258 + #261. The 30% LOC in #259 that covers theme-quality.ts is a deliberate fix-and-feature bundle, not scope creep. No code change needed; Pete closes this finding.

---

### Suggestion 2 — Stale threshold: shareholding + marketValue 10d → 5d [ACTION REQUIRED]

**File:** `apps/api/src/server.ts`

**Current state (verified):**
```
// line 4139 area
queryTradingFlowDatasetStats("tw_shareholding", 10),   // <-- 10d, daily dataset
// line 4144 area
queryMarketIntelDatasetStats("tw_market_value", 10),   // <-- 10d, daily dataset
```

**Problem:** Both `tw_shareholding` (外資持股比例) and `tw_market_value` are daily-update datasets from TWSE/FinMind. Using 10d stale threshold means the STALE badge only fires after two full trading weeks of silence — far too loose. `tw_institutional_buysell` and `tw_margin_short` already use 5d, which is correct (covers Fri→Mon holiday gap + buffer). These two should match.

**Ask:** Change both constants from `10` to `5`. Two-line surgical fix. The comment at line 4142 already says "staleDays: daily=5, weekly=10" — this would make the code match the comment for daily datasets.

```ts
// Before
queryTradingFlowDatasetStats("tw_shareholding", 10),
// After
queryTradingFlowDatasetStats("tw_shareholding", 5),

// Before
queryMarketIntelDatasetStats("tw_market_value", 10),
// After
queryMarketIntelDatasetStats("tw_market_value", 5),
```

No migration, no test schema change, no type change. The `classifySection` function at line ~5157 already handles the `staleMs` computation from `staleDays` — pure constant swap.

---

### Suggestion 3 — shortChange hardcoded null [ACTION REQUIRED]

**File:** `apps/api/src/server.ts`, line 5430

**Current state (verified):**
```ts
// line 5420-5431
const hist = rows.map((r, i, arr) => {
  const prev = arr[i + 1] ?? null;
  return {
    date: r.date,
    marginBalance: r.MarginPurchaseTodayBalance ?? null,
    shortBalance: r.ShortSaleTodayBalance ?? null,           // line 5426 — data is here
    marginChange: prev && r.MarginPurchaseTodayBalance != null && (prev as MarginRow).MarginPurchaseTodayBalance != null
      ? r.MarginPurchaseTodayBalance! - (prev as MarginRow).MarginPurchaseTodayBalance!
      : null,
    shortChange: null   // line 5430 — hardcoded, raw data above is available
  };
});
```

**Problem:** `shortChange` is declared as `number | null` in the type signature (line 5416). `ShortSaleTodayBalance` is already available on `MarginRow` (line 5415). The compute logic for `marginChange` at lines 5427-5429 is directly symmetric. Hardcoding `null` creates a misleading type contract — frontend consumers will receive `null` for a field the type promises could have a value.

**Ask:** One-line fix, symmetric with marginChange:

```ts
// Replace line 5430:
shortChange: null

// With:
shortChange: prev && r.ShortSaleTodayBalance != null && (prev as MarginRow).ShortSaleTodayBalance != null
  ? r.ShortSaleTodayBalance! - (prev as MarginRow).ShortSaleTodayBalance!
  : null,
```

No migration, no new type, no test schema change. If you want a regression test, mirror the existing marginChange test case with shortBalance values.

---

### Suggestion 4 — .env.example HALLUCINATION_CHECK_MODEL alignment [VERIFIED — minor doc only]

**Current state (verified):**

- `.env.example` line 27: `OPENAI_MODEL=gpt-5.4-mini`
- `server.ts` line 5617: `const HALLUCINATION_CHECK_MODEL = process.env["OPENAI_MODEL"] ?? "gpt-4o-mini"`
- `openalice-ai-reviewer.ts` line 27: same pattern (`process.env["OPENAI_MODEL"] ?? "gpt-4o-mini"`)
- `HALLUCINATION_CHECK_MODEL` is NOT a separate env var — it reads the shared `OPENAI_MODEL`

**Finding:** The env var `HALLUCINATION_CHECK_MODEL` does not exist and does not need to be added. Both the hallucination-check endpoint and the AI reviewer read the same `OPENAI_MODEL` env var, which is already in `.env.example`. The `.env.example` comment says "AI reviewer" but not the hallucination-check endpoint. The only gap is the comment.

**Ask:** One-line comment update in `.env.example` line 26:

```
# Before:
# OpenAI model used by AI reviewer (locked to gpt-5.4-mini per cost cap policy)

# After:
# OpenAI model used by AI reviewer + hallucination-check endpoint (locked to gpt-5.4-mini per cost cap policy)
```

This is a doc nit, not a functional gap. No Railway env var change needed — `OPENAI_MODEL` is already set.

---

## Part 2 — Adversarial Reviewer Prompt Design (BLOCK #6 RAG Upgrade)

Context: BLOCK #6 includes Jason's BG agent work on hallucination RAG upgrade. The existing pipeline is:

```
createContentDraft
  → classifyDraftTier (red/yellow/green)
  → runReview (7 hard-reject rules via openalice-ai-reviewer.ts)
       → red: force reject
       → yellow: hold for human
       → green + approve: auto-publish
       → green + reject/manual_review: reject/hold
```

The RAG upgrade adds source grounding via the hallucination-check endpoint (server.ts line 5620). Pete's adversarial reviewer is a second parallel chain that runs alongside `runReview`, not instead of it. It does NOT replace or gate the 7 hard-reject rules.

### 2.1 — Adversarial Reviewer Prompt Template

Integration point: call this AFTER `runReview` completes and ONLY if `runReview` verdict is `"approve"`. This ensures the adversarial reviewer is an additional quality gate, not a blocker on already-rejected or manual_review content.

```
ADVERSARIAL_REVIEWER_SYSTEM_PROMPT:

You are a bearish equity analyst performing adversarial review of a Taiwan-stock research brief.
Your role is to stress-test the content — assume it may be subtly misleading even if factually accurate.
Do NOT block publication; your job is to flag bias patterns for a human editor to consider.

You are checking for exactly three bias categories:

[CATEGORY A] Overly Optimistic Spin
- One-sided positive framing that omits balancing context
- Selective use of upward metrics while downward metrics exist in the same dataset
- Language that creates unwarranted confidence ("穩健成長", "持續強勢") without citing the data source

[CATEGORY B] Downside Risk Omission
- Sector risk, macro headwinds, or company-specific risk factors that the data implies but the brief ignores
- Any period where institutional net selling, margin pressure, or short interest increase is present in the data but not mentioned
- Silence on volatility when the source period covers high-variance windows

[CATEGORY C] Source Selection Bias
- The brief discusses themes or companies that appear to be cherry-picked from a larger source pack
- If source pack covers 20 themes but brief focuses on 2 bullish ones, flag this
- Presence of [BROKEN] or [DEPRECATED] source markers in the draft payload that indicate stale inputs

## Brief Content

"""
{{BRIEF_CONTENT}}
"""

## Source Pack Summary (what data was available to the generator)

"""
{{SOURCE_PACK_SUMMARY}}
"""

## Output Format

Return ONLY valid JSON, no markdown fence, no extra text:

{
  "adversarialFlags": [
    "CATEGORY_A: <specific finding, 1 sentence>",
    "CATEGORY_B: <specific finding, 1 sentence>",
    "CATEGORY_C: <specific finding, 1 sentence>"
  ],
  "severityScore": <integer 0-10>,
  "reasoning": "<2-3 sentences: overall adversarial assessment, what a skeptic would say>"
}

Where:
- adversarialFlags: empty array [] if no bias found in that category; 1 entry per category maximum
- severityScore: 0 = no bias detected; 10 = severe one-sided framing; 7+ = force manual_review
- reasoning: do not repeat the flags verbatim; write the net adversarial judgment

## Scoring Guide

0-3: Brief is balanced or appropriately hedged — no action needed
4-6: Mild optimistic lean — acceptable for research platform, log for audit trail only
7-8: Significant bias pattern — withhold auto-publish, route to human editor
9-10: Severe one-sided framing — treat same as manual_review (do not auto-publish)

## Constraints

- You are NOT re-running the 7 hard-reject rules (investment advice, target price, guarantees, hallucination, fallback template, empty sections, date mismatch). Those are upstream.
- Do NOT flag analytical interpretation as bias — bias requires a comparison point.
- Do NOT flag negative framing as bias — asymmetric negativity is fine; only asymmetric positivity is Category A.
- Respond ONLY in the JSON format above.
```

### 2.2 — Integration Spec for Jason

**Where to add the call:**

In `openalice-ai-reviewer.ts`, inside `runReview()`, after the existing `result.verdict === "approve"` + `tier === "green"` branch (currently lines ~373-393), before calling `approveContentDraft`:

```ts
// Pseudo-code — Pete does not write production code, Jason implements
if (result.verdict === "approve" && tier === "green") {
  // Existing: run adversarial check in parallel with the approve path
  const adversarialResult = await runAdversarialReview(draft.payload, draftId);
  
  if (adversarialResult && adversarialResult.severityScore >= 7) {
    // Intercept: route to manual_review instead of auto-approve
    await writeAiReviewAuditLog({
      workspaceId, draftId,
      action: "content_draft.ai_yellow_held",  // reuse existing audit action
      result: {
        verdict: "manual_review",
        reason: `[adversarial-reviewer] severityScore=${adversarialResult.severityScore} >= 7. ${adversarialResult.reasoning}`,
        flagged_issues: adversarialResult.adversarialFlags,
        confidence: result.confidence
      }
    });
    console.info(`[adversarial-reviewer] Draft ${draftId} held for human review (score=${adversarialResult.severityScore})`);
    return; // do NOT call approveContentDraft — leave as awaiting_review
  }
  
  // severityScore < 7: proceed with normal auto-approve
  // ... existing approveContentDraft call ...
}
```

**`runAdversarialReview` function signature Jason writes:**

```ts
type AdversarialReviewResult = {
  adversarialFlags: string[];
  severityScore: number;  // 0-10
  reasoning: string;
};

async function runAdversarialReview(
  payload: unknown,
  draftId: string
): Promise<AdversarialReviewResult | null>
// Returns null on any failure (safe default: do not block)
```

**Cost note (楊董 ACK'd):** One extra OpenAI call per green-tier draft. Using `max_tokens=400`, `temperature=0.2`. At gpt-4o-mini pricing (~$0.150 per 1M input tokens), one brief review = ~600 input tokens = ~$0.00009 per call. For 30 briefs/day: ~$0.003/day, well under $0.01/day. 2x cost ACK applies to this endpoint. Daily-theme-summary-producer is unaffected (hardcoded gpt-5.4-mini, separate call chain).

### 2.3 — Hard Constraints for Jason's Implementation

1. Adversarial reviewer MUST safe-default to `null` on any failure path (network error, parse error, empty response, no API key). Never block the pipeline on adversarial reviewer failure.
2. Adversarial reviewer MUST NOT re-implement any of the 7 hard-reject rules from `buildReviewPrompt()`. The prompt template above explicitly excludes them.
3. `severityScore >= 7` → routes to `awaiting_review` (human gate). Does NOT auto-reject. The human editor sees the adversarial flags.
4. `severityScore < 7` (including null/failure) → original approve path proceeds unchanged.
5. The adversarial call uses the same `OPENAI_MODEL` env var and `OPENAI_API_KEY` as the existing reviewer.
6. Log the adversarialFlags + severityScore in the `audit_log` even for scores < 7, using a new action key: `"content_draft.adversarial_audit"`. This gives Elva/楊董 a paper trail without blocking.
7. The adversarial prompt contains no buy/sell/target price language. PASS on IUF content policy.

### 2.4 — What the Adversarial Reviewer Does NOT Cover (Known Gaps)

Pete documents these as audit limitations, not blockers:

- It cannot detect thematic hallucination (vague claims from stale sources) — same limitation as hallucination-check endpoint. Only explicit fabrication is catchable.
- It cannot score bias in structured data tables (only prose sections). Financial tables with selective columns are not caught.
- BROKEN/DEPRECATED source label detection in Category C relies on the payload containing the theme names. If the upstream theme-quality.ts filter cleans them before payload generation, this category fires less often (which is correct behavior — filtered themes should not be in the brief).
- Source pack summary (`{{SOURCE_PACK_SUMMARY}}`) must be injected by the caller. If Jason's implementation does not pass the source pack, Category C coverage degrades gracefully (model will note absence of source context).

---

## Summary Table

| # | Action | Owner | File | Effort |
|---|--------|-------|------|--------|
| S2 | tw_shareholding staleDays 10→5 | Jason | server.ts ~line 4139 | 1 line |
| S2 | tw_market_value staleDays 10→5 | Jason | server.ts ~line 4144 | 1 line |
| S3 | shortChange compute (symmetric with marginChange) | Jason | server.ts ~line 5430 | 3 lines |
| S4 | .env.example comment update for OPENAI_MODEL | Jason | .env.example line 26 | 1 line comment |
| P2 | Adversarial reviewer integration (runAdversarialReview) | Jason | openalice-ai-reviewer.ts | ~60 lines new fn + 15 lines integration |

Total Jason effort estimate: S2+S3+S4 = 10min (surgical). P2 = 45min (new function + test coverage).

---

Reviewer: Pete
Date: 2026-05-07
Sprint: W7 Day 9 BLOCK #6
Source PR: #259 (APPROVED, 4 suggestions → this letter)
