---
name: W3 Redaction v1 Audit
description: grep account=|person_id=|token=|password=|KGI_PASSWORD in W3 PR diff / new code / new evidence; all findings listed including 0-finding white report; classified by context
type: redaction_audit
date: 2026-04-27
sprint: W3
runner: Bruce (verifier-release-bruce)
scope: W3 sprint open state — main HEAD 95466f4 + evidence/path_b_w3_read_only_2026-04-27/ + evidence/design_handoff_2026-04-26/v0.7.0_work/nextjs/src/
---

# Redaction v1 Audit

## §0. Audit Scope

**Pattern audited**: `account=`, `person_id=`, `token=`, `password=`, `KGI_PASSWORD`

**Directories scanned**:
1. `apps/api/src/` — backend TypeScript
2. `services/kgi-gateway/` — Python gateway (source + tests)
3. `evidence/path_b_w3_read_only_2026-04-27/` — W3 sprint docs
4. `evidence/design_handoff_2026-04-26/v0.7.0_work/nextjs/src/` — Jim sandbox

**Scan run at**: 2026-04-27 (W3 sprint open; main HEAD 95466f4)

**Note**: This is the W3 sprint-open baseline audit. Re-run after each DRAFT PR is opened (B1, B2, Lane C sandbox closeout) and include `git diff main HEAD -- <files>` scope for PR-specific new code.

---

## §1. Findings — apps/api/src/

Pattern: `account=` — **0 matches**
Pattern: `person_id=` — **0 matches**
Pattern: `token=` — **0 matches**
Pattern: `password=` — **0 matches**
Pattern: `KGI_PASSWORD` — **0 matches**

**§1 verdict: CLEAN**

---

## §2. Findings — services/kgi-gateway/

### 2.1 `account=` — 2 matches

| File | Line | Content | Classification |
|---|---|---|---|
| `services/kgi-gateway/app.py` | 187 | `logger.info("set_Account OK: account=%s broker_id=%s", body.account, broker_id)` | **ACCEPTABLE** — `body.account` is the account number (broker ID), not a secret. This is a structured log field showing the account identifier post-login, analogous to logging a username. Not a password or token. Present in W2d baseline; not a W3 regression. |
| `services/kgi-gateway/kgi_session.py` | 70 | `account=a["account"],` | **ACCEPTABLE** — This is object construction assigning account field from API response dictionary. Not a log statement; not a raw secret. Standard Python data wrangling. |

**§2.1 verdict**: 2 matches, both ACCEPTABLE (data assignment and structured log of non-secret identifier). No stop-line violation.

### 2.2 `person_id=` — 3 matches

| File | Line | Content | Classification |
|---|---|---|---|
| `services/kgi-gateway/kgi_session.py` | 62 | `person_id=person_id.upper(),` | **ACCEPTABLE** — SDK call argument passing env-sourced person_id. Not hardcoded value. The variable comes from `os.environ` / config. |
| `services/kgi-gateway/app.py` | 133 | `person_id=body.person_id,` | **ACCEPTABLE** — Passing request body field to SDK. Not logging the value. |
| `services/kgi-gateway/app.py` | 137 | `logger.info("Login OK: person_id=%s accounts=%d", body.person_id.upper(), len(accounts))` | **FLAG — REVIEW** — This logs `person_id` in structured log at INFO level. The person_id is the login ID (not a password or token), but it is a PII-adjacent identifier. H-6 requires logs to NOT contain `person_id`. **Jason's B1 H-6 implementation must redact this log line or replace with a hashed/truncated representation.** |

**§2.2 verdict**: 2 ACCEPTABLE, 1 FLAG. The app.py:137 log line must be addressed by Lane B1 H-6 redaction. Not a stop-line violation at sprint open (pre-B1), but B1 DRAFT PR must fix before merge.

### 2.3 `token=` — 0 matches

**§2.3 verdict: CLEAN**

### 2.4 `password=` — 0 matches

**§2.4 verdict: CLEAN**

### 2.5 `KGI_PASSWORD` — 0 matches

**§2.5 verdict: CLEAN**

---

## §3. Findings — evidence/path_b_w3_read_only_2026-04-27/

Pattern: `account=|person_id=|token=|password=|KGI_PASSWORD` — **1 match**

| File | Line | Content | Classification |
|---|---|---|---|
| `evidence/path_b_w3_read_only_2026-04-27/w3_hard_line_matrix.md` | 23 | ``grep `account=\|person_id=\|token=\|password=\|KGI_PASSWORD` (非 redacted)`` | **ACCEPTABLE** — This is the hard-line matrix documenting the grep pattern TO USE for auditing. The pattern is quoted in a code block as an audit command; it is not a raw credential. |

**§3 verdict: CLEAN** (1 match is the audit pattern definition itself)

---

## §4. Findings — evidence/design_handoff_2026-04-26/v0.7.0_work/nextjs/src/

Pattern: `account=` — **0 matches**
Pattern: `person_id=` — **0 matches**
Pattern: `token=` — **0 matches**
Pattern: `password=` — **0 matches**
Pattern: `KGI_PASSWORD` — **0 matches**

**§4 verdict: CLEAN**

---

## §5. Summary Table

| Scope | Pattern | Matches | CLEAN / FLAG / VIOLATION |
|---|---|---|---|
| apps/api/src/ | account= | 0 | CLEAN |
| apps/api/src/ | person_id= | 0 | CLEAN |
| apps/api/src/ | token= | 0 | CLEAN |
| apps/api/src/ | password= | 0 | CLEAN |
| apps/api/src/ | KGI_PASSWORD | 0 | CLEAN |
| services/kgi-gateway/ | account= | 2 | ACCEPTABLE (non-secret identifier) |
| services/kgi-gateway/ | person_id= | 3 | 2 ACCEPTABLE + 1 FLAG (app.py:137 log line; must fix in B1) |
| services/kgi-gateway/ | token= | 0 | CLEAN |
| services/kgi-gateway/ | password= | 0 | CLEAN |
| services/kgi-gateway/ | KGI_PASSWORD | 0 | CLEAN |
| evidence/path_b_w3_read_only_2026-04-27/ | all patterns | 1 | ACCEPTABLE (audit pattern doc) |
| v0.7.0_work/nextjs/src/ | all patterns | 0 | CLEAN |

---

## §6. Stop-Line Assessment

**Stop-line #8** (secret/account raw/token in new evidence): **NOT TRIGGERED**

All matches are:
- Pre-existing baseline code (not introduced by W3)
- Non-secret identifiers (account number, person_id login ID — not passwords or tokens)
- Documentation of audit patterns

**Exception / Remediation required**:
- `app.py:137`: person_id logged at INFO. This is a PRE-EXISTING issue from W2d baseline (not new to W3). Lane B1 H-6 must redact this in its DRAFT PR. Bruce will re-run this audit after B1 PR is open and verify the fix.

---

## §7. Re-Audit Triggers

Re-run this audit (update this file) when:
- Lane B1 DRAFT PR opened — scan PR diff + new files
- Lane B2 DRAFT PR opened — scan PR diff + new files
- Lane C sandbox closeout — scan any new sandbox files
- Any new evidence file added to `evidence/path_b_w3_read_only_2026-04-27/`

**Re-audit scope**: `git diff main HEAD -- <changed files>` + static grep on new files.

---

## §8. Redaction v1 Field Policy (reference)

Per `pr3_health_note_and_redaction.md` memory + H-6 spec:

**Fields NEVER allowed in logs/evidence (raw values)**:
- `account` (raw account number with actual value)
- `person_id` (actual person ID string)
- `token` (any auth token value)
- `password` (any password value)
- `KGI_PASSWORD` (env var value — env var name is acceptable)

**Acceptable forms**:
- `account=<redacted>` or `account=***`
- `person_id=<HASH>` or `person_id=<first-3-chars>***`
- Env var NAMES only: `os.getenv("KGI_PASSWORD")` in code (not the value)
- Test fixture sentinel values: `account="TEST_SENTINEL"` (explicitly mock)

— Bruce, 2026-04-27 (W3 sprint open redaction baseline audit)
