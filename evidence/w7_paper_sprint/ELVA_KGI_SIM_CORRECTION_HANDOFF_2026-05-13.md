# Elva/Athena KGI SIM Correction Handoff - 2026-05-13

Status: `KGI_SIM_LOCAL_ROUNDTRIP_PASS__EC2_TEST_HOST_NETWORK_BLOCKED`

This is the current single source of truth for the KGI SIM workstream.

## Correction

Do not use `WAVE3_BLOCKED_KGI_SIM_AUTH` as the current verdict.

KGI already provided SIM test authorization by email:

- Test account: `9228-001282-6`
- Login ID: Owner's existing KGI person_id
- SIM password: `0000`
- Trade host: `itradetest.kgi.com.tw` ports `443/8000`
- Quote host: `iquotetest.kgi.com.tw` ports `443/8000`
- Mode: release mode

The fact that SIM ID equals the live person_id is expected. It is not evidence
that the SSM SIM params are fake.

## Verified Facts

EC2 network:

- `itradetest.kgi.com.tw:443` from EC2: TCP fail
- `itradetest.kgi.com.tw:8000` from EC2: TCP fail
- `iquotetest.kgi.com.tw:443` from EC2: TCP fail
- `iquotetest.kgi.com.tw:8000` from EC2: TCP fail

Owner local PC network:

- All four KGI test host/port checks pass from local PC.

Local SDK/gateway:

- Local SIM login succeeds with `simulation=true`
- `_ObjOrder.FIsConnected=True`
- `_ObjOrder.FIsLogon=True`
- Broker id `9228`
- Account `0012826`
- Gateway `/session/login`: `200`
- Gateway `/session/set-account`: `200`
- Gateway `/health`: `kgi_logged_in=true`, `account_set=true`

SIM order round-trip:

- `/order/create`: `200`
- Response includes `sim_only=true`
- Response status: `accepted`
- Symbol: `0050`
- Quantity: `1`
- Odd lot: `Odd`
- WebSocket callback count: `2`
- Callback includes `Task.NewOrder`
- Callback success state: `Status.Success`
- Order id: `V000L`
- `/trades?full=true` shows `V000L` as `Submitted` with `NewOrder` `Success`

Production safety:

- EC2 production `/health`: `kgi_logged_in=true`, `account_set=true`
- EC2 production `/order/create`: `409 LIVE_ORDER_BLOCKED`
- Cash/live order path remains blocked.

Code correction:

- PR #406 branch: `feat/gateway-unlock-sim-order-p0a-2026-05-13`
- Follow-up commit: `f2a6da6 fix(gateway): map SIM order payload to KGI enums`
- Test result: `services/kgi-gateway/tests/test_order_gate.py` -> `15 passed`

## Root Cause Split

EC2 SIM failure:

- Not SIM authorization.
- Not credential failure.
- Not gateway route missing.
- Cause: EC2 source cannot reach KGI SIM test hosts.
- Action if EC2 SIM is required: ask KGI to allowlist EC2 Elastic IP, or run SIM via a local/VPN gateway reachable from allowed source.

Initial local gateway 8787 failure:

- Long-running NSSM service process did not complete `OnLogonResponse`.
- Clean local gateway process on port `8788` succeeded.
- This is not Owner action.

Initial `/order/create` 502:

- Gateway passed REST strings (`Buy`, `ROD`, `Cash`) directly to SDK.
- `kgisuperpy` requires enum objects (`Action.Buy`, `TimeInForce.ROD`, `OrderCond.CASH`).
- Fixed by commit `f2a6da6`.

## Team Instructions

Elva:

- Stop asking Owner to re-confirm SIM authorization.
- Stop deleting `/iuf/kgi/sim_*` params as fake.
- Mark Wave 4 KGI SIM as local round-trip PASS, EC2 SIM blocked by network allowlist.
- Update any board row that says `WAVE3_BLOCKED_KGI_SIM_AUTH`.

Athena:

- Use PR #406 commit `f2a6da6` as the current gateway code state.
- Treat local SIM round-trip as the P0-A evidence.
- Keep production EC2 in live quote mode with `LIVE_ORDER_BLOCKED`.

Bruce:

- Verify against this handoff, PR #406, and production `LIVE_ORDER_BLOCKED`.
- Do not rerun credentialed EC2 SIM login unless KGI confirms EC2 test-host allowlist.

Jason:

- Do not debug SIM auth.
- If touching gateway order code, preserve enum mapping before SDK boundary.

## Verdict

Wave 4 KGI SIM order/callback evidence is green for Owner-local SIM path.
EC2 SIM is a network/allowlist follow-up, not a KGI SIM auth blocker and not an
Owner missing-action blocker.
