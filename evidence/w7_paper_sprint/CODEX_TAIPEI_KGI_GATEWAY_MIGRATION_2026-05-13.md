# Taipei KGI Gateway Migration Evidence - 2026-05-13

Author: Codex
Status: TAIPEI_T3_MEDIUM_GATEWAY_LIVE_WITH_SIM_ROUNDTRIP_PROOF

## Scope

Move KGI gateway runtime from the stopped Tokyo EC2 host to a Taipei AWS EC2
Windows host, reduce compute burn with weekday start/stop automation, and
verify that KGI SIM can login and submit a test order from the new host.

## AWS State

- Old Tokyo instance: `i-0b02f62220f422349`, `ap-northeast-1`, `t3.large`, stopped.
- New Taipei instance: `i-03762861d4ce08932`, `ap-east-2`, `t3.medium`, running.
- New Taipei Elastic IP: `43.213.204.233`.
- KGI gateway health: `http://43.213.204.233:8787/health` returned
  `kgi_logged_in=true` and `account_set=true` after final LIVE restore.

## Cost Schedule

EventBridge Scheduler schedules were created in `ap-east-2`:

- `iuf-kgi-gateway-taipei-weekday-start-0820-tst`
  - `cron(20 8 ? * MON-FRI *)`
  - timezone `Asia/Taipei`
  - target `ec2:startInstances`
- `iuf-kgi-gateway-taipei-weekday-stop-1410-tst`
  - `cron(10 14 ? * MON-FRI *)`
  - timezone `Asia/Taipei`
  - target `ec2:stopInstances`

Holiday-calendar precision is not implemented yet; current version is the
weekday coarse version requested by owner.

## Startup Login Automation

Windows Scheduled Task created on Taipei EC2:

- Task name: `IUF KGI Gateway Live Login On Startup`
- Runs as `SYSTEM` at machine startup.
- Script path: `C:\kgi-gateway\startup_live_login.ps1`
- Behavior:
  - waits for local gateway `/health`
  - reads LIVE KGI credentials from SSM Parameter Store
  - posts `/session/login` with `simulation=false`
  - sets the first returned account
  - writes redacted status to `C:\kgi-gateway-logs\startup_live_login.log`

Manual run proof on 2026-05-13:

- LIVE login: OK, accounts=1
- set-account: OK
- `/health`: `kgi_logged_in=true`, `account_set=true`
- `/order/create` in LIVE session: HTTP 409, preserving live-order block.

## KGI Component / Certificate Fix

Installed and registered KGI Windows dependencies:

- `CGEnvDetectATLx64.dll`
- `KGICGCAPIATL2x64.dll`
- `KGIFSCAPIATL2.dll`
- KGI ServiSign components

Imported the KGI CA certificate with private key into:

- `Cert:\LocalMachine\My`
- `Cert:\CurrentUser\My` under the SSM/SYSTEM context

The temporary PFX object uploaded to S3 was deleted after import. The temporary
SSM parameter `/iuf/kgi/ca_pfx_pwd` was also deleted after import. Remaining KGI
SSM parameters are only:

- `/iuf/kgi/person_id`
- `/iuf/kgi/person_pwd`
- `/iuf/kgi/sim_person_id`
- `/iuf/kgi/sim_person_pwd`

## SIM Round-Trip Proof

From Taipei EC2:

- SIM login: HTTP 200
- SIM set account: HTTP 200
- SIM order: `POST /order/create`
  - symbol: `0050`
  - quantity: 1
  - odd-lot: true
  - response: HTTP 200
  - `sim_only=true`
  - status: `accepted`

Report proof from `/trades`:

- test order id tail: `X0001`
- operation task: `NewOrder`
- operation status: `Success`
- order status: `Submitted`

Earlier SIM report state also showed one prior `0050` test order with `Filled`
and a deal record. No production broker-write proof was changed by this run.

## Railway Cutover

Railway production service `api` variable updated:

- `KGI_GATEWAY_URL=http://43.213.204.233:8787`

Railway deployment after the variable update:

- deployment id: `b1079ff2-ea68-45d9-a3ff-518e7cc6aa65`
- status: `SUCCESS`

## Remaining Follow-Up

- Replace weekday coarse schedule with Taiwan market holiday calendar.
- Decide whether to harden EC2 certificate import as non-exportable in the next
  maintenance pass.
- Consider narrowing gateway port `8787` inbound after Railway egress strategy is
  finalized.
