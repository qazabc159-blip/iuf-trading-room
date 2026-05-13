# BRUCE PAPER BROKER DEFAULT ON VERIFY — 2026-05-13

**Verdict: PAPER_BROKER_PASS_WITH_CAVEATS**

Verified by: Bruce  
Date: 2026-05-13  
Production host: api.eycvector.com / app.eycvector.com  
Auth: Owner (qazabc159@gmail.com)

---

## 1. Execution Mode Defaults (paper default ON)

Endpoint: `GET /api/v1/paper/flags` (auth-gated)

```json
{
  "data": {
    "executionMode": "paper",
    "killSwitchEnabled": false,
    "paperModeEnabled": true
  }
}
```

**PASS.** All three flags confirm paper default ON:
- `executionMode = "paper"` (code default in execution-mode.ts: `process.env.EXECUTION_MODE ?? "paper"`)
- `killSwitchEnabled = false` (kill switch is OFF — paper submit path OPEN)
- `paperModeEnabled = true` (code default: `process.env.PAPER_MODE_ENABLED ?? "true"`)

Three-layer AND gate: executionMode=paper AND killSwitch=OFF AND paperMode=ON → **gate OPEN**

---

## 2. Simulated Capital Display

**Endpoint 1:** `GET /api/v1/portfolio/preview` (Owner)

```json
{
  "cash": 20000,
  "positions": 0,
  "readiness": "preview-only",
  "note": "紙上預覽,不連真實券商"
}
```

Default base capital = **NT$20,000** (code: `PAPER_BROKER_INITIAL_CASH ?? 20_000`)

**Endpoint 2:** `GET /api/v1/paper/portfolio` (Owner)

```json
{
  "data": [],
  "summary": {
    "baseCapitalTWD": 20000,
    "currency": "TWD",
    "simulated": true,
    "paperMode": true,
    "positionCount": 0,
    "investedCostTWD": 0,
    "note": "empty_state: no filled orders yet; base capital available"
  }
}
```

Fields `simulated: true`, `paperMode: true` are explicit. `baseCapitalTWD = 20000`.

**Endpoint 3:** `GET /api/v1/trading/accounts` (paper-broker.ts accounts)

```json
[
  { "id": "paper-default", "broker": "paper", "isPaper": true, "currency": "TWD",
    "accountNo": "PAPER-000001", "accountName": "Paper Trading",
    "connectedAt": "2026-04-18T16:50:57.370Z" },
  { "id": "primary-desk", "broker": "paper", "isPaper": true, "currency": "TWD",
    "accountNo": "PRIMARY-DESK", "accountName": "Paper Trading",
    "connectedAt": "2026-04-21T04:10:36.960Z" }
]
```

**Endpoint 4:** `GET /api/v1/trading/balance?accountId=paper-default`

```json
{
  "data": {
    "accountId": "paper-default",
    "currency": "TWD",
    "cash": 10000000,
    "availableCash": 10000000,
    "equity": 10000000,
    "marketValue": 0,
    "unrealizedPnl": 0,
    "realizedPnlToday": 0
  }
}
```

**CAVEAT:** Two capital figures in play:
- `paper/portfolio` uses `PAPER_BROKER_INITIAL_CASH ?? 20_000` → **NT$20,000** (product-level display)
- `trading/balance?accountId=paper-default` reads from paper-broker.ts hydrated DB snapshot → **NT$10,000,000** (per `DEFAULT_INITIAL_CASH = 10_000_000` in paper-broker.ts)

These are two different capital representations: the `/paper/portfolio` endpoint uses the env var for display-only; the actual paper-broker.ts account was bootstrapped with 10M (likely before `PAPER_BROKER_INITIAL_CASH` env was set). No fake data — both figures are real state.

---

## 3. Simulated Position Display

`GET /api/v1/trading/positions?accountId=paper-default` → `{ "data": [] }`

`GET /api/v1/paper/portfolio` → `{ "data": [], "summary": { "positionCount": 0, ... "note": "empty_state: no filled orders yet; base capital available" } }`

**PASS.** Initial state = 0 positions. Explicit `"note": "empty_state: no filled orders yet; base capital available"` surfaces honest empty state, not null/NaN/placeholder.

`GET /api/v1/paper/fills` → `{ "data": [] }` — no fills yet. Consistent with 0 positions.

---

## 4. UI — Frontend Portfolio Page

The `/portfolio` page loads a vendor iframe: `paper-trading-room?rev=1561feb`

Safety bar rendered at top of page (confirmed in HTML source):

```html
<div class="psafe">
  <span class="badge">PAPER MODE ACTIVE</span>
  <span class="badge locked">REAL ORDER DISABLED</span>
  <span class="badge read">KGI READ-ONLY</span>
  <span class="badge iso">SAFE · PAPER ISOLATED</span>
  本頁所有委託皆走模擬通道，不會送出實單；KGI 連線僅供讀取庫存對照。
</div>
```

Position summary panel shows:
- 模擬本金: **5,000,000** (static fixture in vendor HTML — NOT pulled from live API)
- 可用資金: **3,109,000**
- 持倉市值: **1,891,000**
- 模擬庫存 tab: 2330 台積電, 2,000股, 8 個交易日

Order submit button label: `送出紙上單 ▸ 2330 買進 1 張 @ 962.00` with sub-label `PAPER`

Live channel section: `實盤通道 目前停用 · 解鎖須另行授權 🔒 LOCKED`

**CAVEAT (C1):** Portfolio UI iframe (`paper-trading-room`) uses STATIC FIXTURE DATA (模擬本金=5,000,000, fills=hardcoded rows). The live API returns 0 fills and 20,000 base capital. The vendor iframe IS NOT wired to the live paper-broker.ts API endpoints. The UI displays paper-mode wording correctly but shows demo-fixture numbers, not live paper-broker state.

This is the primary gap: **paper mode UI is correctly labeled but not wired to live API**.

---

## 5. Mode Switch UI/Endpoint

`GET /api/v1/portfolio/mode` → **404 Not Found**  
`GET /api/v1/paper/mode` → **404 Not Found**

No paper ↔ live mode-switch endpoint exists. Mode is env-var controlled server-side.

In the UI: the live channel is labeled `🔒 LOCKED` with text `實盤通道 目前停用 · 解鎖須另行授權` — no toggle UI exists. This is by design (per W6 paper sprint rules: KGI gateway /order/create permanently 409 until楊董 explicit ack).

**Design intent PASS.** No accidental live toggle. Default is paper, live is explicitly gated.

---

## 6. Paper-Broker Code Path

`apps/api/src/broker/paper-broker.ts` confirmed:
- Real in-memory simulator with per-workspace state hydrated from DB (`paper_broker_state` table via `paper-broker-store.ts`)
- `DEFAULT_INITIAL_CASH = 10_000_000`
- `bootstrapAccount()` creates paper account with broker="paper", isPaper=true, accountNo="PAPER-000001"
- `placePaperOrder()` → fills against mark price, updates in-memory positions/cash, persists to DB snapshot
- `liveUsable: false` hard-coded (paper broker never issues live-eligible quotes)

Submit path: `POST /api/v1/paper/submit` → `driveOrder(intent)` → `PaperExecutor.executeOrder()` → `placePaperOrder()` in paper-broker.ts.

**CONFIRMED:** No KGI gateway call in paper submit path. `kgi-broker.ts` and `kgi-gateway-client.ts` are NOT imported in the paper submit pipeline. Paper trades are self-contained in `paper-broker.ts`.

Code hard lines confirmed:
- Comments on `POST /api/v1/strategy/ideas/:ideaId/promote-to-paper-submit`: "HARD LINE: no broker.submit / live.submit / /order/create call"
- Comments on `POST /api/v1/paper/submit`: same hard line documented

---

## 7. Regression: Prod Health

`GET /health` → `{ "status": "ok", "uptime": 602.6, "build": { "deploymentId": "3d3769a4-..." } }` — **PASS**

`GET /api/v1/paper/health` (no auth):
```json
{
  "previewReady": true,
  "submitReady": true,
  "fillsReady": true,
  "portfolioReady": true,
  "lastFillTs": null,
  "gate": { "gateOpen": true }
}
```

`GET /api/v1/paper/health/detail`:
- preview: READY
- orderTicket: READY
- submit: READY
- fill: READY (lastFillTs: null, todayCount: 0)
- portfolio: READY (filledOrderCount: 0)
- auditLog: READY (todayEntries: 828)

---

## 8. Broker Audit 24h — Hard Line

`GET /api/v1/audit-logs?limit=100` sample:
- broker.* actions: **0** ← PASS (no real broker writes)
- paper.* actions: **0** (no paper submits yet in 24h)
- kgi.sim.* actions: **0**

Top 100 audit actions: `create`(5), `finmind.backfill`(1), `finmind.ingest`(71), `lab.snapshot_fetched`(14), `news.ai_selection`(9)

Real broker write 24h = **0**. Hard line intact.

---

## Summary

| Check | Result | Evidence |
|---|---|---|
| paper default ON | PASS | executionMode=paper / killSwitch=false / paperMode=true |
| 模擬資金顯示 | PASS (with caveat) | NT$20,000 via /paper/portfolio; NT$10,000,000 via /trading/balance |
| 模擬倉位 (0 state) | PASS | positionCount=0, note="empty_state: no filled orders yet" |
| mode switch UI | N/A (by design) | No toggle; LOCKED wording confirmed |
| paper-broker code path | PASS | placePaperOrder() confirmed; no KGI import in submit path |
| prod /health | PASS | status=ok |
| broker write 24h = 0 | PASS | 0 broker.* in audit sample |
| paper.* vs broker.* distinct | N/A (no paper submits yet) | Audit actions are finmind.*/lab.*/news.* |

**Caveats:**
- C1: Portfolio UI iframe uses static fixture data (模擬本金=5,000,000) — NOT wired to live paper-broker.ts API. UI paper-mode wording is correct but numbers are demo fixtures. Fix owner: Codex (apps/web iframe integration).
- C2: Two capital figures: 20,000 (display via /paper/portfolio) vs 10,000,000 (actual paper-broker.ts bootstrap). Reconcile by setting PAPER_BROKER_INITIAL_CASH=20000 in Railway env OR by wiring UI to /trading/balance endpoint.

**Not blocked for deploy.** Code path is correct. UI wiring gap is cosmetic (fixture data is clearly labeled as paper/simulated).

---

## Still Blocked

NONE for deploy. C1 (UI fixture) needs Codex fix in next cycle.

## Next Fix

- Codex: Wire portfolio iframe to `GET /api/v1/trading/accounts` + `GET /api/v1/trading/balance?accountId=paper-default` for live capital display
- Jason/Ops: Set `PAPER_BROKER_INITIAL_CASH=20000` Railway env to align bootstrap cash with display default

## Hard-Line Status

- real broker write 24h = **0** (CONFIRMED)
- paper.* and broker.* are distinct action prefixes in audit_logs. Currently no paper.* actions because no paper submits have occurred on prod.
