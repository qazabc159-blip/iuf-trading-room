# PR #271 Desk Review — Pete 2026-05-07

## 1. PR Intent

- **What this PR does**: Adds a read-only backend consumer for the IUF Quant Lab v15 sanctioned strategy snapshot. Ships a new file `apps/api/src/lab-strategy-consumer.ts` (264L) and wires a new endpoint `GET /api/v1/lab/strategy-snapshot`. Returns 3 real lab research candidates locally; returns graceful null in prod/Railway where lab repo is absent.
- **Corresponding sprint task**: BLOCK #7 Axis 1 — 量化策略 >=3 條 真實落地 backend wiring (Product North Star §訴求 6).
- **Base branch**: `main` (CLEAN, MERGEABLE — confirmed via gh pr view).

## 2. Diff Summary

- Files changed: 3
- `apps/api/src/lab-strategy-consumer.ts` — NEW (264 lines, +264 / -0)
- `apps/api/src/server.ts` — endpoint registration only (+67 lines, strategy section)
- `tests/ci.test.ts` — +3 unit tests for lab-strategy-consumer (+67 lines)
- LOC: +393 / -0
- 150/150 tests PASS per PR description (Bruce to confirm on merge)

## 3. IUF Blocker Checklist

### A. Kill-switch / Real-order Safety
- [x] Kill-switch / EXECUTION_MODE toggle: **PASS** — zero references to KILL_SWITCH, EXECUTION_MODE, killSwitch in new file
- [x] place_order / submit_order / kgi.order.create: **PASS** — zero references
- [x] paper sprint path: **PASS** — this is a pure read-only file consumer; no order path involved
- [x] feature flag default: **N/A** — no feature flag; endpoint is always-on read-only

### B. Auth / Secret Hygiene
- [x] New endpoint `GET /api/v1/lab/strategy-snapshot` falls under `app.use("/api/v1/*", ...)` global middleware (server.ts line 309) — **PASS** auth by construction
- [x] In-handler role gate: `READ_DRAFT_ROLES.has(role)` — Owner/Admin/Analyst only, returns 403 on mismatch — **PASS**
- [x] Hardcoded API key / token / password: **PASS** — none in new file
- [x] env var in .env.example: **N/A** — no new env vars introduced
- [x] person_id / userId / sessionId in log or response: **PASS** — none leaked in new file or new server.ts block

### C. State / Schema Integrity
- [x] DB schema change: **N/A** — no DB queries, no migrations; pure filesystem read
- [x] enum / status string sync: **N/A** — status is verbatim pass-through from lab JSON, not stored in DB
- [x] LEGAL_TRANSITIONS: **N/A** — no state machine
- [x] runtime state (module-level var): **PASS** — no module-level mutable state; `readFileSync` called per request

### D. PR Hygiene
- [x] PR title: `feat(api): consume lab v15 sanctioned strategy snapshot (axis 1 真實落地)` — matches W7 pattern — **PASS**
- [x] Commit message: `feat(api): consume lab v15 sanctioned strategy snapshot from IUF_QUAN…` — conventional commits — **PASS**
- [x] Stacked DRAFT chain: single PR on `main`, not stacked — **PASS**
- [x] PR description: lists evidence compliance table, verify steps, files changed — **PASS**

### E. IUF-Specific Non-Negotiables
- [x] No agent lane crossing: Pete reviews, Jason ships — **PASS**
- [x] No governance bypass (force-push / DRAFT merge / skip Bruce): **N/A** — not requested
- [x] No KGI `/order/create` call: **PASS** — absent entirely
- [x] No redaction policy violation: see finding S1 below (sourcePath leaks filesystem path in response — suggestion, not blocker)

### F. Lab / TR Alignment Lock (board/lab_tr_alignment_lock_2026-05-07.md)
- [x] `researchOnly: true` — hard-coded literal type in LabSnapshot, never removable — **PASS**
- [x] No promotion wording / buy / sell: only appearance is in comment strings stating the prohibition — **PASS**
- [x] `status` verbatim from lab JSON — never renamed at output layer; `labStatusDisplayWording()` is UI helper only, not injected into LabStrategyCandidate — **PASS**
- [x] No Sharpe / equity / winRate / annualisedReturn emitted: `key_metrics` field exists only in internal `LabBoardRow` input type (line 41), never mapped to `LabStrategyCandidate` output — **PASS**
- [x] `counts_as_strategy_candidate=false` rows excluded — filter confirmed (lines 195-197) — **PASS**
- [x] Mandatory disclaimer on every candidate: `MANDATORY_DISCLAIMER` const injected into every candidate object — **PASS**
- [x] `caveats` includes `RESEARCH_ONLY` mandatory caveat: enforced in map() — **PASS**
- [x] `labGovernanceSource` pointer on every candidate — **PASS**
- [x] TR never writes to lab repo — verified: `readFileSync` only, zero write calls — **PASS**
- [x] Lab v15 JSON verified to exist at expected sibling path (`IUF_QUANT_LAB/research/finmind_sponsor_999_data_factory/codex_next/final_strategy_count_board_v15.json`) — **PASS**
- [x] Lab JSON `schema` field confirmed: `"final_strategy_count_board_v15"` — sprintId extraction regex works — **PASS**
- [x] graceful null when path absent — try/catch on readFileSync + JSON.parse, logs warn, returns null — **PASS**
- [x] `PAPER_LIVE` / `IN_LIVE` only in labStatusDisplayWording() map — status is verbatim from lab; if lab labels something PAPER_LIVE, TR shows it; if not, it doesn't appear — **PASS**

## 4. Findings — Priority Ranked

### Blockers
None.

### Suggestions

1. **[Info-leak] `sourcePath` exposes full filesystem path in API response**
   - Location: `lab-strategy-consumer.ts:93` (LabSnapshot type), `lab-strategy-consumer.ts:228` (set in return), `server.ts:5789` (`data: snapshot` passes it through)
   - Concern: `sourcePath` resolves to something like `/c/Users/User/Desktop/小楊機密/交易/IUF_QUANT_LAB/research/...` — this is the operator's local filesystem path. On prod/Railway it is null-path (lab absent, returns null), so only hits local dev. Not a secret, not a credential, but exposes filesystem layout to Analyst/Viewer-adjacent roles.
   - Suggested fix: strip `sourcePath` from the public response (omit from `c.json()` call) and log it server-side only. Or add a `redactedSourcePath` that shows only the relative lab governance sub-path.
   - Priority: suggestion (not blocker — prod returns null for this path anyway)

2. **[Type gap] `key_metrics` raw string contains backtest numerics but is silently dropped**
   - Location: `LabBoardRow.key_metrics` (line 41) — correctly excluded from `LabStrategyCandidate` output
   - The lab JSON `key_metrics` for candidates 2 and 3 contains JSON blobs with `hitRate120`, `maxDD120`, `ir120` etc. These are silently dropped, which is correct per alignment lock.
   - Suggestion: add a one-line comment in the `map()` block (line 215) explicitly noting `key_metrics intentionally not mapped — contains raw backtest numerics (Lab hard line)`. Prevents future dev from accidentally adding it.
   - Priority: nit

3. **[Observability] No audit_log entry for lab snapshot reads**
   - Location: `server.ts:5769-5799`
   - Other sensitive read operations (brief approvals, draft views) write to audit_log. Lab snapshot read (even in read-only mode) could benefit from a one-liner `writeAuditLog` for compliance visibility (who read the lab candidates, when).
   - Priority: suggestion — operator tool is private; not a hard requirement until Lab/TR alignment audit cadence is defined

### Nits

1. **[Nit] `CURRENT_SPRINT_VERSION = "v15"` is a code constant — bump requires code change + deploy**
   - Location: `lab-strategy-consumer.ts:127`
   - When lab publishes v16+, Jason must update this constant and deploy. An env var `LAB_SNAPSHOT_VERSION` would allow ops-level bump without code change. Not blocking for current sprint.

2. **[Nit] `displayName: row.candidate_id` — comment says lab does not provide separate displayName**
   - Location: `lab-strategy-consumer.ts:75, 214`
   - The TSDoc comment is accurate. Minor clarity nit: the comment reads "Human-friendly alias — same as strategyId (lab does not provide separate displayName)" — this is correct and well-documented. No action needed.

### Praise

- The alignment lock compliance table in PR description maps 7 rules explicitly — this is the right level of documentation for a cross-repo consume.
- `readFileSync` is correctly synchronous for a startup-adjacent file read; the try/catch chain (file not found -> JSON parse fail -> rows validation -> candidate filter) covers all four graceful-null paths cleanly.
- `labStatusDisplayWording()` correctly handles all known lab enums + provides a safe fallback that includes the original enum string — future unknown lab statuses won't silently display wrong wording.
- Dynamic `await import("./lab-strategy-consumer.js")` in the handler avoids circular dep risk and allows code splitting.
- Test 1 is bifurcated correctly: CI (no sibling repo) validates null path; local dev (with sibling repo) validates full alignment lock compliance on the real lab JSON.
- `counts_as_strategy_candidate=false` filter excludes `"none"`, `"Meta Allocator"`, `"Family C"` rows correctly per lab JSON audit (3 true-candidates, 4 false-candidate rows confirmed).

## 5. Verdict

- [x] **APPROVED** — 0 blockers. 0 suggestions that gate merge. 1 suggestion (sourcePath info-leak) and 1 nit (audit log) are post-merge items.

## 6. Suggested Owner for Fixes

- Suggestion #1 (sourcePath strip) → Jason, post-merge, before Codex frontend consume renders this field
- Suggestion #2 (key_metrics comment) → Jason, can land in any cleanup PR
- Suggestion #3 (audit log) → Elva to decide if Lab/TR alignment audit cadence requires it
- Nit #1 (version constant env var) → Jason, whenever v16+ is published

## 7. Re-review Required

NO

---
Reviewer: Pete
Date: 2026-05-07
Sprint: W7 BLOCK #7
PR: https://github.com/[repo]/pull/271
Evidence: evidence/w7_paper_sprint/PETE_PR271_DESK_REVIEW_2026-05-07.md
