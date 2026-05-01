# Paper E2E Demo Contingency / Backup Plan (P1-10)

**Author:** Elva (orchestrator)
**Date:** 2026-05-01 18:03 TST
**Sprint:** W7 paper sprint, day 2 of 4 (5/1 → 5/4 09:00 TWSE open)
**Target demo:** 2026-05-04 09:00 TST first paper E2E live submit
**Companions:** P1-8 runbook (`paper_e2e_live_demo_runbook_2026-05-04.md`) + P1-9 idempotency verify (`paper_e2e_idempotency_verify_checklist_2026-05-04.md`)
**Scope:** What to do **when** something goes wrong on demo day — TWSE outage, KGI quote storm, gateway crash, idempotency dry-run FAIL, missing UI piece, kill-switch unexpectedly ENGAGED, etc.

---

## §1 Purpose & posture

The demo runbook (P1-8) describes the **happy path**. The idempotency checklist (P1-9) is the **pre-demo gate**. This document is the **failure-mode playbook** for the moment-of-truth window 5/4 06:00 → 10:00 TST.

**Posture rule:** A failed demo is acceptable. A demo that *appears* successful but bypasses safety to get there is **not**. If contingency means demoing nothing rather than demoing dangerously, demo nothing.

---

## §2 Failure surface map (10 categories)

| # | Failure | Detection | Severity |
|---|---|---|---|
| F1 | Idempotency dry-run not 12/12 by 5/3 22:00 | P1-9 §4 verify run | DEMO STOP |
| F2 | KGI gateway crashes on 5/4 morning | gateway `/health` 5xx | DEMO PARTIAL |
| F3 | TWSE quote feed silent (no WS push for 60s during pre-open) | quote-store staleness > 60s | DEMO PARTIAL |
| F4 | Kill-switch ENGAGED unexpectedly at 09:00 | risk-store state read | DEMO STOP |
| F5 | Paper gate flips to ENGAGED | `paperGateState !== "ARMED"` | DEMO STOP |
| F6 | Watchlist or portfolio surface BLOCKED at 08:55 | UI state probe | DEMO PARTIAL |
| F7 | Contract 4 PROMOTE flow fails | idea→paper-preview returns 5xx | DEMO PARTIAL |
| F8 | DB connection pool exhaustion during submit | API logs | DEMO STOP |
| F9 | Operator misclicks (double-submit, wrong symbol) | UI confirmation step | DEMO RECOVERABLE |
| F10 | Production deploy regression introduced 5/3 evening | CI/CD log + smoke | DEMO STOP |

---

## §3 Detection layer (what runs at 06:00–08:55 on 5/4)

### 3.1 Pre-open monitoring script (Bruce-owned)

Script: `evidence/w7_paper_sprint/paper_e2e_demo_2026-05-04/preflight/preopen_monitor_2026-05-04.ps1` (to be authored by Bruce on 5/3)

Runs every 60s from 06:00 → 09:00. Probes:

- KGI gateway `/health` (passive) → must return 200 + `{"status":"healthy"}`
- KGI gateway `/quote/2330` (passive read-only) → expect 200, capture latency
- API `/api/portfolio/overview` → expect LIVE state
- API `/api/watchlist/overview` → expect LIVE state, ≥1 row
- API `/api/risk/overview` → expect 4 layers all LIVE, kill ARMED, paper ARMED
- DB connection pool stats → free conns ≥ 5
- Redis quote-store last-push timestamp → < 30s ago

Each probe writes a row to `preopen_monitor_log_YYYYMMDD.jsonl`. Any failure triggers stdout WARN with category code (F1-F10).

### 3.2 08:55 go/no-go decision

Elva reads the monitor log and makes go/no-go call:

| Condition | Decision |
|---|---|
| All probes green for last 10min | GO — proceed with §3.1 of runbook |
| F1 / F4 / F5 / F8 / F10 active | NO-GO — postpone to 5/5 09:00 |
| F2 / F3 / F6 / F7 active | YELLOW — see §4 partial-demo modes below |
| F9 only theoretical (not yet happened) | GO — operator briefed |

Decision recorded in `evidence/w7_paper_sprint/paper_e2e_demo_2026-05-04/go_nogo_2026-05-04_0855.md`. **楊董 must ack the decision before 09:00.**

---

## §4 Partial-demo modes (degraded but still safe)

When a YELLOW failure is detected, demo can proceed in one of 3 reduced modes:

### Mode A — Read-only walkthrough (no submit)

**Trigger:** F2 (gateway crashes), F3 (quote feed silent for >60s), F6 (one surface BLOCKED).

**Scope:**
- Operator walks audience through the **dashboard surfaces** (portfolio, risk badges, watchlist, idea panel, K-line) showing each in LIVE or BLOCKED state.
- Explains **why** a particular surface is BLOCKED (this is itself a feature — the 4-state hard rule means we never silently mock).
- Operator does **NOT** click SUBMIT.
- Demo concludes with: "We chose not to execute the paper submit because [F2/F3/F6 reason]. Live demo postponed to next trading day."

**Time:** ~10min walkthrough vs ~25min full demo.

**Recovery target:** demo full submit on 5/5 09:00.

### Mode B — Submit but cancel before fill (mini-cycle)

**Trigger:** F7 (PROMOTE flow fails — but submit ticket still works directly).

**Scope:**
- Operator manually fills paper-order ticket (skip PROMOTE click — go directly to ticket).
- Submits 1-lot LMT 800 BUY 2330.
- **Immediately cancels** before fill simulation runs (or before any matching engine returns FILLED).
- Demonstrates: submit → ACCEPTED → CANCELLED state machine. Skips: FILL → portfolio update.

**Time:** ~15min.

**Recovery target:** full PROMOTE → submit → fill flow on 5/5.

### Mode C — Submit on alt-symbol (if 2330 has issue)

**Trigger:** F3 (quote feed silent specifically for 2330) or F6 (watchlist row 2330 BLOCKED but 0050 LIVE).

**Scope:**
- Pivot to **0050** (TWSE ETF) — large cap, deeply liquid, paper-friendly.
- Same 1-lot LMT (price adjusted for 0050).
- Run full E2E.

**Time:** same as full demo.

**Pre-condition:** must have LIVE quote for 0050 at 08:55. If both symbols silent → fall back to Mode A.

---

## §5 Hard-stop conditions (NO partial demo, postpone)

Any of these = **postpone, no exceptions**:

| # | Condition | Why hard-stop |
|---|---|---|
| HS1 | F1: Idempotency 12/12 not green | Risk of double-submit on stage |
| HS2 | F4: Kill-switch ENGAGED for unknown reason | Could mask underlying safety issue |
| HS3 | F5: Paper gate flips to ENGAGED unexpectedly | Same as HS2 |
| HS4 | F8: DB pool exhausted | API will 500 mid-demo |
| HS5 | F10: Regression introduced 5/3 evening | Code under demo not the verified version |
| HS6 | Any stop-line grep hit on `broker.submit\|live.submit\|kgi-broker\|/order/create` in apps/api or apps/web | Real-broker code path active |
| HS7 | Bruce harness reports state machine non-deterministic in last dry-run | State integrity uncertain |
| HS8 | Operator (楊董) feels uncomfortable with go/no-go signal | Founder veto override |

If HS1-HS7 → postpone to next trading day (5/5). If multiple HS → postpone to 5/6 + investigate root cause first.

---

## §6 Postponement protocol

If demo postponed:

1. **08:55** Elva announces NO-GO with category code (F#) and HS#
2. **08:58** 楊董 acks postponement
3. **09:00–10:00** Bruce + Jason root-cause the failure category
4. **10:00** Root cause identified → write `evidence/w7_paper_sprint/paper_e2e_demo_2026-05-04/postponement_rootcause.md`
5. **10:00–14:00** Hotfix branch + PR + Mike + Pete review
6. **14:00–16:00** Bruce 12/12 idempotency re-run + monitor probes
7. **16:00** Decision: 5/5 demo viable? Yes → schedule 5/5 09:00. No → escalate to 5/6.

**No silent slippage.** Every postponement gets a written rootcause doc.

---

## §7 Recovery during demo (mid-flow failure)

If demo starts and something fails mid-flow:

| Mid-flow failure | Recovery action |
|---|---|
| API returns 5xx after submit click | Operator says "API failure, capturing state" → Bruce screenshots state → demo aborted, postpone |
| State machine stuck in WORKING | Operator says "State stall, demonstrating cancel" → click CANCEL → if cancel works, demo ends partial OK |
| Portfolio doesn't update after FILLED | Operator says "Portfolio refresh delay observed" → manual refresh → if still wrong, abort with note |
| Watchlist row goes BLOCKED mid-demo | Operator says "Quote source disrupt — surface reflects honestly" → continue if other surfaces healthy |
| Kill-switch unexpectedly ENGAGES mid-demo | Operator does NOT bypass — demo stops, audit kill-switch trigger source |

**Operator script for any mid-flow failure:** "We're seeing [X] state. The 4-state hard rule means the surface is reflecting reality, not silently masking. Capturing state for forensic review."

This **turns the failure into a feature demo** — institutional-grade systems show their failures honestly.

---

## §8 Communication tree (who tells whom what, when)

| Time | Channel | Sender | Recipient | Message |
|---|---|---|---|---|
| 06:00 | preopen_monitor.log | Bruce | self | Probes start, log opens |
| 08:00 | session_handoff.md | Elva | self | Pre-flight final state captured |
| 08:50 | (terminal output) | Elva | 楊董 | "Pre-flight summary: probes [green/yellow/red]; Mode [A/B/C/full] recommended" |
| 08:55 | go_nogo_2026-05-04_0855.md | Elva | 楊董 | Formal go/no-go ack request |
| 08:58 | (terminal output) | 楊董 | Elva | "GO" or "NO-GO" verbatim |
| 09:00 | runbook §3 Step A | Operator (楊董) | (audience) | Demo opens |
| (mid-flow if fail) | (terminal output) | Operator | Elva | "Failure observed: [describe]. Capturing state." |
| (post-demo) | closeout summary | Elva | self | Demo result + evidence bundle locked |

---

## §9 Evidence bundle for contingency-triggered scenarios

If contingency triggers, evidence bundle adds:

`evidence/w7_paper_sprint/paper_e2e_demo_2026-05-04/contingency_triggered/`:
- `00_failure_category.md` — F# / HS# code + first-detected timestamp
- `01_preopen_monitor_window.jsonl` — last 30min of monitor log
- `02_partial_mode_used.md` — A/B/C or postponed
- `03_operator_script_used.md` — what operator actually said on stage
- `04_state_capture/` — DB snapshot, gateway logs, API logs, browser screenshots
- `05_root_cause_analysis.md` — written within 24h
- `06_hotfix_pr_link.md` — PR # + merge commit
- `07_recovery_demo_date.md` — 5/5 / 5/6 / TBD

---

## §10 Hard lines (8)

| # | Rule | Reason |
|---|---|---|
| 1 | No partial demo without 楊董 ack | Founder veto applies to mode change too |
| 2 | No submit on stage if any stop-line grep hits | Fail-closed |
| 3 | No bypass of kill-switch / paper gate to "make it work" | Bypasses ARE the failure mode |
| 4 | No unverified hotfix between 08:00 and 09:00 | Window is too tight for safe deploy |
| 5 | Operator MUST read pre-flight summary aloud before 09:00 | Forces explicit ack |
| 6 | If postpone, write rootcause within 24h | Don't lose the lesson |
| 7 | Mid-flow failures stay on stage — no cover-up | Honesty is part of the demo |
| 8 | Audience question "why is X BLOCKED?" gets honest answer | Same |

---

## §11 Open questions for 楊董 (4)

1. **Q1 — Audience composition:** is this internal (just team), or external (investors / press)? (Affects how forthcoming we are about contingency mode usage.) — *Default assumption: internal, full transparency.*
2. **Q2 — Mode C alt-symbol:** 0050 OK, or prefer 2317? (Both deeply liquid; 0050 = ETF passive, 2317 = single-name with more news flow.) — *Default: 0050.*
3. **Q3 — Postponement cadence:** if 5/4 postponed, retry 5/5 OR skip to 5/8 (Friday end-of-week, full prep cycle)? — *Default: 5/5 next trading day.*
4. **Q4 — Override authority:** can Elva call NO-GO without 楊董, or must wait for ack? — *Default: Elva can call NO-GO unilaterally; only GO requires 楊董 ack.*

---

## §12 Cross-references

- Runbook (happy path): `evidence/w7_paper_sprint/paper_e2e_live_demo_runbook_2026-05-04.md`
- Idempotency verify (gate): `evidence/w7_paper_sprint/paper_e2e_idempotency_verify_checklist_2026-05-04.md`
- Status board: `evidence/w7_paper_sprint/frontend_realdata_status_board_2026-05-01.md`
- Contracts 2/3/4 designs: same folder, `contract_2_*` / `contract_3_*` / `contract_4_*`

---

**Status:** DRAFT v1. Bruce owns preopen_monitor script (5/3 author). Elva owns 08:55 go/no-go decision. 楊董 owns final ack. 4 open Q with defaults applied.
