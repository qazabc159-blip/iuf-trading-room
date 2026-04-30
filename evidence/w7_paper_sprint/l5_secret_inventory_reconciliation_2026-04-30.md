---
audit: L5 Secret Inventory Reconciliation
date: 2026-04-30
auditor: Bruce (verifier-release)
input_1: secret_inventory.md (repo root, generated 2026-04-24)
input_2: evidence/w7_paper_sprint/l5_housekeeping_audit_2026-04-30.md (Cat-D SECURITY list)
scope: read-only audit + proposal only; no files modified; no redaction executed
---

# L5 Secret Inventory Reconciliation — 2026-04-30

---

## 1. What `secret_inventory.md` Currently Tracks

The existing `secret_inventory.md` (generated 2026-04-24) covers four categories:

| Category | Tracked Items |
|---|---|
| Local `.env` files | No `.env` present; `.env.example` template keys listed (DATABASE_URL, REDIS_URL, TV_WEBHOOK_TOKEN, etc.) |
| GitHub Actions Secrets | `RAILWAY_TOKEN` only |
| Railway env vars (inferred) | DATABASE_URL, REDIS_URL, TV_WEBHOOK_TOKEN, DEFAULT_WORKSPACE_SLUG, NEXT_PUBLIC_API_BASE_URL |
| Hardcoded secrets in source | Claims "no secrets hardcoded in source files" (verified at time of generation) |

**Notably absent from `secret_inventory.md`:**
- No mention of KGI broker credentials
- No mention of `person_id`, `account`, or `broker_id` fields
- No mention of evidence directory files
- The "no hardcoded secrets" assertion was accurate as of 2026-04-24 but is now outdated relative to source files added since

---

## 2. L5 Audit Cat-D: 14-File SECURITY List

From `l5_housekeeping_audit_2026-04-30.md` §Cat-D, the SECURITY-flagged files are:

| # | File Path | L5 Verdict |
|---|---|---|
| 1 | `evidence/path_b_w2a_20260426/read_side_live.json` | ARCHIVE (redact or accept risk) |
| 2 | `evidence/path_b_w2a_20260426/read_side_live_crash.json` | ARCHIVE (redact or accept risk) |
| 3 | `evidence/path_b_w2a_20260426/bruce_verify_candidate_f_live_20260427T031621.json` | ARCHIVE (partial redact — F1*****1910 partially masked; account ref still present) |
| 4 | `evidence/path_b_w2a_20260426/bruce_verify_pr3_health_note_20260427T053421.json` | ARCHIVE (redact or accept risk) |
| 5 | `evidence/path_b_w2a_20260426/post_merge_w2b_regression_20260427T050725.json` | ARCHIVE (redact or accept risk) |
| 6 | `evidence/path_b_w2a_20260426/health_account_set_diagnosis.md` | ARCHIVE (redact or accept risk) |
| 7 | `evidence/path_b_w2a_20260426/step3a_blocked_gateway_missing_routes_2026-04-27.md` | ARCHIVE (redact or accept risk) |
| 8 | `evidence/path_b_w2a_20260426/post_merge_w2b_regression_report.md` | ARCHIVE (redact or accept risk) |
| 9 | `evidence/path_b_w2a_20260426/bruce_verify_pr3_health_note_summary.md` | ARCHIVE (redact or accept risk) |
| 10 | `evidence/path_b_w2a_20260426/redaction_policy_v1.md` | KEEP — meta-doc, identifiers are examples |
| 11 | `evidence/path_b_w3_read_only_2026-04-27/bruce_w4_lane4_phase2_audit.md` | ARCHIVE (redact or accept risk) |
| 12 | `evidence/path_b_w3_read_only_2026-04-27/bruce_w4_overnight_drift_audit.md` | ARCHIVE (redact or accept risk) |
| 13 | `evidence/path_b_w3_read_only_2026-04-27/bruce_w5b_verify_closeout.md` | ARCHIVE (redact or accept risk) |
| 14 | `evidence/path_b_w3_read_only_2026-04-27/kgi_escalation_w5b_final_polish.md` | ARCHIVE (redact or accept risk) |

Note: File #10 (`redaction_policy_v1.md`) is in the L5 count of 14 but classified KEEP because it is a governance document that references the identifiers as examples of what to redact, not a leakage site. Effective leak-risk files = 13.

---

## 3. Cross-Reference: Tracked vs. Untracked

**Result: 0 of 14 L5-flagged files are tracked in `secret_inventory.md`.**

The entire Cat-D SECURITY list is absent from `secret_inventory.md`. The inventory was generated 2026-04-24 before the W2a/W3/W4/W5b evidence bundles were produced (those sessions ran 2026-04-26 through 2026-04-29). The inventory's "no hardcoded secrets" claim was accurate at time of writing but is stale.

Additionally, the following identifier patterns are not tracked in `secret_inventory.md`:
- `person_id` / `KGI_PERSON_ID` — not mentioned
- `account` (broker account number format `0308732`) — not mentioned
- `broker_id` (value `9204`) — not mentioned

---

## 4. Grep Verification — Full Repo Scan Results

### Identifier: `F131331910` (person_id)

Grep returned 13 files. Breakdown:

| File | Classification | Notes |
|---|---|---|
| `evidence/path_b_w2a_20260426/read_side_live.json` | L5 Cat-D #1 — live forensic data | |
| `evidence/path_b_w2a_20260426/bruce_verify_candidate_f_live_20260427T031621.json` | L5 Cat-D #3 — partial mask present | |
| `evidence/path_b_w2a_20260426/post_merge_w2b_regression_report.md` | L5 Cat-D #8 | |
| `evidence_content_sprint_2026-04-23/bruce_b1_w1_runtime_verify.md` | NOT IN L5 LIST — see §4a below | Contains live login body with person_id + password |
| `services/kgi-gateway/README.md` | NOT IN L5 LIST — source tree | curl example `"person_id":"F131331910"` (illustrative, source file) |
| `apps/api/src/broker/broker-port.ts` | NOT IN L5 LIST — source tree | JSDoc comment `e.g. "F131331910"` (illustrative, not hardcoded) |
| `.claude/worktrees/agent-ab0a8048/services/kgi-gateway/README.md` | worktree copy of services/kgi-gateway/README.md | |
| `.claude/worktrees/agent-ab0a8048/apps/api/src/broker/broker-port.ts` | worktree copy of broker-port.ts | |
| `.claude/agent-memory/verifier-release-bruce/MEMORY.md` | per-agent memory index — reference to audit | |
| `.claude/agent-memory/verifier-release-bruce/l5_housekeeping_audit_learnings.md` | per-agent memory — references security flag | |
| `.claude/agent-memory/verifier-release-bruce/candidate_f_circuit_breaker_verify.md` | per-agent memory — verify log reference | |
| `evidence/w7_paper_sprint/l5_housekeeping_audit_2026-04-30.md` | audit document itself | |
| `evidence/w7_paper_sprint/overnight_progress_log_2026-04-29_to_30.md` | references security flag summary | |

### Identifier: `0308732` (account)

Grep returned 31 files. Categories:

| Category | Count | Files |
|---|---|---|
| L5 Cat-D evidence files (confirmed) | 9 | files #1,2,4,5,6,7,8,9,11 from Cat-D table |
| NOT in L5 list — evidence dir | 2 | `evidence_content_sprint_2026-04-23/bruce_b1_w1_runtime_verify.md`; `evidence/path_b_w2a_20260426/bruce_w2d_actual_verify_2026-04-27.md` (9204-only, regex pattern) |
| NOT in L5 list — source tree | 5 | `services/kgi-gateway/README.md`, `services/kgi-gateway/schemas.py`, `services/kgi-gateway/SCHEMA_MAPPING.md`, `services/kgi-gateway/tests/test_health_account_set.py`, `apps/api/src/broker/broker-port.ts`, `apps/api/src/broker/kgi-broker.ts` |
| Worktree copies | 5 | `.claude/worktrees/agent-ab0a8048/` copies of source files |
| Memory/audit files | ~10 | per-agent memory, audit docs, overnight log, L5 audit itself |

### Identifier: `9204` (broker_id)

Grep returned 18 files. Note: several hits in `bruce_w2d_*` files are regex pattern strings (e.g. `r'\b9204\b'`) or checklist row labels, not live identifier values. True live-identifier files are a subset.

### §4a: Files With Live Identifiers NOT in L5 Cat-D List

These files contain the identifiers as **live forensic values or example literals** and were not flagged in L5 Cat-D:

| File | Identifiers Present | Nature | Risk |
|---|---|---|---|
| `evidence_content_sprint_2026-04-23/bruce_b1_w1_runtime_verify.md` | `<REDACTED:KGI_PERSON_ID>`, `<REDACTED:KGI_ACCOUNT>`, `<REDACTED:KGI_BROKER_ID>` | Live runtime verify log — includes raw HTTP body with person_id + password + account + broker_id. [A1+A2 COMPLETE 2026-04-30] | **RESOLVED** |
| `services/kgi-gateway/README.md` | `F131331910`, `0308732`, `9204` | Source doc — curl examples with literal person_id and account values | HIGH — source tree, committed |
| `services/kgi-gateway/schemas.py` | `0308732`, `9204` | Source code — sample values in docstring | MEDIUM — illustrative, not functional |
| `services/kgi-gateway/SCHEMA_MAPPING.md` | `0308732`, `9204` | Source doc — sample values in table | MEDIUM — illustrative |
| `services/kgi-gateway/tests/test_health_account_set.py` | `0308732` | Test fixture — `_active_account = "0308732"` | MEDIUM — hardcoded in test |
| `apps/api/src/broker/broker-port.ts` | `F131331910`, `0308732`, `9204` | Source code — JSDoc comment examples | MEDIUM — illustrative, not functional |
| `apps/api/src/broker/kgi-broker.ts` | `0308732` | Source code — inline comment | LOW — illustrative |

---

## 5. Categorization of All Matches

| Category | (a) Already Redacted | (b) Listed in `secret_inventory.md` | (c) In L5 Cat-D (flagged for redaction) | (d) Untracked — needs flagging |
|---|---|---|---|---|
| L5 Cat-D #1-9,11-14 (13 live-risk evidence files) | No | No | Yes | No (already flagged by L5) |
| L5 Cat-D #10 `redaction_policy_v1.md` | N/A (meta-doc) | No | Yes (KEEP verdict) | No |
| `evidence_content_sprint_2026-04-23/bruce_b1_w1_runtime_verify.md` | No | No | No | **YES — and contains password** |
| `services/kgi-gateway/README.md` | No | No | No | YES |
| `services/kgi-gateway/schemas.py` | No | No | No | YES (low severity, illustrative) |
| `services/kgi-gateway/SCHEMA_MAPPING.md` | No | No | No | YES (low severity, illustrative) |
| `services/kgi-gateway/tests/test_health_account_set.py` | No | No | No | YES (hardcoded test fixture) |
| `apps/api/src/broker/broker-port.ts` | No | No | No | YES (illustrative JSDoc) |
| `apps/api/src/broker/kgi-broker.ts` | No | No | No | YES (illustrative comment) |
| `.claude/worktrees/agent-ab0a8048/*` copies | No | No | No | Low — worktree, not main tree |
| per-agent memory / audit docs referencing flag | N/A (meta-reference) | No | No | No — audit trail, acceptable |

**Summary**: 13 files already flagged by L5 Cat-D. 7 additional untracked files confirmed by grep. 1 of those 7 is CRITICAL severity (contains password). 0 of any category are tracked in `secret_inventory.md`.

---

## 6. Proposed Redaction Plan

### Group A: L5 Cat-D flagged evidence files (13 files, already known)

Decision already deferred to Cycle 9. Proposed replacement values apply when executed:

| File | Replace | With |
|---|---|---|
| All 13 L5 Cat-D evidence files | `F131331910` | `<REDACTED:person_id>` |
| All 13 L5 Cat-D evidence files | `0308732` | `<REDACTED:account>` |
| All 13 L5 Cat-D evidence files | `9204` | `<REDACTED:broker_id>` |

### Group B: Untracked files — new findings requiring flagging

| File | Replace | With | Priority |
|---|---|---|---|
| `evidence_content_sprint_2026-04-23/bruce_b1_w1_runtime_verify.md` | `<REDACTED:KGI_PERSON_ID>` | `<REDACTED:KGI_PERSON_ID>` | DONE — also contained plaintext password `<REDACTED:KGI_PASSWORD_OLD_ROTATED>` → replaced with `<REDACTED:KGI_PASSWORD_OLD_ROTATED>`. [A2 2026-04-30] |
| `evidence_content_sprint_2026-04-23/bruce_b1_w1_runtime_verify.md` | `0308732` | `<REDACTED:account>` | P0 |
| `evidence_content_sprint_2026-04-23/bruce_b1_w1_runtime_verify.md` | `9204` (live values only) | `<REDACTED:broker_id>` | P0 |
| `services/kgi-gateway/README.md` | `F131331910` (in curl examples) | `<YOUR_PERSON_ID>` | P1 — source tree |
| `services/kgi-gateway/README.md` | `0308732` (in curl examples) | `<YOUR_ACCOUNT>` | P1 |
| `services/kgi-gateway/README.md` | `9204` (in curl examples) | `<YOUR_BROKER_ID>` | P1 |
| `services/kgi-gateway/schemas.py` | `"0308732"` (docstring) | `"<YOUR_ACCOUNT>"` | P2 — illustrative |
| `services/kgi-gateway/SCHEMA_MAPPING.md` | `"0308732"` (table) | `"<YOUR_ACCOUNT>"` | P2 — illustrative |
| `services/kgi-gateway/tests/test_health_account_set.py` | `"0308732"` (fixture) | `"TEST_ACCOUNT_SENTINEL"` | P2 — test fixture |
| `apps/api/src/broker/broker-port.ts` | `"F131331910"` (JSDoc) | `"YOUR_PERSON_ID"` | P2 — illustrative |
| `apps/api/src/broker/broker-port.ts` | `"0308732"` (JSDoc + comment) | `"YOUR_ACCOUNT"` | P2 — illustrative |
| `apps/api/src/broker/broker-port.ts` | `"9204"` (JSDoc) | `"YOUR_BROKER_ID"` | P2 — illustrative |
| `apps/api/src/broker/kgi-broker.ts` | `"0308732"` (comment) | `"YOUR_ACCOUNT"` | P2 — illustrative |

---

## 7. Risk Scores

`.gitignore` does NOT contain any entry ignoring `evidence/` or `services/` or `apps/`. All files below are committed to the repo (or committable). Risk levels assume **current state: private repo**.

| File | gitignored? | Risk Score | Rationale |
|---|---|---|---|
| `evidence_content_sprint_2026-04-23/bruce_b1_w1_runtime_verify.md` | No | **HIGH** | Contains live person_id + plaintext password in HTTP body. Worst single file in repo. Not in L5 Cat-D — untracked until this audit. |
| `services/kgi-gateway/README.md` | No | **HIGH** | Source tree file, committed — curl examples contain live login credentials including person_id. Any fork or public visibility change exposes immediately. |
| L5 Cat-D files #1,2,4,5 (forensic JSON) | No | **HIGH** | Live forensic capture with account+person_id embedded in response bodies. |
| L5 Cat-D files #6-9,11-14 (markdown evidence) | No | **MEDIUM** | Text evidence docs with identifiers embedded inline; private-repo-only leak currently. |
| `services/kgi-gateway/tests/test_health_account_set.py` | No | **MEDIUM** | Hardcoded account sentinel in test fixture; committed to source. |
| `services/kgi-gateway/schemas.py` | No | **MEDIUM** | Committed source — account in docstring. |
| `services/kgi-gateway/SCHEMA_MAPPING.md` | No | **MEDIUM** | Committed source — account in table sample. |
| `apps/api/src/broker/broker-port.ts` | No | **MEDIUM** | Committed source — identifiers in JSDoc only. |
| `apps/api/src/broker/kgi-broker.ts` | No | **MEDIUM** | Committed source — account in comment. |
| `evidence/path_b_w2a_20260426/redaction_policy_v1.md` | No | **LOW** | Meta-doc; identifiers are examples of what to redact, not operational leaks. |
| `.claude/worktrees/agent-ab0a8048/*` | No | **LOW** | Worktree copies of source files; secondary to main tree; same content. |

---

## 8. Key Findings for `secret_inventory.md` Update (Cycle 9)

When `secret_inventory.md` is updated, the following new sections are needed:

1. **KGI Broker Identifiers — Evidence Files** — 13 L5 Cat-D files + `evidence_content_sprint_2026-04-23/bruce_b1_w1_runtime_verify.md` (14 total)
2. **KGI Broker Identifiers — Source Tree** — 4 source files: `services/kgi-gateway/README.md`, `schemas.py`, `SCHEMA_MAPPING.md`, `tests/test_health_account_set.py`, `apps/api/src/broker/broker-port.ts`, `kgi-broker.ts`
3. **CRITICAL ADDITION**: `evidence_content_sprint_2026-04-23/bruce_b1_w1_runtime_verify.md` also contained `KGI_PERSON_PWD` plaintext (`<REDACTED:KGI_PASSWORD_OLD_ROTATED>`) embedded in an NSSM startup command on line 235 — this is a **password leak**, not just an account leak, and was not flagged by L5. [A1 ROTATED + A2 REDACTED 2026-04-30]

---

*Audit performed read-only. No files modified, deleted, or committed. `secret_inventory.md` not modified (Cycle 9 decision pending).*
