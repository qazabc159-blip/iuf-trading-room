# BRUCE_KGI_LIVE_READ_ONLY_PASS — 2026-05-08

**Status**: PASS  
**Environment**: FORMAL (simulation=false)  
**Signed by**: Bruce (verifier/release) — HL2 dual-signature GRANTED  
**Date**: 2026-05-08  
**Scope**: KGI live read-only gate — 正式環境 quote/subscribe 通路；write-side 零觸碰  

---

## §1 楊董 Verbatim Evidence (11 conditions)

| # | Condition | Result |
|---|---|---|
| 1 | kgi_logged_in=true | PASS |
| 2 | account_set=true | PASS |
| 3 | quote_disabled_flag=false | PASS |
| 4 | POST /quote/subscribe/tick → ok=true, label=tick_2330 | PASS |
| 5 | POST /quote/subscribe/bidask → ok=true, label=bidask_2330 | PASS |
| 6 | POST /quote/subscribe/kbar → ok=true, label=kbar_2330 | PASS |
| 7 | GET /quote/ticks?symbol=2330 → 真實盤中 tick (多筆成交) | PASS |
| 8 | GET /quote/bidask?symbol=2330 → 真實五檔 bid/ask | PASS |
| 9 | GET /quote/kbar?symbol=2330 → 真實 K-bar | PASS |
| 10 | source: simulation=false (正式環境確認) | PASS |
| 11 | NO /order/create / NO position native / NO submit | PASS |
| 12 | NO password 洩漏 chat/evidence/repo | PASS |

**All 12 conditions PASS. Zero stop-line triggered.**

---

## §2 Bruce HL2 Dual-Signature — GRANTED

**Gate conditions for HL2 signature:**

| Condition | Status |
|---|---|
| 10/10+ evidence items PASS | PASS (12/12) |
| Write-side endpoints NOT called (zero /order/create / cancel-place / submit) | PASS |
| Zero mutation confirmed (no balance change / no position write) | PASS |
| /position NOT called in 200-OK form (either 503 containment or absent) | PASS |

**Bruce HL2 signature**: GRANTED  
**Gate unlocked**: IUF API `/api/v1/companies/:id/quote/realtime` 可從 BLOCKED 升至 Windows gateway live read-only data  
**Gate NOT unlocked**: live order submission / /order/create / any write-side KGI endpoint  

---

## §3 Schema Correction — subscribe body

**正確版 (楊董 2026-05-08 verbatim 糾正)**:

```json
{ "symbol": "2330" }
```

**錯誤版 (Bruce/Jason 舊 runbook 寫法，已作廢)**:

```json
{ "symbols": ["2330"] }
```

### Jason 後端 bridge 需修正的對應點

| 位置 | 舊錯誤 schema | 正確 schema |
|---|---|---|
| subscribe/tick request body | `symbols: string[]` | `symbol: string` (singular) |
| subscribe/bidask request body | `symbols: string[]` | `symbol: string` (singular) |
| subscribe/kbar request body | `symbols: string[]` | `symbol: string` (singular) |

如果 IUF API `/api/v1/kgi/quote/subscribe/*` 對應的 proxy 仍帶 array body，需要 Jason 修正 bridge layer 的 request forwarding shape。修正範圍：`apps/api/src/` 內 kgi proxy handler（Bruce 不動，交 Jason）。

### 其他 endpoint shape 確認（正確，不需改）

| Endpoint | Query/Body | Status |
|---|---|---|
| GET /quote/ticks | ?symbol=2330 | CORRECT |
| GET /quote/bidask | ?symbol=2330 | CORRECT |
| GET /quote/kbar | ?symbol=2330 | CORRECT |

---

## §4 Stop-Line Check

| Stop-Line | Check | Result |
|---|---|---|
| SL-01: cash_order_path | /order/create NOT called | HELD |
| SL-02: read_only_guard | KGI_READ_ONLY_MODE=true 正式環境預設; mutation expect 403 | HELD |
| SL-03: broker write-side | 0 write-side KGI SDK call in evidence | HELD |
| SL-04: no password in repo/chat | 楊董 verbatim 確認 | HELD |
| SL-05: simulation=false confirmed | 正式環境明確標示 | HELD |
| SL-06: no position write | /position native NOT called | HELD |

**6/6 stop-lines HELD. Zero triggered.**

Containment layer status (per memory_kgi_live_readonly_checklist_pattern.md):
- `read_only_guard.py` default = true (explicit opt-out required for writes)
- `/order/create` dual protection: @require_read_only (403) + W1 409 fallback
- Both layers verified intact per earlier code audit

---

## §5 Next Step Authorization

**AUTHORIZED by this PASS:**

IUF API path `GET /api/v1/companies/:id/quote/realtime`:
- Current state: BLOCKED (gateway_unreachable)
- Post-this-PASS state: May be upgraded to live read-only data via Windows gateway tunnel
- Owner: Jason (bridge wire implementation)
- Bruce gate needed before wire: schema correction §3 must land first

**STILL PROHIBITED (not unlocked by this PASS):**

- POST /order/create (any path)
- Live order submission to KGI
- /cancel / /place / any write-side mutation
- /position in 200-OK form (503 containment must remain)
- Calling KGI write-side SDK methods from IUF API

---

## §6 Evidence Traceability

| Item | Value |
|---|---|
| Verified by | 楊董 verbatim 12-condition report |
| Date | 2026-05-08 |
| Environment | simulation=false (正式環境) |
| Symbol tested | 2330 (TSMC) |
| Operator | 楊董 (live session, no raw credential in evidence) |
| Bruce sign-off | HL2 GRANTED |
| Schema correction source | 楊董 verbatim correction same session |
| Cross-copy | IUF_QUANT_LAB/evidence/w7_paper_sprint/ |
