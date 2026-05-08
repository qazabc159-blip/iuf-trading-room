# PR #273 Desk Review — Pete 2026-05-07

## 1. PR Intent

- **What this PR does**: Wires 3 carry-over gaps that Pete's BLOCK #7 production quality audit flagged as effective no-ops in production:
  - Gap 1: `evaluatePipelinePublishGate` was passing `rawSources: []` → 2-pass RAG hallucination check never fired; now extracts real `RawSourceEntry[]` from `sourcePack.sources`
  - Gap 2: `runAdversarialReview` was called with `sourcePackSummary=null` → Category C source-selection bias detection permanently degraded; adds `_jobSourcePackSummaryMap` registry + `register/lookupJobSourcePackSummary` exported fns; adversarial reviewer now receives real summary for pipeline-generated drafts
  - Gap 3: BROKEN/DEPRECATED token leak into published briefs (confirmed in 4/5 production briefs 5/3-5/7); two-layer defence: (a) L1 generator instruction banning metadata tokens; (b) L2 `BROKEN_TOKEN_PATTERN` scan in publish gate → routes to `queued_for_review`
- **Sprint task**: BLOCK #7 gap carry-over; corresponds directly to Pete BLOCK7 audit findings (rawSources always-empty; sourcePackSummary=null confirmed production; BROKEN/DEPRECATED metadata leak confirmed)
- **Base branch**: `main` (CLEAN, MERGEABLE)

## 2. Diff Summary

- Changed files: 2
- `apps/api/src/openalice-pipeline.ts`: Gap 1 rawSources wire, Gap 2 registry + registration, Gap 3 instruction rule + L2 token scan
- `apps/api/src/openalice-ai-reviewer.ts`: Gap 2 lookup + pass to `runAdversarialReview`
- LOC: +82 / -3
- No new endpoints, no DB schema changes, no migrations, no frontend changes

## 3. IUF Blocker Checklist

### A. Kill-switch / Real-order Safety
- [x] KILL_SWITCH / EXECUTION_MODE: N/A — no toggle in diff
- [x] place_order / submit_order / kgi.order.create: N/A — not touched
- [x] Paper sprint order paths: N/A — no order path changes
- [x] Feature flag defaults: N/A — no feature flags added

**PASS**

### B. Auth / Secret Hygiene
- [x] New endpoints: NONE — no new routes added
- [x] Hardcoded API key / token / password: Not found in diff; `OPENAI_API_KEY` consumed from `process.env` only
- [x] env var / .env.example: No new env vars introduced (uses existing `OPENAI_API_KEY`, `OPENAI_CLAIM_EXTRACT_MODEL`, `OPENAI_HALLUCINATION_VERIFY_MODEL`)
- [x] PII leak in log/response: `console.warn` logs only `draftId` (not person_id / session). PASS.

**PASS**

### C. State / Schema Integrity
- [x] DB schema changes: NONE — no DDL, no migration files touched
- [x] Enum / status string changes: NONE
- [x] State machine LEGAL_TRANSITIONS: NONE changed
- [x] Runtime state (module-level var): `_jobSourcePackSummaryMap` (Map<string,string>) is new module-level state. Reviewed — see Suggestion #1 below. Process restart risk is explicitly documented in code comment ("process restart is acceptable"). Memory cap at 100 entries implemented. NOT a blocker.

**PASS**

### D. PR Hygiene
- [x] PR title: `fix(openalice): ...` — conventional commits format, matches W7 paper sprint pattern
- [x] Commit message: conventional commits (fix:) — PASS
- [x] Stacked chain: base = `main`, branch = `fix/openalice-pete-block7-3gap-wire-2026-05-07` — correct
- [x] PR description: lists all 3 gaps, evidence path, test checklist. PASS.

**PASS**

### E. IUF-Specific
- [x] Lane boundary: `apps/api/src/` only — Jason lane. Pete not modifying. PASS.
- [x] No governance bypass: DRAFT is not being merged, no force push to main. PASS.
- [x] KGI gateway `/order/create`: not touched. PASS.
- [x] Redaction policy: no PII in evidence or logs. PASS.

**PASS**

## 4. Findings — Priority Ranked

### Blockers (none)

No blockers found.

### Suggestions (should fix)

**1. [Runtime state] `_jobSourcePackSummaryMap` eviction strategy is LIFO-like, not true LRU**

- Location: `openalice-pipeline.ts` lines 200-207
- Issue: When the Map exceeds 100 entries, the code deletes `_jobSourcePackSummaryMap.keys().next().value` — the first key inserted. In Node.js, `Map` iterates insertion order, so this is insertion-order eviction (FIFO-ish). This is correct for the stated intent ("keep last 100 jobs"). No functional bug. However, the comment says "keep last 100 jobs" which implies most-recent — the oldest key is evicted, so the 100 most recent are retained. Behaviour matches intent.
- Residual nit: if Map insertion order changes across Node versions (it won't — it's spec), this could surprise. Not a real concern for current Node LTS.
- Recommendation: add a comment confirming insertion-order eviction is intentional. One-line fix: `// FIFO eviction: oldest jobId dropped when >100 entries`.

**2. [Gap coverage] `BROKEN_TOKEN_PATTERN` in L2 scan does not cover `[placeholder]`**

- Location: `openalice-pipeline.ts` line 1035
- Issue: L1 instruction (line 520) bans `[BROKEN-N], [DEPRECATED], [ORPHAN], [placeholder]`. L2 scan regex `/\[(?:BROKEN(?:-\d+)?|DEPRECATED|ORPHAN)\]/i` does NOT cover `[placeholder]`. If the model outputs literal `[placeholder]` in the brief content, L2 scan will not catch it.
- Mitigating factors: (a) `NON_PRODUCTION_SOURCE_PATTERN` at line 442 covers `\bplaceholder\b` (without brackets) in the source pack filter — upstream of LLM call. (b) L1 instruction explicitly bans it. (c) `[placeholder]` is less likely in generated brief text than BROKEN/DEPRECATED theme names.
- Recommendation: extend L2 regex to `/\[(?:BROKEN(?:-\d+)?|DEPRECATED|ORPHAN|placeholder)\]/i` for symmetry with L1.

**3. [Gap 2 timing] `registerJobSourcePackSummary` registered before job completes — correct but depends on async window**

- Location: `openalice-pipeline.ts` line 550
- Issue: Registration happens immediately after `enqueueOpenAliceJob` returns (job is "queued" status). The adversarial review fires after the OpenAlice device submits the job result (which may be minutes to hours later). In normal operation the registry entry will exist. The 100-entry cap creates a theoretical race: if >100 jobs are enqueued between `enqueueOpenAliceJob` and `submitOpenAliceJobResult`, the entry could be evicted.
- At current pipeline cadence (1-2 jobs/day), 100-cap eviction is not a real risk. But worth documenting.
- Recommendation: add a code comment on the cap explaining why 100 is safe given pipeline cadence.

### Nits (nice to have)

**1. Gap 1 `rawSources` content field includes `note` which may be null**

- `JSON.stringify({ ..., note: entry.note })` where `note: string | null` — `JSON.stringify` handles null correctly (outputs `"note":null`). No bug. But the RAG cross-validator receiving `"note":null` in the source content is harmless noise.

**2. Test coverage for Gap 1 and Gap 2 paths is indirect**

- Existing tests cover `filterSourcePackEntries` (BROKEN/ORPHAN/DEPRECATED source name filtering) and `classifyDraftTier`. The new `registerJobSourcePackSummary` / `lookupJobSourcePackSummary` functions and the `BROKEN_TOKEN_PATTERN` gate in `evaluatePipelinePublishGate` do not have direct unit tests.
- The PR description cites 28/28 pipeline tests passing (all pre-existing tests). The 3 gap functions are not independently exercised.
- Not a blocker (register/lookup are trivial Map wrappers; BROKEN_TOKEN_PATTERN is a single regex). But a direct test for the L2 gate (draft with `[BROKEN-1]` in payload → returns `queued_for_review`) would be high signal-to-effort.

### Praise

- The jobId alignment chain is correct end-to-end: `enqueueOpenAliceJob` returns `{ jobId: row.id }` (DB UUID); bridge writes `sourceJobId: job.id` (same UUID) to content_drafts; `registerJobSourcePackSummary(job.jobId, ...)` registers by same UUID; `lookupJobSourcePackSummary(draftRow.sourceJobId)` looks up by same UUID. No key mismatch.
- The 100-entry FIFO cap on `_jobSourcePackSummaryMap` prevents unbounded memory growth — Jason correctly applied the "process restart is acceptable" framing rather than over-engineering a persistent cache.
- The two-layer defence for Gap 3 is architecturally clean: L1 instruction reduces generation probability; L2 scan is a safety net. Neither layer depends on the other being present.
- `sourcePackSummary=null` graceful degradation preserved for non-pipeline drafts (manual drafts with no `sourceJobId`). Safe path unchanged.
- Lane boundary held: no KGI / paper order / frontend / lab touched.

## 5. Verdict

- [x] **APPROVED** — can mark ready, no blockers

2 suggestions (pattern coverage gap in L2 regex + FIFO eviction comment), 1 nit (indirect test coverage). None block merge.

## 6. Suggested Owner for Fixes

- Suggestion #1 → Jason (1-line comment, defer to next PR or in-place)
- Suggestion #2 → Jason (`[placeholder]` in L2 regex — recommend quick in-place fix before merge if feasible; otherwise open follow-up)
- Suggestion #3 → Jason (documentation comment only)
- Nit #2 → Jason (post-merge backlog — direct unit test for `BROKEN_TOKEN_PATTERN` gate)

**Note on Suggestion #2**: The `[placeholder]` L2 gap is low-risk given L1 instruction + upstream source filter. Elva can decide whether to request a pre-merge fix or accept as follow-up.

## 7. Re-review Required

NO — suggestions are minor. If Jason applies Suggestion #2 regex fix before merge, no re-review needed (1-char change). If deferred, open as follow-up ticket.

---

Reviewer: Pete
Date: 2026-05-07
Sprint: W7 Paper Sprint BLOCK #7
Evidence file: `evidence/w7_paper_sprint/PETE_PR273_DESK_REVIEW_2026-05-07.md`
