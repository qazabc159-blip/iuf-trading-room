# PR #263 Desk Review — Pete 2026-05-07

## 1. PR Intent

- This PR wants to do: upgrade the existing single-pass hallucination check endpoint to a 2-pass RAG pipeline (Pass 1 = claim extraction on gpt-4o-mini, Pass 2 = per-claim cross-validation on gpt-4.1 against rawSources). Adds pipeline-gate integration in `evaluatePipelinePublishGate` after the 7-hard-reject AI reviewer and before auto-publish. Adds 8 new unit tests for the pure aggregation logic.
- Side-bundled: Codex homepage brief-preview patch (`apps/web/app/page.tsx` + `globals.css`) — shows first 2 sections of latest published brief with advice-word masking.
- Corresponding sprint task: BLOCK #6 — per session_handoff.md "真接 OpenAI hallucination check production fire".
- Base branch: main (not a stacked draft chain).

## 2. Diff Summary

- Files changed: 8
  - `apps/api/src/hallucination-rag.ts` — NEW, 531 lines
  - `apps/api/src/openalice-pipeline.ts` — +108 lines in `evaluatePipelinePublishGate`
  - `apps/api/src/server.ts` — endpoint refactored from inline to delegate to RAG module (-100 lines old, +62 lines new)
  - `apps/web/app/globals.css` — +78 lines CSS for brief-preview card
  - `apps/web/app/page.tsx` — +58 lines brief-preview render
  - `tests/ci.test.ts` — +102 lines (8 new tests)
  - `evidence/w7_paper_sprint/codex_homepage_openalice_workflow_truth_2026-05-07.md` — new evidence doc
  - `evidence/w7_paper_sprint/frontend_realdata_status_board_2026-05-01.md` — append-only log
- LOC: +975 / -100

## 3. IUF Blocker Checklist

### A. Kill-switch / Real-order Safety

- [x] grep `KILL_SWITCH` / `EXECUTION_MODE` in diff additions: **PASS** — not present.
- [x] grep `place_order` / `submit_order` / `kgi.order.create` / `/order/create` in diff additions: **PASS** — not present. Evidence doc mentions stop-line grep PASS.
- [x] paper sprint: new code touches only content-draft hallucination pipeline, not order path: **PASS**.
- [x] feature flag default: RAG gate is only active when `OPENAI_API_KEY` is set (early-exit if not). No new kill-switch introduced. Behavior is additive on top of existing 7-hard-reject: **PASS**.

### B. Auth / Secret Hygiene

- [x] New endpoint `/api/v1/internal/openalice/hallucination-check` — auth gate unchanged: `requireOpenAliceAdmin(c)` at line 1: **PASS**.
- [x] No hardcoded API key / token / password. `apiKey` flows in as parameter from `process.env["OPENAI_API_KEY"]`. Bearer header only in the `callOpenAI` helper: **PASS**.
- [x] `OPENAI_CLAIM_EXTRACT_MODEL` and `OPENAI_HALLUCINATION_VERIFY_MODEL` — **NOT in `.env.example`**. `.env.example` only has `OPENAI_MODEL=gpt-5.4-mini` and `OPENAI_API_KEY=`. The two new model-selection vars have safe defaults (gpt-4o-mini / gpt-4.1) so this is non-breaking, but they are undocumented for operators: **FAIL — see 🟡 #1**.
- [x] Logs checked: `console.info/warn` in `callOpenAI`, pipeline gate, and endpoint only log verdict/confidence/ragUsed/draftId — no API key value logged: **PASS**.
- [x] No `person_id` / `userId` / `sessionId` leak in response or logs: **PASS**.

### C. State / Schema Integrity

- [x] No DB schema changes, no migrations: **N/A** (no migration required).
- [x] `auditLogs` insert for `HALLUCINATION_REJECT` — uses existing `auditLogs` table with existing columns (`workspaceId`, `actorId`, `action`, `entityId`, `entityType`, `payload`). `action` value is `"hallucination_reject"` (lowercase snake). Pattern matches adversarial-audit log from PR #259 series: **PASS**.
- [x] No new enum or status string changes: **PASS**.
- [x] No new state-machine transitions: **PASS**.
- [x] No module-level mutable state in `hallucination-rag.ts` — all functions are stateless pure functions or async: **PASS**.

### D. PR Hygiene

- [x] PR title follows conventional commits: `feat(api): upgrade hallucination-check to RAG cross-validation with gpt-4.1 + confidence trace` — PASS.
- [x] PR description lists evidence path, test results, known gap (integration test for rawSources still pending): **PASS**.
- [x] Not a stacked DRAFT chain; base is main: **PASS**.
- [x] PR bundles backend RAG module + frontend brief-preview patch in same PR: **FAIL — see 🟡 #2** (scope bundle flag for Elva ACK, not a hard blocker).

### E. IUF-Specific Not-Crossable

- [x] No agent lane violation: `hallucination-rag.ts` and `openalice-pipeline.ts` are Jason's backend lane. `page.tsx`/`globals.css` are Codex frontend lane — both are the same PR author (Jason + Codex). PR description credits Codex for the homepage portion: **PASS** (bundled but both lanes under same PR authority chain).
- [x] No governance bypass: PR is OPEN (not force-merged), no `--no-verify`: **PASS**.
- [x] No `kgi.order.create` / `/order/create` calls: **PASS**.
- [x] No redaction violation — no `person_id` in logs, no token value in evidence: **PASS**.

## 4. Findings — Priority Ranked

### 🔴 Blockers (must fix before ready)

None identified.

### 🟡 Suggestions (should fix)

1. **[.env.example undocumented vars]**: `OPENAI_CLAIM_EXTRACT_MODEL` and `OPENAI_HALLUCINATION_VERIFY_MODEL` are referenced in both `openalice-pipeline.ts` and `server.ts` but absent from `.env.example`. Operators deploying fresh or rotating Railway env will not know these are tunable. Both have safe defaults (gpt-4o-mini / gpt-4.1) so no runtime break, but Railway env var panel will be missing context.
   - File: `.env.example`
   - Suggested addition (2 lines with comment, same pattern as `OPENAI_MODEL` comment):
     ```
     # RAG hallucination check — Pass 1 extraction model (default gpt-4o-mini)
     OPENAI_CLAIM_EXTRACT_MODEL=
     # RAG hallucination check — Pass 2 cross-validate model (default gpt-4.1)
     OPENAI_HALLUCINATION_VERIFY_MODEL=
     ```

2. **[Scope bundle — frontend homepage patch bundled with backend RAG]**: `apps/web/app/page.tsx` and `globals.css` are Codex lane; the rest is Jason lane. Both are in one PR. This is the recurring scope-bundle pattern (seen in #232, #259). No functional conflict, CI green, but Elva should explicitly ACK the bundled lanes rather than inferring it. The PR description credits Codex for the homepage portion — suggest adding an explicit "Codex lane bundled with explicit Elva ACK" note.

3. **[`aggregateVerdict` dead export]**: `hallucination-rag.ts` exports both `aggregateVerdict(outcomes: CrossValidateOutcome[])` AND `aggregateVerdictWithClaims(...)`. Only `aggregateVerdictWithClaims` is used internally (in `runRagHallucinationCheck`). `aggregateVerdict` is not called anywhere in the diff, has a comment stub ("// We need the original claim — caller passes it via aggregateVerdictWithClaims") that reveals it was the precursor. It is exported dead code. Per Karpathy §3: "If you notice unrelated dead code, mention it — don't delete it." Flagging for owner to remove or keep as explicitly-documented utility.
   - File: `apps/api/src/hallucination-rag.ts`, the `aggregateVerdict` function block.

4. **[Pipeline gate always passes `rawSources: []`]**: The integration in `evaluatePipelinePublishGate` hardcodes `rawSources: []` (comment: "pipeline path: no rawSources passed at publish time → single-pass fallback"). This means the 2-pass RAG (the primary feature of this PR) **never actually fires in the pipeline path** — only the single-pass fallback runs. The 2-pass RAG only fires via the HTTP endpoint with an explicit `rawSources` payload. This is architecturally correct and documented by the PR author, but it is worth surfacing so Elva knows: the pipeline integration is functionally equivalent to the old single-pass check with a different model router. The full 2-pass RAG benefit requires callers to pass `rawSources` (e.g., piping `companies/:id/full-profile` source entries). This is not a blocker — the safe-default is intentional and correct — but Elva should know the effective pipeline behavior is single-pass fallback until rawSources plumbing is wired.
   - File: `apps/api/src/openalice-pipeline.ts` line with `rawSources: [],` comment.

### 💭 Nits (nice to have)

1. `crossValidateClaim` on OpenAI failure returns `type: "UNSUPPORTED"` (conservative — surface for review). This is a reasonable fail-safe choice. Minor nit: the comment says "conservative — mark as UNSUPPORTED to surface for review" but in `aggregateVerdictWithClaims`, UNSUPPORTED → `PARTIAL_HALLUCINATED` → `queued_for_review` (not hard reject). This is the correct severity graduation. No action needed; just worth noting in any doc review.

2. `MAX_RAW_SOURCE_CHARS = 1_200` per source + `sourcesBlock.slice(0, 4_000)` in cross-validate prompt: with 12 MAX_CLAIMS sources each 1200 chars, the total before slice could hit 14,400 chars → truncated to 4,000. This means only ~3 sources actually reach the model in full even if 12 are provided. This is by design (keep costs manageable) but the tradeoff should be documented when rawSources plumbing is wired.

3. In `runSinglePassFallback`: `verdict === "OK" ? 0.8 : 0.4` — confidence is hardcoded for single-pass results. Not a bug (no real similarity scoring possible without per-claim cross-validation), but callers seeing `confidence: 0.8` on a single-pass result may over-trust it. The `ragUsed: false` flag correctly signals this is not a RAG result. Nit: comment the magic numbers.

### Praise

- The pure-function design of `hallucination-rag.ts` with all exported functions (extractFactualClaims, crossValidateClaim, aggregateVerdictWithClaims) independently testable without DB or network is excellent architecture. Follows IUF's established pattern of "pure logic module + pipeline integration layer."
- Secret hygiene is rigorous: `apiKey` never touches a log line anywhere in the 531-line module or the server.ts refactor. All 5 failure paths in `callOpenAI` return structured error values, never exposing the key.
- The `ERROR → queued_for_review` (not `rejected`) safe-default in the pipeline gate is the correct defensive posture: an AI service failure should not automatically reject human-written content. This matches the adversarial reviewer pattern from PR #259.
- 8 unit tests cover all 5 claim-flag types (FABRICATED/MISATTRIBUTED/CONTRADICTED/UNSUPPORTED/OK), empty claims, null similarity exclusion from averaging, and flag shape contract. No mocking of OpenAI required because the tested functions are pure aggregation logic.
- `stripFence()` defensive JSON parsing handles both ````json` and plain ``` code fence variants — good defensive practice for LLM output parsing.

## 5. Verdict

- [x] **APPROVED** — 0 blockers; 4 suggestions (2 should-fix, 2 architectural awareness); 3 nits.

No blocker prevents merge. The 2 should-fix suggestions (#1 .env.example, #3 dead export) are low-effort owner fixes that can be addressed in a follow-up chore PR if Elva judges throughput > housekeeping here.

## 6. Suggested Owner for Fixes

- 🟡 #1 (`.env.example` docs) → Jason (2-line addition, same session)
- 🟡 #2 (scope bundle ACK) → Elva to note in merge comment
- 🟡 #3 (`aggregateVerdict` dead export) → Jason (remove or mark `@internal`)
- 🟡 #4 (pipeline rawSources always-empty) → Elva to log as known architectural gap; future PR when rawSources plumbing is wired

## 7. Re-review Required

NO — unless Jason addresses 🟡 #1/#3 in this branch before merge, in which case a quick diff spot-check suffices (not full re-review).

---
Reviewer: Pete
Date: 2026-05-07
Sprint: W7 BLOCK #6
