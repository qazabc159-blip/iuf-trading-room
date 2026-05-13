# Codex Evidence - KGI SIM Local Verification

Date: 2026-05-13
Owner: Codex
Scope: KGI SIM `/order/create` gateway branch and TR regression tests

## What Codex Verified

- Created a detached verification worktree at:
  - `C:\Users\User\Desktop\小楊機密\交易\IUF_TRADING_ROOM_APP__sim_verify`
- Checked out commit:
  - `8277231 feat(gateway): unlock SIM /order/create path (P0-A 2026-05-13)`
- Confirmed the branch exists remotely:
  - `origin/feat/gateway-unlock-sim-order-p0a-2026-05-13`

## Gateway Test Results

Command:

```powershell
py -3 -m pytest services/kgi-gateway/tests/test_order_gate.py -q
```

Result:

```text
15 passed in 0.50s
```

Command:

```powershell
py -3 -m pytest services/kgi-gateway/tests -q
```

Result:

```text
85 passed in 0.85s
```

## TR Regression Test Results

Command:

```powershell
pnpm.cmd test
```

Result:

```text
252 passed, 0 failed
```

Notes:

- Local test output included FinMind HTTP 400 / token warning because this workstation test run does not provide a production token. The token string was redacted as `<REDACTED>`.
- KGI SIM daily smoke / order-report unit tests intentionally exercise failure cases without real gateway credentials; all DS1-DS4 and ORT1-ORT4 tests passed.

## Gate Behavior Confirmed from Source

`services/kgi-gateway/app.py` implements three gates:

1. No session -> `409 NOT_LOGGED_IN`
2. Live session -> `409 LIVE_ORDER_BLOCKED`
3. SIM session -> validates body, calls SDK, returns `200` with `sim_only=true`

`services/kgi-gateway/schemas.py` defines `OrderCreateResponse.sim_only` as a hard `Literal[True]`.

## What This Does Not Prove

- It does not prove live EC2 SIM order round-trip. That still requires deployment and an actual SIM-only POST to the KGI test host.
- It does not prove callback/report receipt. Bruce/Jason still need live SIM evidence after deploy.
- It does not authorize production broker write.

## Next Required Owner Proof

Jason / Athena / Elva should now run:

1. Deploy `feat/gateway-unlock-sim-order-p0a-2026-05-13` to the EC2 KGI gateway.
2. Restart gateway.
3. POST SIM-only 0050 1-share or minimum supported test order.
4. Capture:
   - `sim_only=true`
   - accepted response or SDK error classification
   - callback/report received
   - production broker write count = 0
   - token leakage false

## Hard Lines

- no real order: held
- no production broker write: held
- no registry state change: held
- no IUF_SHARED_CONTRACTS edit: held
- no token leakage: held
- no approved / alpha confirmed / live-ready wording: held
