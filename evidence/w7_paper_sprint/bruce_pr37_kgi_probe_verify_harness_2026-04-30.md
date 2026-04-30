# Bruce verify harness — PR #37 KGI read-only probe

**Date**: 2026-04-30
**PR**: #37 (`elva/w7-lane-d-kgi-probe-2026-04-30`)
**Scope**: evidence/probe-artifact only — no source code change
**Probe script**: `evidence/w7_paper_sprint/kgi_readonly_probe_2026-04-30.ps1`
**Runbook**: `evidence/w7_paper_sprint/kgi_readonly_probe_2026-04-30_runbook.md`

---

## Pre-merge gate (Bruce — to run AFTER operator probe output exists)

### 0. Sanity (5 items — script-only)

- [ ] PR #37 changed-files list = probe `.ps1` + runbook `.md` only (no `apps/`, `services/`, `packages/`)
- [ ] Probe script is read-only PowerShell with no `Invoke-WebRequest -Method POST` to `/order/create`
- [ ] No KGI password / person_id / account number / token / PFX path in script
- [ ] Probe runbook explicitly enumerates 嚴禁範圍 table (positions, order, real-fund routes)
- [ ] CI green (validate + W6 No-Real-Order Audit + Secret Regression Check)

### 1. Operator output review (8 items — after operator runs probe)

Expected endpoint behavior matrix:

| # | Endpoint | Expected | Notes |
|---|----------|----------|-------|
| 1 | `GET /health` | 200 with `kgi_logged_in=true` | gateway up + session live |
| 2 | `GET /quote/status` | 200 | quote subsystem live |
| 3 | `GET /quote/kbar/status` | 200 | kbar subsystem live |
| 4 | `GET /quote/2330` | 200 with bid/ask/last | live quote |
| 5 | `GET /tick/2330` | 200 with last tick | live tick |
| 6 | `GET /bidask/2330` | 200 | bidask snapshot |
| 7 | `GET /position` | **503** (containment) | breaker MUST hold |
| 8 | `POST /order/create` | **409** | hard-line MUST hold |

For each row:
- [ ] Row 1-6 returned 2xx with sane payload shape
- [ ] Row 7 `/position` returned **503** — if 200/500 STOP and escalate
- [ ] Row 8 `/order/create` returned **409** — if anything else **P0 STOP-LINE TRIGGERED**

### 2. Output redaction audit (4 items)

- [ ] No KGI account number / broker id / person_id in probe output evidence file
- [ ] No KGI password / token / session cookie value
- [ ] No raw PFX path
- [ ] If raw response contained PII fields, operator pre-redacted before commit

### 3. P0 stop-line triggers (auto-escalation conditions)

If ANY of below observed in probe output, **DO NOT MERGE PR #37**, classify per `kgi_readonly_probe_2026-04-30_runbook.md` §FAIL handling:

| Stop-line | Classification |
|-----------|---------------|
| `/order/create` returns 200 | order safety issue — P0 |
| `/order/create` returns anything ≠ 409 | order safety issue — P0 |
| `/position` returns 200 (breaker open) | position containment regression — P0 |
| `/position` returns 500 with native exception | gateway native crash — P1 |
| `kgi_logged_in=false` mid-probe | KGI session issue — P1 |
| `/quote/2330` returns 5xx | quote issue — P2 |
| `/quote/kbar/status` returns 5xx | kbar issue — P2 |

### 4. Merge package criteria

PR #37 is mergeable iff:
1. §0 Sanity all checked (5/5)
2. §1 Operator output review all checked (8/8) with expected status codes
3. §2 Redaction audit clean (4/4)
4. §3 No stop-line triggered

If all 4 sections clean → squash-merge with `gh pr merge 37 --squash --delete-branch`.
If any §3 trigger fires → preserve evidence, halt merge, escalate to Elva for triage.

---

## Pete reactive review (1 pass)

After Bruce sign-off, Pete reads:
- probe `.ps1` (looking for any non-read-only ops)
- runbook `.md` (looking for any non-doc instruction)
- operator output (looking for credential leak)

Pete's verdict: **PASS** / **HOLD** with reason.

---

## Stop / Go decision

- **GO** = §0+§1+§2 clean + Bruce signoff + Pete signoff
- **HOLD** = anything in §1 returns wrong status code (operator re-runs)
- **STOP** = §3 stop-line triggered → no merge, escalate to Elva

---

**Bruce status**: VERIFY HARNESS READY. Awaiting operator probe output.
