---
name: W3 Wording Audit
description: grep paper.?ready|live.?ready|paper.?trading|live.?trading|production.?ready|production-ready|broker.?execution in W3 sprint scope; all findings listed; negative warning comments not violations
type: wording_audit
date: 2026-04-27
sprint: W3
runner: Bruce (verifier-release-bruce)
scope: W3 sprint open state — main HEAD 95466f4 + evidence/path_b_w3_read_only_2026-04-27/ + apps/api/src/ + services/kgi-gateway/ + apps/web/ + evidence/design_handoff_2026-04-26/v0.7.0_work/nextjs/src/
---

# Wording Audit

## §0. Audit Scope

**Pattern audited** (case-insensitive):
`paper.?ready`, `live.?ready`, `paper.?trading`, `live.?trading`, `production.?ready`, `production-ready`, `broker.?execution`

**Directories scanned**:
1. `apps/api/src/` — backend TypeScript
2. `services/kgi-gateway/` — Python gateway
3. `apps/web/` — production frontend
4. `evidence/path_b_w3_read_only_2026-04-27/` — W3 sprint governance docs
5. `evidence/design_handoff_2026-04-26/v0.7.0_work/nextjs/src/` — Jim sandbox

**Classification rules**:
- **VIOLATION**: Pattern appears in rendered UI text, log message, endpoint response body, or doc section header implying system IS paper/live/production-ready — treated as stop-line #6
- **ACCEPTABLE**: Pattern appears in negative context — "NOT paper-ready", "0 wording implying production-ready", "paper trading is DISABLED", prohibited item list, audit pattern documentation
- **NEGATIVE COMMENT**: Pattern appears in source code comment explicitly stating the feature is NOT present — always ACCEPTABLE, must be listed

---

## §1. Findings — apps/api/src/

**Matches found**: 2

| File | Line | Content | Classification |
|---|---|---|---|
| `apps/api/src/server.ts` | 153 | `import { listExecutionEvents } from "./broker/execution-events-store.js";` | **ACCEPTABLE** — `broker.?execution` matches `broker/execution` in an import path. This is a legitimate import of execution event logging (not broker execution initiation). `execution-events-store` is a read-side audit log. Not wording implying production-ready. |
| `apps/api/src/broker/paper-broker.ts` | 35 | `const DEFAULT_ACCOUNT_NAME = "Paper Trading";` | **ACCEPTABLE** — Internal constant naming the paper broker account. This is the paper broker simulation module name, not a label claiming the system is paper-trading-ready for production. The paper broker exists as a simulation facility; this label is internal to the simulation module and not surfaced as a production-readiness claim. |

**§1 verdict: CLEAN** (0 violations; 2 ACCEPTABLE matches)

---

## §2. Findings — services/kgi-gateway/

Pattern matches: **0 matches**

**§2 verdict: CLEAN**

---

## §3. Findings — apps/web/

Pattern matches: **0 matches** (path scanned; 0 files contain pattern)

**§3 verdict: CLEAN**

---

## §4. Findings — evidence/path_b_w3_read_only_2026-04-27/

**Matches found**: multiple — all ACCEPTABLE (governance docs and prohibited item lists)

All occurrences in this directory are:
- Sprint plan scope exclusions: `❌ paper trading`, `❌ live trading`, `❌ broker execution`
- Sprint state declarations: `NOT paper-ready / NOT live-ready / NOT broker execution / NOT production trading ready`
- Hard-line matrix stop-line definitions (pattern to audit for)
- Closeout template fields affirming NOT paper-ready state
- Lane dispatch table DoD items: `0 paper-ready label`

**Representative sample** (all are ACCEPTABLE — negative/prohibiting context):

| File | Content type | Classification |
|---|---|---|
| `w3_read_only_sprint_plan.md` | Scope exclusion list | ACCEPTABLE — NEGATIVE |
| `w3_hard_line_matrix.md` | Stop-line definition | ACCEPTABLE — AUDIT PATTERN DOC |
| `w3_lane_dispatch_table.md` | DoD prohibitions | ACCEPTABLE — NEGATIVE |
| `w3_closeout_template.md` | State affirmation | ACCEPTABLE — NEGATIVE |
| `INDEX.md` | System status note | ACCEPTABLE — NEGATIVE |

**§4 verdict: CLEAN** (all occurrences are explicitly prohibiting or declaring NOT-ready status)

---

## §5. Findings — evidence/design_handoff_2026-04-26/v0.7.0_work/nextjs/src/

**Matches found**: 2 — both ACCEPTABLE (negative-context comments)

| File | Line | Content | Classification |
|---|---|---|---|
| `evidence/design_handoff_2026-04-26/v0.7.0_work/nextjs/src/lib/mock-kbar.ts` | 16 | `*   - No paper/live/production-ready labeling` | **NEGATIVE COMMENT** — Source code JSDoc comment explicitly stating this mock has no paper/live/production-ready labeling. This is a compliance affirmation, not a violation. |
| `evidence/design_handoff_2026-04-26/v0.7.0_work/nextjs/src/components/chart/OrderLockedBanner.tsx` | 9 | `*   - 0 wording implying this is paper/live/production-ready` | **NEGATIVE COMMENT** — JSDoc comment on OrderLockedBanner explicitly stating zero prohibited wording. This is a negative guarantee comment, not a violation. |

**§5 verdict: CLEAN** (2 NEGATIVE COMMENT matches — explicitly prohibiting wording, not asserting readiness)

---

## §6. Summary Table

| Scope | Matches | Violations | ACCEPTABLE | Negative Comments |
|---|---|---|---|---|
| apps/api/src/ | 2 | 0 | 2 | 0 |
| services/kgi-gateway/ | 0 | 0 | 0 | 0 |
| apps/web/ | 0 | 0 | 0 | 0 |
| evidence/path_b_w3_read_only_2026-04-27/ | many | 0 | many | many |
| v0.7.0_work/nextjs/src/ | 2 | 0 | 0 | 2 |

**Total violations: 0**

---

## §7. Stop-Line Assessment

**Stop-line #6** (paper/live wording appears): **NOT TRIGGERED**

All matches are in negative/prohibiting context. No match asserts the system IS paper-ready, live-ready, production-ready, or broker-execution-ready.

**System state confirmed by audit**: NOT paper-ready / NOT live-ready / NOT broker execution / NOT production trading ready.

---

## §8. Re-Audit Triggers

Re-run this audit (update this file) when:
- Lane B1 DRAFT PR opened — check new logger.ts + any new observability docs
- Lane B2 DRAFT PR opened — check new impl note + kbar docs
- Lane C sandbox closeout — check closeout doc + any new UI components
- Any new evidence file added to W3 dirs

**Violation trigger**: If ANY match is found in rendered UI text, endpoint response body, or doc section header claiming production/paper/live readiness — stop-line #6 triggered. Immediate STOP + surface Elva.

---

## §9. Definitions

**Pattern matched vs. violation boundary**:
- "NOT paper-ready" → ACCEPTABLE (negative)
- "system is NOT paper-trading-ready" → ACCEPTABLE (negative)
- "paper-ready" in a prohibited items list → ACCEPTABLE (prohibition context)
- "Paper Trading" as internal constant name in paper-broker.ts → ACCEPTABLE (module name, not UI claim)
- "Paper Trading" as a UI label claiming the system is paper-trading-enabled → VIOLATION
- "broker execution" in import path (`broker/execution-events-store`) → ACCEPTABLE (import path naming)
- "broker execution ready" in rendered UI → VIOLATION

— Bruce, 2026-04-27 (W3 sprint open wording baseline audit)
