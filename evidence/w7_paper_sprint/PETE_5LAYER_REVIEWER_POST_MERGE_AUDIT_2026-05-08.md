# Pete 5-Layer Reviewer Post-Merge Audit (2026-05-08)

**Audit type**: Read-only static code audit + chain-trace. No DB query. No live HTTP.
**Scope**: PR #294 (evaluatePipelinePublishGate wire) + PR #301 (factual reviewer Layer 5) + PR #302 (audit-stats SQL fix).
**Files audited**:
- `apps/api/src/openalice-pipeline.ts` (export + gate body)
- `apps/api/src/openalice-ai-reviewer.ts` (wire order + call site)
- `apps/api/src/openalice-factual-reviewer.ts` (model + verdict enum)
- `apps/api/src/server.ts` (audit-stats endpoint, lines 9196-9344)

---

## Layer-by-Layer Verdict

### Layer 1 (hard_reject): PASS
- `buildReviewPrompt()` in `openalice-ai-reviewer.ts` lines 76-117 contains all 7 hard-reject rules.
- No second `return` statement present (dead-code trap from BLOCK5 cleared).
- Fires as the first gate inside `fireAiReviewerForDraft` via `callOpenAiReviewer()`.
- Evidence: single return at line 117.

### Layer 2 (ai_review): PASS
- `callOpenAiReviewer()` fires with OPENAI_MODEL from env (default gpt-4o-mini).
- Verdict extracted and validated against `approve | reject | manual_review` enum.
- All 4 parse/network failure paths return null → leave awaiting_review (correct safe-default).
- `writeAiReviewAuditLog()` called on all verdict branches.
- Evidence: ai-reviewer.ts lines 122-206 + 340-530.

### Layer 3 (adversarial_review): PASS
- `runAdversarialReview()` called at ai-reviewer.ts line 391, AFTER green-tier confirm, BEFORE gate.
- `writeAdversarialAuditLog()` fires for ALL calls (not just score >= 7) — correct paper trail.
- Score >= 7 intercepts: write `content_draft.ai_yellow_held` + early return (no approveContentDraft).
- Score < 7 or null: falls through to Layer 4 gate.
- sourcePackSummary lookup at line 387 — still null for all production drafts (registry timing gap, known carry-forward, not new).
- Evidence: ai-reviewer.ts lines 381-424.

### Layer 4 (publish_gate / evaluatePipelinePublishGate): PASS — WIRED. With one effectiveness caveat (see Issues).
- `evaluatePipelinePublishGate` is imported at ai-reviewer.ts line 20, called at line 443.
- Placement is correct: AFTER adversarial check, BEFORE approveContentDraft.
- Gate runs 3 sub-checks in order:
  1. `evaluatePublishGate()` (source trail + confidence + flagCount) — lines 1035-1069.
  2. `BROKEN_TOKEN_PATTERN` scan on `draft.payload` JSON string — lines 1071-1088.
  3. RAG hallucination check (`runRagHallucinationCheck`) — lines 1090-1211.
- All 5 return branches handled: rejected / queued_for_review / published / skipped / throw.
- Safe-default on throw: catch at ai-reviewer.ts line 503 falls through to direct approveContentDraft.
- Evidence: ai-reviewer.ts lines 426-508; pipeline.ts lines 967-1354.

**Caveat**: Call site passes `sourcePack=null` (ai-reviewer.ts line 443). This is intentional per comment (registry stores summary strings, not full SourcePack objects). Consequence:
- RAG gate runs with `rawSources=[]` (single-pass fallback). Confirmed at pipeline.ts line 1116-1130: `rawSources = sourcePack ? [...] : []`.
- RAG hallucinationCheck still fires if OPENAI_API_KEY present (single-pass = no ground-truth row cross-check, only content-vs-sourceTrail check). Not a skip, but degraded coverage.
- This was the documented behavior as of PR #282; the Gap 1/Gap 3 fixes are only effective when a real sourcePack is passed.

**BROKEN_TOKEN_PATTERN**: PASS — scans `JSON.stringify(draft.payload)` at line 1078, which is the **generated output** (content stored in payload), NOT the source pack input. Correct placement per L1 vs L2 scan symmetry rule.

### Layer 5 (factual_review): PARTIAL — WIRED IN GATE, ALWAYS SKIPS IN PRODUCTION PATH

**Code existence**: PASS
- `openalice-factual-reviewer.ts` exists and is structurally correct.
- Model: `process.env["OPENAI_FACTUAL_REVIEWER_MODEL"] ?? "gpt-4.1"` — correct, confirmed at line 38.
- 3 verdict enum: `FACTUAL_OK | FACTUAL_DRIFT | FACTUAL_FALSE` — confirmed at lines 45-48.
- `parseFactualJson()` exported for unit testing — confirmed at line 196.
- `runFactualReview()` is the main entry — confirmed at line 249.

**Wire in gate**: EXISTS — pipeline.ts lines 1214-1333 contain the full factual reviewer gate block.

**Production skip condition**: FAIL
- Gate body condition at pipeline.ts line 1232: `if (draftContentForFactual && sourcePack)`.
- `sourcePack` is the parameter passed to `evaluatePipelinePublishGate`.
- ALL calls from `fireAiReviewerForDraft` pass `sourcePack=null` (ai-reviewer.ts line 443).
- Therefore `sourcePack` is always `null` at the gate → condition `sourcePack` is always falsy → **Layer 5 never fires** in the production pipeline path.
- The factual reviewer code is correctly implemented but is unreachable from the only production call site.

**Impact**: FACTUAL_FALSE verdicts are never emitted. No `content_draft.factual_reject` audit log entries will appear. No factual drift interception occurs. The gate is present in code but silently skipped in 100% of production brief reviews.

---

## Check Item Results

### 1. evaluatePipelinePublishGate exported + called
- PASS — exported at pipeline.ts line 967; imported at ai-reviewer.ts line 20; called at line 443.

### 2. Wire order in fireAiReviewerForDraft
- Actual order: hard_reject (L1, via buildReviewPrompt/callOpenAiReviewer) → ai_review verdict (L2) → red/yellow tier check → adversarial_review (L3) → evaluatePipelinePublishGate (L4 + L5 inside gate) → approveContentDraft.
- Expected order per spec: hard_reject → ai_review → adversarial → publish_gate → factual_review → approveContentDraft.
- PASS for ordering. PARTIAL for L5 effectiveness (see Layer 5 above).

### 3. gpt-4.1 model + 3 verdict enum in factual reviewer
- PASS — model at line 38, enum at lines 45-48, all 3 values present.

### 4. Audit-stats endpoint schema (PR #302)
- PASS — action strings corrected: uses `content_draft.ai_approved`, `content_draft.ai_rejected`, `content_draft.adversarial_audit` (with JSONB severityScore filter), `content_draft.ai_yellow_held`, `hallucination_reject`, `paper_submit`.
- adversarial_intercept uses `(payload->>'severityScore')::int >= 7` filter — correct (no inflation).
- paper_submit_rejected uses JSONB `(payload->>'status')::int >= 422` filter on paper_submit rows — correct subset, not additive to total.
- PARTIAL: `content_draft.factual_reject` is NOT in the IN clause. When Layer 5 fires in future (after call-site fix), factual rejections will be invisible to the ops dashboard.

### 5. E2E real brief verify (5/8)
- STATUS: PARTIAL — static audit only; no DB access to walk pipeline_audit table.
- Brief generation today confirmed from session_handoff (API uptime 7min, production stable post-24 PR ship).
- Layer 1-3 fire path: confirmed by static analysis as correct.
- Layer 4 (gate): fires but with degraded RAG (rawSources empty due to sourcePack=null).
- Layer 5 (factual): never fires in production (sourcePack=null guard blocks execution).
- Cannot confirm which specific brief ID from 5/8 window without DB access. Recommend Bruce query `SELECT id, status, created_at FROM content_drafts WHERE created_at::date = '2026-05-08' ORDER BY created_at DESC LIMIT 5` for post-audit evidence.

### 6. BROKEN_TOKEN_PATTERN — output scan (not input)
- PASS — confirmed scans `JSON.stringify(draft.payload)` at pipeline.ts line 1078. This is the generated content blob, not the source pack payload.
- Pattern: `/\[(?:BROKEN(?:-\d+)?|DEPRECATED|ORPHAN)\]/i` — correct, matches [BROKEN-3], [DEPRECATED], [ORPHAN] forms.
- Note: `[placeholder]` still not covered (carry-forward from PR #273 suggestion). Known gap, not new regression.

---

## Issues Found — Priority Ranked

### 🔴 Blockers

**1. [Layer 5 skip] factual_review never fires in production**
- Location: `openalice-ai-reviewer.ts:443` + `openalice-pipeline.ts:1232`
- Root cause: `evaluatePipelinePublishGate(draftId, null)` always passes `sourcePack=null`. Gate condition `if (draftContentForFactual && sourcePack)` at line 1232 is always false.
- Impact: Layer 5 (FACTUAL_FALSE / FACTUAL_DRIFT) is fully implemented but has 0% activation rate in production. FACTUAL_FALSE content will auto-publish without factual cross-check.
- Fix required: The call-site must pass the full SourcePack, not null. Options:
  - Option A (preferred): Store full SourcePack objects (not just summaries) in the job registry (`jobSourcePackMap`), retrieve by `draftRow.sourceJobId`, pass to `evaluatePipelinePublishGate`.
  - Option B: Store serialized SourcePack in `content_drafts.payload` under `_sourcePack` field during job creation; deserialize at gate call-site.
  - Option C (minimal): Add a separate DB table `pipeline_source_packs (job_id, pack_json)` and query it at call-site.
- Owner for fix: Jason.

### 🔴 Blockers (continued)

**2. [Observability gap] content_draft.factual_reject missing from audit-stats**
- Location: `server.ts:9268-9275` (IN clause of audit-stats query)
- Root cause: PR #302 (audit-stats SQL fix) was written before PR #301 (factual reviewer); action string `content_draft.factual_reject` was never added to the IN clause.
- Impact: When Issue #1 is fixed and Layer 5 starts firing, all FACTUAL_FALSE/DRIFT verdicts will be invisible to the ops dashboard. Elva and 楊董 will not see factual rejection counts.
- Fix: Add `'content_draft.factual_reject'` to the IN clause + add `factual_reject` field to the response JSON.
- Owner: Jason. Trivial — 2-line SQL change + 1 response field.

### 🟡 Suggestions

**3. [RAG degraded] sourcePack=null → rawSources=[] → RAG runs single-pass only**
- Location: pipeline.ts line 1116-1130, ai-reviewer.ts line 443.
- Impact: Layer 4 RAG hallucination check fires (good — PR #294 fix confirmed) but without real FinMind sample rows. Only source-trail metadata (sourceId list) is passed. 2-pass RAG (claim extraction + raw-row cross-validation) does not activate.
- This is the same issue as Layer 5 skip: both require a real SourcePack at call-site to reach full effectiveness.
- Suggestion: same fix as Issue #1 (pass full SourcePack) resolves both Layer 4 degradation and Layer 5 skip simultaneously.

**4. [Audit-stats] factual_reject not tracked in total**
- When Issue #2 is fixed: verify `factual_reject` count should or should not be added to `total`. Current `total = aiApproved + aiRejected + hallucinationReject + adversarialIntercept + aiYellowHeld + paperSubmit`. factual_reject is a subset of rejections — should be counted in total (like hallucination_reject). Confirm semantic intent with Elva before wiring.

### 💭 Nits

**5. [sourcePack comment accuracy] ai-reviewer.ts comment at line 435-438 is slightly misleading**
- Comment says "The RAG gate inside evaluatePipelinePublishGate reconstructs rawSources from the full sourcePack that was stored during runPipelineTick". This implies the gate has access to a stored sourcePack — it does not. The gate only has what is passed in (null). The comment describes an intended-but-not-implemented architecture. Future developer reading this comment may assume the feature is working.
- Suggestion: Update comment to clearly state "sourcePack=null until Issue #1 fix lands — RAG and factual gates run in degraded mode".

**6. [[placeholder] still missing from BROKEN_TOKEN_PATTERN]**
- Carry-forward from PR #273. `NON_PRODUCTION_SOURCE_PATTERN` (input filter) catches `placeholder` but `BROKEN_TOKEN_PATTERN` (output scan) does not. LLM can mirror `[placeholder]` into generated content without L2 interception.
- Low probability but technically a gap.

### Praise

- Layer 4 wiring (PR #294): The RED-1 orphan fix is clean and the comment at ai-reviewer.ts line 427 explicitly names the root cause with attribution. This is exactly the right documentation pattern for a non-obvious fix.
- factual-reviewer.ts cost guards: both `rawSources.length === 0` and `!hasRealRows` guards are correct and prevent unnecessary gpt-4.1 calls when there is nothing to check against.
- audit-stats adversarial_intercept JSONB filter: `(payload->>'severityScore')::int >= 7` is the correct non-inflated count. This was a 5/7 audit finding — confirmed fixed in PR #302.
- Gate safe-defaults throughout: every gate (RAG, factual, adversarial) returns null/pass on ANY failure. Pipeline never blocks on AI infra failure. This is the correct IUF defensive posture.

---

## Verdict Summary

| Layer | Wired | Model | Fires in Production | Audit-stats Visible |
|---|---|---|---|---|
| L1 hard_reject | YES | n/a (rules) | YES | YES (via ai_rejected) |
| L2 ai_review | YES | gpt-4o-mini (env) | YES | YES (ai_approved / ai_rejected) |
| L3 adversarial | YES | gpt-4.1 (env) | YES | YES (adversarial_intercept, JSONB-filtered) |
| L4 publish_gate | YES (PR #294) | n/a + gpt-4.1 RAG | YES (degraded: no sampleRows) | YES (hallucination_reject) |
| L5 factual_review | WIRED (PR #301) | gpt-4.1 | NO — always skips (sourcePack=null) | NO (factual_reject not in query) |

## Overall Verdict

**NEEDS_FIX** — 2 blockers.

Layers 1-3 are production-effective. Layer 4 (publish_gate) is wired and fires but in degraded RAG mode. Layer 5 (factual_review) is fully implemented but has 0% production activation due to call-site passing `sourcePack=null`. The chain as described in the PR spec is NOT fully end-to-end active.

## Suggested Owners for Fixes

- 🔴 Issue #1 (Layer 5 skip — sourcePack never passed) → Jason
- 🔴 Issue #2 (factual_reject missing from audit-stats) → Jason (trivial 2-line fix)
- 🟡 Issue #3 (RAG degraded, same root cause as #1) → resolved by Issue #1 fix
- 🟡 Issue #4 (total semantics for factual_reject) → Elva to confirm, Jason to implement

## Re-review Required

YES — after Jason fixes Issues #1 and #2:
- Verify `evaluatePipelinePublishGate` call passes real SourcePack at call-site.
- Verify `content_draft.factual_reject` appears in audit-stats IN clause.
- Verify first production `factual_reject` or `factual_ok` audit log entry appears after next pipeline tick.
- Bruce to check Railway logs for `[factual-reviewer] Draft <id>: verdict=` log line.

---

Reviewer: Pete
Date: 2026-05-08
Sprint: W7 Paper Sprint — post 24-PR ship audit
Evidence path: `evidence/w7_paper_sprint/PETE_5LAYER_REVIEWER_POST_MERGE_AUDIT_2026-05-08.md`
