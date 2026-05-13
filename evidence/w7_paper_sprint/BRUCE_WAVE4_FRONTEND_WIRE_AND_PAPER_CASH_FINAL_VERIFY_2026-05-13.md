# BRUCE WAVE 4 — Frontend Wire + Paper Cash Final Verify

**Date**: 2026-05-13  
**Verifier**: Bruce  
**PRs**: #418 (frontend wire) + #419 (paper cash 10M)  
**DeploymentId**: 4eac1da7-6231-466f-945d-e26e1ad8ef58  
**StartedAt**: 2026-05-13T08:54:16.710Z (16:54 TST)  
**Market**: Post-close (KGI gateway stopped 14:10 TST, EOD fallback active)  
**Auth**: Owner session re-authenticated (POST /auth/login)

---

## Segment A — PR #418 Frontend Wire (EOD Fallback Path)

### A1. Homepage main page — not blank, market index present

- GET `https://app.eycvector.com/` → HTTP 200, RSC length 94,735 bytes
- TAIEX label `TAIEX` present in RSC (ticker tape, `tac-tape-item`)
- TAIEX value `41898.32` is CSR-loaded (not in SSR RSC — expected for `use client` component)
- API probe: `GET /api/v1/market/overview/kgi` → HTTP 200
  - `source: twse_openapi_eod`
  - `sourceState: fallback_eod`
  - `taiex.value: 41898.32` (yesterday's close, 2026-05-12T13:30:00+08:00)
  - `otc.value: null` (TPEX no composite API — known expected)
- **VERDICT: PASS** — block not blank; API returns valid EOD data

### A2. Heatmap — dual tab + off-hours state

- RSC confirmed `核心熱力圖` tab at offset 40366 and `全市場熱力圖` tab at offset 40469
- Tab navigation href `?heatmap=all` present
- `GET /api/v1/market/heatmap/kgi-core` → HTTP 200
  - `tiles_total: 19, tiles_with_price: 0` (all null, off-hours expected per spec)
  - `source: kgi_tick`
- `GET /api/v1/market/heatmap/twse` → HTTP 200
  - `industries: 87, source: twse_openapi` (full market EOD, has data)
- SSR heatmap state: `marketState=BLOCKED, reason=資料延遲（timeout_3000ms_market）`
  - `sourceLabel: 即時連線維護中，目前顯示昨日收盤` (decoded from UTF-8 bytes confirmed)
  - Note: `即時` appears only in maintenance notice context, not as a price claim
- **VERDICT: PASS** — dual tabs present; KGI tiles=0 off-hours expected; TWSE 87 industries live

### A3. Individual stock quote — 2330

- GET `https://app.eycvector.com/companies/2330` → HTTP 200, 943,750 bytes RSC
- `2330` in RSC: True (not blank)
- `收盤` found in page content (correct wording off-hours)
- `真即時` bytes: NOT found (PASS)
- `/api/v1/companies/2330` → HTTP 200
- `/api/v1/companies/2330/quote` → HTTP 404 (route not registered; company page uses full-profile endpoint)
- **VERDICT: PASS** — page renders with data, correct wording, not blank

### A4. Watchlist UI

- `GET /api/v1/watchlist` → HTTP 404 (no standalone watchlist route)
- `/api/v1/kgi/watchlist/sync` exists (POST only, sync-to-pool)
- PR #418 page.tsx: no MAX_WATCHLIST cap constant found in page.tsx source
- Cockpit endpoint returns `watchlist: []` with `stale_reason: no_watchlist_table`
- **VERDICT: CAVEAT** — standalone watchlist UI not yet wired; no cap enforcement visible in PR #418; backend pool sync exists but no frontend add-cap UI; watchlist is empty/no-table state

---

## Segment B — PR #419 Paper Cash Unified 10M

### B1. `GET /api/v1/portfolio/preview`

```json
{"cash":10000000,"positions":0,"readiness":"preview-only","note":"紙上預覽,不連真實券商"}
```
- HTTP 200
- `cash: 10,000,000` ✓
- `note: 紙上預覽,不連真實券商` preserved ✓
- **VERDICT: PASS**

### B2. `GET /api/v1/paper/portfolio`

```json
{"data":[],"summary":{"baseCapitalTWD":10000000,"currency":"TWD","simulated":true,"paperMode":true,...}}
```
- HTTP 200
- `baseCapitalTWD: 10,000,000` ✓
- `simulated: true, paperMode: true` ✓
- **VERDICT: PASS**

### B3. `GET /api/v1/trading/balance?accountId=paper-default`

```json
{"data":{"accountId":"paper-default","currency":"TWD","cash":10000000,"availableCash":10000000,"equity":10000000,...}}
```
- HTTP 200
- `cash: 10,000,000` ✓ (Railway env `PAPER_BROKER_INITIAL_CASH=10000000` effective)
- **VERDICT: PASS**

### B4. Frontend portfolio page display

- GET `https://app.eycvector.com/portfolio` → HTTP 200, 12,740 bytes RSC
- `10,000,000` string NOT in RSC (CSR-loaded — portfolio numbers are client-side)
- `模擬資金` not found in RSC (CSR component)
- `真即時`, `即時報價` forbidden wording: NOT found (PASS)
- Caveat: portfolio dollar display is CSR, cannot verify 10M display via curl. API layer confirms 10M (B1/B2/B3 all pass). UI will show 10M when CSR loads the correct API.
- **VERDICT: PASS (API layer)** / **CAVEAT (CSR display not verifiable via curl)**

---

## Segment C — Regression

| Check | Result |
|-------|--------|
| C1. `/health` deploymentId=4eac1da7 | PASS (confirmed 4eac1da7-6231-466f-945d-e26e1ad8ef58) |
| C2. `/api/v1/briefs?date=2026-05-13` 200 published | PASS (11 briefs, 2026-05-13 = published) |
| C3. `/api/v1/lab/strategy/cont_liq_v36/snapshot` 200 v47 | PASS (schema=tr_strategy_snapshot_api_contract_v47, source=local_embedded) |
| C4. audit-logs broker 24h = 0 | PASS (count=0) |
| C5. Wording firewall — main/portfolio/lab | PASS (真即時 not found in any page RSC; 即時 only in maintenance label context) |

---

## Hard-Line Status

| Hard Line | Status |
|-----------|--------|
| prod broker write 24h = 0 | PASS (audit-logs broker=0) |
| 0 forbidden wording in UI/response | PASS (真即時 not found; 即時 only in maintenance notice) |
| 0 hardcode capital fixture remaining | PASS (PR #419 removed 20,000 hardcode; env-driven 10M confirmed) |
| regression 5 conditions PASS | PASS |

---

## Still Blocked

1. **Watchlist UI cap enforcement** (Segment A4) — no standalone watchlist GET route; no 10-item cap UI in PR #418; watchlist feature is in pool-sync only state. Not a blocker for paper cash or frontend wire.
2. **Portfolio CSR display** (Segment B4) — 10M confirmed at API layer; cannot verify formatted string in browser via curl (CSR component). Not a regression — prior state was also CSR-only.
3. **TAIEX value CSR-loaded** — expected for `use client` component; API confirmed value 41898.32 via overview endpoint.
4. **Heatmap kgi-core SSR timeout** — `timeout_3000ms_market` on SSR path; tiles served as empty[] in SSR, CSR loads live. This is the known off-hours state, not a new regression.

---

## Verdict

**WAVE4_FRONTEND_AND_CASH_PASS_WITH_CAVEATS**

- Segment A: 3 of 4 PASS (watchlist UI caveat — no cap enforcement wired, no standalone route)
- Segment B: 4 of 4 PASS at API layer (CSR display not verifiable via curl)
- Segment C: 5 of 5 PASS
- All hard lines: PASS

## Next Fix

- **Watchlist UI** (A4): Not in PR #418 scope per code review. If cap enforcement is required, it needs a dedicated frontend + backend route. Owner = Codex/Jim.
- No P0 blockers. Main line is releasable.

## Owner

Bruce

## Evidence File

`evidence/w7_paper_sprint/BRUCE_WAVE4_FRONTEND_WIRE_AND_PAPER_CASH_FINAL_VERIFY_2026-05-13.md`
