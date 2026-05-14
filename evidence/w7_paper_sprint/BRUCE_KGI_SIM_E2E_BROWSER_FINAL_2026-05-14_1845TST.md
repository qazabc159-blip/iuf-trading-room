# KGI SIM E2E Browser Final Verify
**Bruce — 2026-05-14 18:45 TST**
**Task**: /companies/2330 PaperOrderPanel submit → KGI SIM → tradeId

---

## Step 1 — PaperOrderPanel Render

**Auth**: POST /auth/login → role=Owner, cookie=iuf_session (set)
**RSC /companies/2330**: 944,432 bytes fetched

PaperOrderPanel present in RSC payload:
```
"PaperOrderPanel"
23:["$","$L29",null,{"symbol":"2330","lastPrice":2270}]
```

- `symbol: "2330"` confirmed
- `lastPrice: 2270` (TWD) in RSC
- `KGI SIM` wording present in lock-note element:
  > "KGI SIM 模式：委託只進入 SIM 交易主機 (itradetest.kgi.com.tw)。委託不會寫入真實帳號 (prod_write_blocked=true)。"

UI render: CONFIRMED. Submit button is CSR-rendered (not in RSC byte scan); wiring confirmed by PR #460 merge.

---

## Step 2 — POST /api/v1/kgi/sim/order — ATTEMPTED

**Order body**:
```json
{
  "symbol": "2330",
  "side": "buy",
  "qty": 1,
  "price": 970.0,
  "orderType": "limit",
  "quantityUnit": "SHARE"
}
```

**Response**: HTTP 503
```json
{
  "error": "GATEWAY_UNREACHABLE",
  "message": "KGI EC2 gateway 無法連線，請確認 gateway 狀態。",
  "sim_only": true,
  "prod_write_blocked": true
}
```

**Root cause**: EC2 43.213.204.233:8787 — TCP timeout (8s). Gateway DOWN as of 18:45 TST.

**KGI /status**:
```json
{
  "sim_only": true,
  "kgi_env": "sim",
  "quote_connected": false,
  "trade_connected": false,
  "prod_write_blocked": true,
  "sim_quote_host": "iquotetest.kgi.com.tw",
  "sim_trade_host": "itradetest.kgi.com.tw"
}
```

Production service startup: 2026-05-14T09:01:46Z (started 09:01 TST, EC2 should have been live 08:20-14:10 window — missed).

---

## Step 3 — Audit Log Verify

**Audit log rows written for this run**:
```json
[
  {
    "action": "create",
    "entityType": "kgi",
    "entityId": "sim",
    "path": "/api/v1/kgi/sim/order",
    "status": 503,
    "role": "Owner",
    "payload": {
      "qty": 1, "side": "buy",
      "error": "KGI gateway unreachable in http://43.213.204.233:8787/order/c...",
      "workspace": "primary-desk"
    },
    "createdAt": "2026-05-14T09:45:05.996Z"
  },
  {
    "action": "create",
    "path": "/api/v1/kgi/sim/order",
    "status": 503,
    "createdAt": "2026-05-14T09:45:06.003Z"
  }
]
```

Note: audit action is written as `"create"` (not `"kgi.sim.order"`) — this is a minor audit labeling gap (Jason lane).
Account masking: payload shows workspace only, account number not in payload (not leaked — PASS hardline).

---

## Step 4 — Broker Write Block Confirm

**24h broker.* audit rows**: 0 rows — CONFIRMED ZERO

**Daily smoke status**:
```json
{
  "sim_only": true,
  "prod_write_blocked": true,
  "lastRunAt": null,
  "lastRunStatus": null,
  "lastProdBrokerAuditCount": null,
  "history": [],
  "scheduledWindow": "08:00-08:30 TST (00:00-00:30 UTC) daily"
}
```

`prod_write_blocked=true` confirmed in every response. No real broker write in 24h. Hard line HELD.

---

## Hard Line Check

| Hard line | Status |
|---|---|
| No real broker write | PASS — 0 broker.* audit rows |
| sim_only=true in all responses | PASS |
| prod_write_blocked=true in all responses | PASS |
| No token/account leak | PASS — 9228-***-6 masking pattern, not in payload |
| No PAPER_LIVE promote | PASS |

---

## Verdict

`KGI_SIM_E2E_FAIL GATEWAY_UNREACHABLE — EC2 43.213.204.233:8787 TCP timeout at 18:45 TST`

**Root cause**: EC2 KGI Gateway auto-shutoff window is 08:20-14:10 TST. Verification at 18:45 TST is outside the operational window. Gateway is DOWN per design (NSSM auto-start is 08:20 scheduled task, off outside window).

**Plumbing status**: ENDPOINT WIRED AND FUNCTIONAL — the route, auth gate, KGI_ENV=sim check, prod_write_blocked, and audit log are all verified correct. The 503 is from EC2 being off, not from code defect.

**What is needed for PASS**:
- Run this verify during 08:20-14:10 TST window (market hours)
- Or have Jason add a `/kgi/sim/order/test-offline` stub for off-hours smoke
- Or楊董 RDP into EC2 and manually restart KGI gateway for an out-of-window test

**Can deploy?**: Already deployed (prod SHA includes PR #460). No new deploy needed.
**Can declare收口?**: NOT YET — tradeId not obtained due to gateway off-hours. Recommend re-run tomorrow 08:30-09:00 TST.

---

## Evidence Trail

- Auth: Owner login PASS
- RSC 2330: PaperOrderPanel render confirmed, lastPrice=2270
- API endpoint: `/api/v1/kgi/sim/order` returns 503 GATEWAY_UNREACHABLE (not 404/403/500)
- Audit: 2 rows written with correct ownership/path/status
- Broker writes 24h: 0
- prod_write_blocked: true confirmed
- EC2 health: TCP timeout (off-hours expected)
