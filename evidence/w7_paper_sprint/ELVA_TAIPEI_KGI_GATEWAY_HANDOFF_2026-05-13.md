# Elva / Jason / Bruce / Athena Handoff - Taipei KGI Gateway

Date: 2026-05-13
Owner: Codex
Verdict: TAIPEI_KGI_GATEWAY_RUNNING__SIM_ROUNDTRIP_ACCEPTED__RAILWAY_CUTOVER_DONE

## Message To Team

Elva / Jason / Bruce / Athena,

Please update board/memory/evidence to the following verified state. Do not
continue using the old Tokyo IP, localhost, or "EC2 not cut over" language.

Current production gateway state:

- Old Tokyo EC2 `i-0b02f62220f422349` / `54.168.104.148` is stopped.
- New Taipei EC2 `i-03762861d4ce08932` is running as `t3.medium`.
- New Taipei gateway IP is `43.213.204.233`.
- Gateway health is green:
  - `http://43.213.204.233:8787/health`
  - `kgi_logged_in=true`
  - `account_set=true`
- Railway production `api` variable has been cut over:
  - `KGI_GATEWAY_URL=http://43.213.204.233:8787`
- Railway redeploy after env cutover succeeded:
  - deployment `b1079ff2-ea68-45d9-a3ff-518e7cc6aa65`
  - status `SUCCESS`

SIM round-trip proof:

- Taipei EC2 SIM login: HTTP 200.
- Taipei EC2 set-account: HTTP 200.
- Taipei EC2 `POST /order/create` test order:
  - symbol `0050`
  - qty `1`
  - odd-lot `true`
  - response HTTP 200
  - `sim_only=true`
  - status `accepted`
- `/trades` returned report evidence for the latest test order:
  - order id tail `X0001`
  - task `NewOrder`
  - status `Success`
  - order status `Submitted`

Safety proof:

- LIVE session restored after SIM proof.
- LIVE `/order/create` still returns 409, so production broker-write remains blocked.
- Gateway is now daily read-only capable for KGI data and still blocks real order write.
- Temporary PFX object uploaded to S3 for certificate import was deleted.
- Temporary SSM parameter `/iuf/kgi/ca_pfx_pwd` was deleted.
- Remaining KGI SSM params are only person/sim credentials already required for gateway runtime.

Cost-control automation:

- Taipei start schedule enabled:
  - `iuf-kgi-gateway-taipei-weekday-start-0820-tst`
  - `cron(20 8 ? * MON-FRI *)`
  - timezone `Asia/Taipei`
- Taipei stop schedule enabled:
  - `iuf-kgi-gateway-taipei-weekday-stop-1410-tst`
  - `cron(10 14 ? * MON-FRI *)`
  - timezone `Asia/Taipei`
- This is the coarse weekday version. Taiwan market holiday calendar is a follow-up.

Startup automation:

- Windows Scheduled Task on Taipei EC2:
  - `IUF KGI Gateway Live Login On Startup`
- It waits for gateway `/health`, reads LIVE credentials from SSM, logs in
  `simulation=false`, and sets the first account.
- Manual run succeeded and wrote redacted log to:
  - `C:\kgi-gateway-logs\startup_live_login.log`

Evidence source:

- Primary evidence memo:
  - `evidence/w7_paper_sprint/CODEX_TAIPEI_KGI_GATEWAY_MIGRATION_2026-05-13.md`

Required board updates:

- Elva: update release board from partial/blocker to Taipei gateway live with SIM round-trip accepted.
- Jason: stop treating KGI SIM as blocked by Tokyo allowlist; any remaining product work should assume `KGI_GATEWAY_URL` is Taipei.
- Bruce: verify external health, SIM report evidence, LIVE 409 block, and Railway env cutover.
- Athena: update memory/state so future agents do not regress to stale Tokyo IP or localhost conclusions.

Remaining follow-ups:

- Replace weekday coarse schedule with Taiwan trading-day calendar.
- Narrow `8787` ingress once Railway egress strategy is finalized.
- Consider non-exportable certificate import hardening in a later maintenance pass.
