# Paper E2E Live Demo Runbook — 2026-05-04 Open Day

**Date drafted**: 2026-05-01 17:03 Taipei (W7 Day 2, Block 1)
**Drafter**: Elva
**Target execution**: 2026-05-04 (Mon) 09:00 Taipei market open (台股)
**Sprint goal**: First end-to-end paper order through the IUF Trading Room from idea → ticket → submit → fill → cancel → timeline. **5/9 paper E2E deadline minus 5 days.**

---

## 1. Why this runbook exists

5/4 09:00 is the first real trading day after the 68h sprint window. The first action MUST be a paper round-trip on `2330` 1-lot to **prove the W6+W7 stack is alive in production**. Without this, any institutional-grade claim is theory. This runbook is the script the operator (楊董 or Elva-self) runs that morning — pre-conditions, sequence, expected output, abort criteria, post-execution evidence collection.

Hard line: **paper-only**. KGI live submit stays 409. No real money moves.

---

## 2. Pre-open checklist (5/4 06:00 → 08:55 Taipei)

| # | Check | How | Owner | Expected | Abort if NOT |
|---|---|---|---|---|---|
| 1 | Production deploy GREEN | GHA workflow_runs latest 3 SUCCESS | Bruce | api / web / worker all green | Trigger redeploy or rollback |
| 2 | `/health` 200 | `curl https://api.eycvector.com/health` | Bruce | 200 ok with uptime > 5min | Investigate Railway service |
| 3 | Auth login 200 | `POST /auth/login` operator creds | Bruce | 200 + cookie | Investigate auth-cookie middleware |
| 4 | Workspace risk-store hydrated | log line `[risk-engine] hydrated 4 stores` on api boot | Bruce | log present | Check Railway Volume mount + risk-store file |
| 5 | KGI gateway native /health | operator-side `curl http://localhost:8787/health` | Operator | 200 | gateway not started — manual NSSM start |
| 6 | KGI gateway /quote/2330 read | operator-side gateway probe | Operator | 200 + bid/ask | gateway needs relogin (W2a runbook §3.2) |
| 7 | Kill-switch state ARMED | `GET /api/v1/risk/kill-switch-state` | Bruce | `armed: true` | DO NOT proceed; kill-switch must be ARMED |
| 8 | Paper gate state ARMED | `GET /api/v1/paper/orders/gate-state` | Bruce | `armed: true` | DO NOT proceed; paper gate must be ARMED |
| 9 | 4-layer risk limits set | `GET /api/v1/risk/limits` | Operator | account/strategy/symbol all returns; session returns no_limit_set per P1-5 pending | Set via admin UI before 09:00 |
| 10 | Operator browser login + portfolio renders | open https://app.eycvector.com/portfolio | 楊董/Elva | RiskSurface 4-cell renders; positions LIVE/EMPTY/BLOCKED honest | Investigate frontend before market open |

All 10 PASS → proceed to demo. Any FAIL → log + abort + reschedule.

---

## 3. Demo sequence (5/4 09:00 → 09:30 Taipei)

### Step A — capture baseline (09:00 TST sharp)

1. Open `/portfolio` → screenshot RISK SURFACE (account utilization / strategy / symbol / session N/A)
2. Note ledger row count `GET /api/v1/paper/orders?limit=100` → store as `baseline_count`
3. Note kill-switch + paper-gate states (both ARMED expected)
4. Save evidence file `evidence/w7_paper_sprint/paper_e2e_demo_2026-05-04/01_baseline_<timestamp>.json`

### Step B — submit 2330 1-lot paper buy via PaperOrderPanel (09:05 TST)

1. Navigate `/companies/2330`
2. PaperOrderPanel:
   - Side: `buy`
   - Qty: `1` lot
   - Price mode: `limit`
   - Price: market mid (read from quote panel; round to nearest lot tick)
   - Strategy: `manual-paper-demo-2026-05-04`
   - Notes: `paper E2E first live demo per W7 sprint goal`
3. Click Preview → verify response shape:
   - `previewOk: true`
   - `riskAdvisory.account/strategy/symbol = ok`
   - `quoteContext.staleness: fresh`
   - `idempotencyKey: <uuid>`
4. Click Submit → expect `200` with `paperOrderId` returned
5. Save evidence `02_submit_<paperOrderId>.json`

**Expected P&L impact**: 0 (open position — fill creates unrealized only)

**Abort criteria**:
- 409 with `idempotency_violation` on first submit → server cache pre-poisoned (clear via admin) → abort
- 422 with `risk_block` → check `riskAdvisory` reason; document but don't proceed (need risk-limit adjustment first)
- 5xx → log full stack; investigate before retry

### Step C — observe state machine progression (09:05 → 09:10)

1. Poll `GET /api/v1/paper/orders/<paperOrderId>` every 2s for 30s
2. Expected state transitions:
   - `PENDING_PREVIEW` → `SUBMITTED` (within 1s of POST)
   - `SUBMITTED` → `WORKING` (when PaperExecutor picks up)
   - `WORKING` → `FILLED` or `PARTIALLY_FILLED` (paper auto-fill at quote mid)
3. Save evidence `03_state_progression_<paperOrderId>.json`

**Expected**: Paper order auto-fills within 5s on `PaperExecutor` heartbeat (W6 D2 implementation).

### Step D — verify portfolio + RiskSurface updates (09:10 TST)

1. Refresh `/portfolio`
2. Expected:
   - Position row for `2330` qty=1, market value ~ NT$ <last>×1000
   - RiskSurface account utilization tick up by NT$ <last>×1000 / account_limit
   - PositionRiskBadge for 2330 = `OOOO` (all 4 layers OK at this small size, session N/A → `OOON`)
3. Save evidence `04_portfolio_after_fill_<timestamp>.png` + `_data.json`

### Step E — submit cancel (09:15 TST)

1. From paper orders list, click cancel on `<paperOrderId>` (if still in WORKING)
   - If already FILLED, skip cancel; document FILLED outcome and skip to Step F
2. Expected: `200` with state `CANCELLED` (only valid in WORKING/SUBMITTED, not FILLED)
3. Save evidence `05_cancel_<paperOrderId>.json`

### Step F — submit 2330 1-lot paper sell to close (09:20 TST)

If Step E ended with FILLED (not cancelled), submit a sell to flatten the position:

1. PaperOrderPanel `2330` side=`sell` qty=`1` limit price=current mid
2. Same flow as Step B
3. Save evidence `06_close_<paperOrderId_close>.json`

### Step G — verify timeline lineage (09:25 TST)

1. Open paper order detail for the original buy `<paperOrderId>` (and close if applicable)
2. Verify timeline shows:
   - Preview event with quoteContext frozen
   - Submit event with idempotencyKey
   - State transitions (SUBMITTED → WORKING → FILLED|CANCELLED)
   - Fill event(s) with price + timestamp + exec ID
   - Cancel event (if applicable)
   - Cross-link to close order (if applicable)
3. Save evidence `07_timeline_<paperOrderId>.png`

### Step H — final RiskSurface snapshot (09:30 TST)

1. Open `/portfolio`
2. Final state: account utilization back to baseline (or ≈ baseline + small realized P&L)
3. Save evidence `08_final_state_<timestamp>.json`

---

## 4. Success criteria (all must hold)

- ✓ Paper buy submitted, transitioned to WORKING, then FILLED or CANCELLED
- ✓ Idempotency key in audit log; duplicate submit returns 409
- ✓ RiskSurface renders LIVE 4 cells (session N/A acceptable per P1-5 pending)
- ✓ Position row appears in portfolio with correct mark-to-market
- ✓ Cancel transitions order to CANCELLED state cleanly (if executed)
- ✓ Close order (if needed) flattens position to 0
- ✓ Timeline shows all events with proper lineage
- ✓ No errors in Railway api logs during demo window
- ✓ Kill-switch ARMED throughout (never toggled)
- ✓ KGI gateway logs show 0 `/order/create` calls (paper-only confirmed)

If 9/10 hold, demo PASS. If <9, document gap, defer to 5/5-5/9 polish.

---

## 5. Hard lines (read-line, never cross)

1. **No KGI live submit**. `/order/create` 409 stays. Only `/api/v1/paper/orders` allowed.
2. **No kill-switch toggle** during demo. If ARMED at start, ARMED at end.
3. **No risk-limit edit during demo window**. Adjustments must be pre-09:00.
4. **No browser DevTools manual fetch override**. Submit only via PaperOrderPanel UI.
5. **No fake fill simulation**. Real PaperExecutor heartbeat must drive transitions.
6. **No demo on 2330 lot size > 1**. First demo is 1-lot only.
7. **No multi-symbol demo**. Only 2330 in this runbook; other symbols deferred.
8. **No cross-account / cross-workspace test**. Single operator account only.
9. **Abort if any pre-open check FAILs** (§2 #1-#10). Don't run partial demo.
10. **Evidence saved before next step**. Each step's JSON/PNG must land before continuing.

---

## 6. Evidence bundle

Final deliverable: `evidence/w7_paper_sprint/paper_e2e_demo_2026-05-04/` containing:

```
00_runbook_used.md            # this file (snapshot)
01_baseline_*.json
02_submit_*.json
03_state_progression_*.json
04_portfolio_after_fill_*.png + .json
05_cancel_*.json (or _na.txt if filled)
06_close_*.json (or _na.txt if cancelled)
07_timeline_*.png
08_final_state_*.json
99_closeout_summary.md         # written 09:30 by Elva
```

`99_closeout_summary.md` template:
```
# Paper E2E Demo 2026-05-04 — Closeout

- Result: PASS / PARTIAL / FAIL
- Duration: <minutes>
- Order(s): <paperOrderId list>
- State transitions observed: <summary>
- Anomalies: <list>
- Hard lines violated: <none expected>
- Next action: 5/4 PM polish OR 5/5 paper E2E re-run
```

---

## 7. Backup plan (if pre-open §2 FAIL)

| FAIL item | Backup action | Time cost |
|---|---|---|
| Deploy red | Revert latest merge; rerun GHA | ~10min |
| api /health 5xx | Railway service restart | ~5min |
| Auth 5xx | Cookie middleware regression — check session_handoff.md for recent auth change | ~15min |
| KGI gateway down | Restart NSSM service `iuf-kgi-gateway` (operator side) | ~3min |
| KGI gateway /quote 401 | Operator gateway relogin per W2a runbook §3.2 | ~5min |
| Kill-switch DISARMED | DO NOT toggle for demo. Check audit log for who toggled it. **Abort.** |
| Paper gate DISARMED | Check `apps/api/src/server.ts` paper-gate constant — should be hardcoded ARMED | ~2min if config |
| RiskSurface BLOCKED | Backend `/api/v1/risk/portfolio-overview` not shipped (P1-1 not yet merged). Demo proceeds without RiskSurface; portfolio table still works. |

If 2+ items FAIL → reschedule to 5/5 09:00. Do NOT force partial demo.

---

## 8. Pre-demo dependencies

| Dependency | Status as of 5/1 17:03 | Required by 5/4 09:00 |
|---|---|---|
| Codex Contract 1 (Paper Orders frontend) | LIVE-pushing, 37+ commits already | MERGED to main + deployed |
| Jason 0020 v2 (PR #39) | Jason OFFLINE | MERGED + Mike + Pete + 楊董 ACK |
| Bruce 4-state regression | Static-only (Bash dead) | Bash recovered OR alternative verify |
| Operator browser spot-check (5/3 22:00) | Templates ready in `preopen_spotcheck_2026-05-01/` | 7 items GREEN |
| Risk-store file at `/data/risk/<ws>.risk.json` | hydrated on boot per `risk-store.ts:1-64` | confirmed via api log |
| KGI gateway alive on operator Windows | Manual NSSM, has crashed in past (W2a) | started + /health 200 |
| `2330` quote freshness | live quote stream W2c | confirmed within 5min of 09:00 |

---

## 9. Open questions for 楊董

| # | Question | Elva default if unanswered |
|---|---|---|
| Q1 | Operator at 5/4 09:00 = 楊董 or Elva-self via this runbook? | **Elva-self** if 楊董 prefers; otherwise 楊董 with this runbook in hand |
| Q2 | Demo at 09:00 sharp or 09:05 (allow opening volatility to settle)? | **09:05** — 5min buffer for opening price discovery |
| Q3 | If KGI gateway down at 09:00, defer demo or proceed without quote stream? | **Defer** — demo without live quote = not institutional-grade |
| Q4 | Day-after report format — short 5-line or full closeout? | **Full closeout** — 機構級 first demo deserves full ceremony |
| Q5 | If FILLED auto, do we still test cancel by submitting another order? | **No** — first demo runs Step E only on still-WORKING; FILLED outcome documented separately |
| Q6 | Abort threshold = ANY pre-open FAIL or 2+? | **2+** per §7 last line; single FAIL with backup → proceed |
| Q7 | Should we screen-record the demo? | **Yes** — additional evidence beyond JSON/PNG; saved as `99_recording.mp4` |
| Q8 | Bruce verifier present at 09:00? | **Yes if Bash recovered** — second pair of eyes on logs |

---

## 10. Status + next action

**Status**: RUNBOOK_DRAFT — needs 楊董 ACK Q1-Q8 + Codex Contract 1 merged + Jason 0020 v2 merged + 5/3 22:00 operator browser spot-check GREEN.

**Next action**:
- 5/2 (Sat): Codex Contract 1 → DRAFT PR → Pete review → merge
- 5/2 (Sat) if Jason returns: Jason 0020 v2 → Mike + Pete + 楊董 ACK → merge
- 5/3 (Sun) 22:00: 楊董 7-item operator browser spot-check (preopen_spotcheck_2026-05-01/)
- 5/4 (Mon) 06:00: Bruce final smoke (deploy / health / auth)
- 5/4 (Mon) 09:00: this runbook executes
- 5/4 (Mon) 09:30: closeout summary written

**Block 1 cycle deliverable**: Operational runbook for the W7 sprint goal — first paper E2E live demo. Together with the 6 design docs (P1-1 / P1-3 / P1-5 / P1-6 / P1-7-Codex / P1-11), Block 1 evidence kit is now complete enough that the desk can walk from 5/2 design freeze to 5/4 09:00 demo with one document per phase.

— Elva, 2026-05-01 17:03 Taipei
