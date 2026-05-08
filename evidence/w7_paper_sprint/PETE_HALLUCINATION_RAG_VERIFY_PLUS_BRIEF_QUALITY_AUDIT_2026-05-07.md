# Pete Dual Audit: Hallucination RAG Verify + Brief Quality — 2026-05-07

Sprint: W7 Paper Sprint | Reviewer: Pete | Date: 2026-05-07

---

## §A  Hallucination RAG Verdict — PR #282 production verify

**VERDICT: STILL FALLBACK (single-pass). ragUsed=false in all production runs.**

### Root cause (critical finding)

`evaluatePipelinePublishGate()` at openalice-pipeline.ts:960 contains the entire RAG
hallucination chain including sampleRows wiring (PR #282 Gap 3 fix). However:

- `evaluatePipelinePublishGate` is **exported but never called** in any production code path.
- server.ts only imports: `runBatchAiReviewer`, `runPipelineCloseBriefTick`, etc. — NOT this function.
- The comment at line 931 references `registerPipelinePublishGate` (a function that does not exist in server.ts).
- Actual approve path: `fireAiReviewerForDraft` (server.ts:7852) → openalice-ai-reviewer.ts → adversarial review → `approveContentDraft`. RAG gate is bypassed entirely.

### Evidence from audit_log (200 entries, ~12h window)

| Action | Count |
|---|---|
| content_draft.adversarial_audit | 53 |
| openalice_pipeline.run | 48 |
| content_draft.ai_approved | 47 |
| content_draft.ai_rejected | 22 |
| content_draft.ai_yellow_held | 6 |
| **hallucination_reject** | **0** |

- Zero `hallucination_reject` entries in entire 200-entry window.
- Pipeline run payload: `ragUsed` field absent (not in payload schema). `confidence: null` for all runs.
- Hallucination-check HTTP endpoint exists (POST /api/v1/internal/openalice/hallucination-check) and responds correctly. Field name confirmed: `content` (not `draftContent`), `rawSources[].sourceId` required.

### 5 sampleRows rules check (PR #282 claim)

| Rule | PR #282 claim | Production status |
|---|---|---|
| collectTableSource fetches real rows | Code correct (pipeline.ts:496-502) | DEAD — function never reached |
| OHLCV sampleRows wired | Code correct (pipeline.ts:376) | DEAD — same |
| market_overview sampleRows=null | Code correct (pipeline.ts:415) | DEAD — same |
| mock sampleRows=null | N/A (no mock path in DB mode) | PASS |
| err sampleRows=null | Code correct (pipeline.ts:523) | DEAD — same |

**All 5 rules are correctly coded but none execute in production because the calling function is orphaned.**

---

## §B  Brief Content Quality Audit — 5 briefs (5/3–5/7)

Briefs fetched: 5/7, 5/3, 5/4, 5/5, 5/6 (API returns sorted by date desc, limit 5).
Note: 5/3 is the earliest available; no 4/25 brief in limit-5 window.

Legend: PASS / FAIL / PARTIAL / N/A

| Dim | 5/7 | 5/3 | 5/4 | 5/5 | 5/6 |
|---|---|---|---|---|---|
| 1. Over-optimistic spin | PARTIAL | PARTIAL | PARTIAL | PARTIAL | PARTIAL |
| 2. Hallucinated claim (no source) | PASS | PASS | PASS | PASS | PASS |
| 3. Missing source trail | FAIL | FAIL | FAIL | FAIL | FAIL |
| 4. Buy/sell direct wording | PASS | PASS | PASS | PASS | PASS |
| 5. False confidence (必賺/保證) | PASS | PASS | PASS | PASS | PASS |
| 6. BROKEN/DEPRECATED token leak | FAIL | FAIL | FAIL | FAIL | PASS |
| 7. Source trail quality | N/A | N/A | N/A | N/A | N/A |
| 8. AI reviewer decision rationale | PARTIAL | N/A | N/A | N/A | N/A |

### Dimension notes

**Dim 1 (spin):** All 5 briefs use qualitative framing ("值得追蹤", "持續觀察") without hard numbers.
Adversarial audit scoring: 5/7 brief for SiC ticker got score=7 (intercepted); daily brief level audits
score 4-6 (not intercepted). Mild systematic optimistic lean confirmed but no single "必賺" pattern.

**Dim 2 (hallucination):** No fabricated events with specific dates/prices found in manual scan.
Qualitative claims ("矽光子為資料中心高速互連需求") are thematic, not falsifiable without source data.
RAG cross-validation never ran — see §A.

**Dim 3 (source trail):** sourceTrail field is NOT in /api/v1/briefs response (by design — lives on
content_draft intermediary). External audit cannot verify source provenance. All 5 briefs: N/A from
API perspective, treated as FAIL for operator transparency score.

**Dim 4 (buy/sell wording):** Confirmed clean. No "建議買進", "目標價", "應該賣出" in any brief body.
AI reviewer Rule 1 is catching these at draft level (22 rejects in audit window).

**Dim 5 (false confidence):** Clean. No "必賺", "保證", "穩賺" language in any published brief.

**Dim 6 (BROKEN/DEPRECATED leak):**
- 5/7: Section 0 body contains "[BROKEN-1]", "[BROKEN-2]", "[DEPRECATED]" verbatim. Brief ACKNOWLEDGES
  this as "資料品質" problem — linguistic cope, not a fix.
- 5/3: Section 0 = raw theme list with "[BROKEN-2] To Fix", "[BROKEN-1] To Fix", "[DEPRECATED]" as
  section headings. Worst instance — raw internal metadata exposed in published content.
- 5/4, 5/5, 5/6: "[BROKEN-1]", "[BROKEN-2]", "[DEPRECATED]" tokens appear in body text.
- 5/5 (4/25 brief): CLEAN — no broken/deprecated tokens.

**Dim 7 (source trail quality):** Cannot assess from /api/v1/briefs response. sourceTrail not returned.

**Dim 8 (AI reviewer rationale):** Latest adversarial audit for 5/7's drafts: all show Category C
= "Unable to assess source selection bias due to missing source pack summary." sourcePackSummary
confirmed null in production for all entries (lookupJobSourcePackSummary always returns null because
sourceJobId registry lookup misses — see Gap 2 closure note below).

---

## §C  RED Findings

### RED-1: evaluatePipelinePublishGate never called — RAG gate is completely dormant

- Location: openalice-pipeline.ts:960 (function definition). No caller anywhere in codebase.
- Impact: PR #282 sampleRows fix + Gap 1 rawSources fix both ship dead code. hallucination_reject
  will never appear in audit_log. ragUsed=true will never be observed in production.
- Proposed fix (Jason): Wire `evaluatePipelinePublishGate(draftId, sourcePack)` call in the
  approve path. Most natural insertion point: openalice-ai-reviewer.ts after adversarial review
  passes (before `approveContentDraft()`), passing the sourcePack via registry lookup (same pattern
  as lookupJobSourcePackSummary). Alternative: call from server.ts fireAiReviewerForDraft.
- Severity: RED (P1-7 task objective completely unachieved in production).

### RED-2: BROKEN/DEPRECATED tokens in 4/5 published briefs — LP1 unfixed

- Location: daily_brief rows 5/3, 5/4, 5/6, 5/7 body content.
- Root cause: BROKEN_TOKEN_PATTERN gate (pipeline.ts:1070) routes drafts to awaiting_review when
  tokens detected. But published briefs PASS through — meaning the tokens appear in body sections
  that escaped the gate scan, OR the gate runs on pre-generation draft payload (not the generated
  content). 5/3 brief is worst: raw theme list with "[BROKEN-2] To Fix" as visible heading.
- Proposed fix (Jason): Ensure BROKEN_TOKEN_PATTERN scan runs on the GENERATED brief content
  (post LLM), not only on source pack payload. Current placement may miss tokens injected by
  the LLM from its theme-name input.
- Severity: RED (operator-visible content quality failure, published to external audience).

---

## §D  BLOCK #6 §3 Gap Close-out Confirmation

| Gap | Description | Status |
|---|---|---|
| Gap 1 (rawSources from sourcePack) | Code correct in evaluatePipelinePublishGate | PARTIAL — code deployed but function never called |
| Gap 2 (sourcePackSummary registry) | lookupJobSourcePackSummary wired in ai-reviewer.ts | PARTIAL — registry lookup always returns null (sourceJobId mismatch still present or registry cleared between pipeline tick and review) |
| Gap 3 (sampleRows real rows) | PR #282 — sampleRows fetched in collectTableSource | PARTIAL — code deployed but never executed via active path |

**Summary: None of the 3 gaps are closed in production.** Code exists but is orphaned.
The single fix that unblocks all 3 gaps is wiring the evaluatePipelinePublishGate call.

---

Evidence path: `evidence/w7_paper_sprint/PETE_HALLUCINATION_RAG_VERIFY_PLUS_BRIEF_QUALITY_AUDIT_2026-05-07.md`
Owner for RED-1 fix: Jason
Owner for RED-2 fix: Jason
Elva ack required: YES — both RED findings block P1-7 delivery claim

---
Reviewer: Pete | Date: 2026-05-07 | Sprint: W7
