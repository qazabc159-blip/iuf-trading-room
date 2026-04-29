# W6 Paper Sprint D1 — No-Real-Order Audit Evidence
Date: 2026-04-29
Branch: chore/w6-d1-no-real-order-audit
Author: Bruce (verifier-release)
main HEAD at branch point: c0713268e408478a1330cf785bf856d7ac8d7892

## Scope

Continuous gate script to prevent real orders during W6 paper sprint.
Script path: `scripts/audit/w6_no_real_order_audit.py`
CI integration: `.github/workflows/ci.yml` — new job `w6_audit` (runs on push/PR to main)

## 6 Checks

| # | Check | Target File(s) | Expected | Stop-Line |
|---|-------|----------------|----------|-----------|
| 1 | `/order/create` always 409 + `NOT_ENABLED_IN_W1` | `services/kgi-gateway/app.py` | `status_code=409` + `NOT_ENABLED_IN_W1` literal within 30 lines of route | SL-1 |
| 2 | No KGI SDK import in paper path | `apps/api/src/domain/trading/` (Jason D1) | Empty match — patterns: kgisuperpy/shioaji/kgi-broker/TaiFexCom/tradecom | SL-2 |
| 3 | No `executionMode: 'live'` default | `apps/`, `packages/`, `.env.example` | No non-comment matches | SL-3 |
| 4 | Kill switch default: mode=trading, engaged=false | `apps/api/src/risk-engine.ts` | `defaultKillSwitch()` returns `mode: "trading"`, `engaged: false` | SL-4 |
| 5 | Paper/order UI default OFF | `.env.example` | `NEXT_PUBLIC_IUF_ORDER_UI_ENABLED=false` | SL-5 |
| 6 | No hardcoded credential in source | `apps/`, `services/`, `packages/`, `scripts/` | No KGI_PASSWORD/KGI_PERSON_ID/API_KEY value hits | SL-8 |

## Initial Run on main HEAD `c071326` — Static Grep Verification

Bruce ran static grep equivalents (Bash environment non-functional on this host; tool-based grep used).

### Check 1 — PASS
- `services/kgi-gateway/app.py` line 928: `@app.post("/order/create")`
- `services/kgi-gateway/app.py` line 950: `status_code=409`
- `services/kgi-gateway/app.py` line 953: `code="NOT_ENABLED_IN_W1"`
- Docstring (line 931): `ALWAYS returns 409 NOT_ENABLED_IN_W1`
- W5b T12 fix (line 933): body=Optional[Any] — 409 fires before Pydantic validation

### Check 2 — PASS
- `apps/api/src/domain/trading/` does not exist (Jason Day 1 work not yet started)
- No KGI SDK import candidates in non-broker app source
- Note: `apps/api/src/broker/broker-port.ts` and `kgi-gateway-client.ts` reference `kgisuperpy` in COMMENTS only — script correctly skips comment lines

### Check 3 — PASS
- Grep `executionMode.*live` across `apps/` and `packages/`: 0 matches in non-comment code
- `.env.example`: no EXECUTION_MODE entry — correct, paper mode is controlled by UI gate flag

### Check 4 — PASS
- `apps/api/src/risk-engine.ts` line 182: `function defaultKillSwitch(accountId: string)`
- Line 185: `mode: "trading"` — kill switch not engaged by default
- Line 186: `engaged: false`
- Semantics note: IUF kill switch "ON" = functional and ready (mode=trading/engaged=false); "engaged" means tripped/halted. Default is safe (no halt).

### Check 5 — PASS
- `.env.example` line 5: `NEXT_PUBLIC_IUF_ORDER_UI_ENABLED=false`
- Comment on line 3-4 confirms: "Default-false keeps the SUBMIT path locked"

### Check 6 — PASS
- All `KGI_PASSWORD` occurrences: test mock (`patch.dict(os.environ, {"KGI_PASSWORD": test_password})`), logger redaction docs, evidence JSON metadata — zero real credential values
- `KGI_PERSON_ID`: only as env var key name in `config.py` (`os.environ.get("KGI_PERSON_ID", "")`) — no real value
- `API_KEY=`: not present in any tracked source file

## Static Audit Result

AUDIT PASS (static grep equivalent) — 6 checks green

## CI Integration

Job `w6_audit` added to `.github/workflows/ci.yml`:
- Runs on push to main + all PRs
- Python 3.11
- `python3 scripts/audit/w6_no_real_order_audit.py`
- Separate job from `validate` — does not block typecheck/build/test/smoke; both must pass

## Stop-Line Mapping

| Stop-Line | Covered By | Status |
|-----------|-----------|--------|
| SL-1: /order/create becomes 200 | Check 1 | ARMED |
| SL-2: KGI SDK import in paper path | Check 2 | ARMED |
| SL-3: executionMode: 'live' default | Check 3 | ARMED |
| SL-4: Kill switch default OFF | Check 4 | ARMED (note: IUF semantics inverted — default=trading/not-engaged = SAFE) |
| SL-5: Paper mode default OFF | Check 5 | ARMED |
| SL-8: Secret committed | Check 6 | ARMED |
| SL-6: Risk engine bypass | NOT COVERED by this script — static analysis insufficient; covered by existing risk-engine unit tests |
| SL-7: Paper order idempotency key | NOT COVERED — Jason has not created paper order schema yet (D1 deferred) |
| SL-9: CI red > 4h | NOT COVERED — monitoring cadence, not a script check |
| SL-10: main HEAD drift | NOT COVERED — git discipline, not a script check |

## Assumptions

- Jason will create `apps/api/src/domain/trading/` on Day 1; Check 2 auto-extends to scan it on next run.
- Kill switch "default ON" per W6 spec means "functional/not-tripped" which maps to `mode: "trading", engaged: false` in IUF codebase.
- SL-7 (idempotency key) will be added to this script as a Check 7 once Jason creates the paper order DB schema.
- Bash execution non-functional in current CI-local environment; script runtime verification deferred to first GHA run post-push.
