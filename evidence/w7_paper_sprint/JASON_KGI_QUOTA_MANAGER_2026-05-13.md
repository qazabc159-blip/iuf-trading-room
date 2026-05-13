# Jason: KGI 40-slot Subscription Quota Manager + Main Page Realtime Endpoints
**Date**: 2026-05-13
**PR**: feat/api-kgi-quota-manager-mainpage-realtime-2026-05-13
**Owner**: Jason (backend strategy lane)

---

## 1. Summary

Built the KGI subscription quota manager for 凱基新星等級 (2 connections × 20 slots = 40 max).
Also added 4 new server endpoints for main page realtime market data.

---

## 2. New Files

| File | Purpose |
|---|---|
| `apps/api/src/kgi-subscription-manager.ts` | Quota manager — 40 hard cap, LRU swap, holdings/watchlist sync, KGI tick market overview + heatmap |
| `apps/api/src/__tests__/kgi-subscription-manager.test.ts` | 11 unit tests (QM0-QM10) |

## 3. Modified Files

| File | Change |
|---|---|
| `apps/api/src/server.ts` | Quota check in POST /kgi/quote/subscribe + 5 new endpoints |

---

## 4. Budget Allocation

| Tier | Budget | Symbols |
|---|---|---|
| INDEX (permanent) | 2 | ^TWII, ^TPEX |
| STRATEGY (permanent) | 4 | 3707, 2426, 6205, 2486 |
| HOLDINGS (dynamic, LRU) | 5 | 楊董持倉 |
| WATCHLIST (dynamic, LRU) | 10 | 楊董 watchlist |
| CORE (permanent) | 15 | 前 15 權值股 |
| BUFFER (swap pool) | 4 | 剩餘配額 |
| **TOTAL** | **40** | hard cap |

---

## 5. New Endpoints

| Method | Route | Auth | Purpose |
|---|---|---|---|
| GET | `/api/v1/kgi/quote/subscription-status` | Owner | 配額分配 + 連線分佈 + per-symbol last_tick_at |
| POST | `/api/v1/kgi/watchlist/sync` | Owner | 同步 watchlist → subscription pool (LRU swap) |
| POST | `/api/v1/kgi/holdings/sync` | Owner | 同步 holdings → subscription pool (LRU swap) |
| GET | `/api/v1/market/overview/kgi` | All roles | TAIEX + OTC realtime (KGI tick → TWSE EOD fallback) |
| GET | `/api/v1/market/heatmap/kgi-core` | All roles | 核心 24 檔熱力圖 (KGI tick → TWSE EOD fallback) |

## 6. Upgraded Endpoint

`POST /api/v1/kgi/quote/subscribe` — now checks quota before subscribing.
- If quota full: `429 QUOTA_EXCEEDED` with `suggestion` field
- If quota available: proceeds as before, returns `quotaUsed`/`quotaMax` in response

---

## 7. Test Results

```
QM0: constants correct — PASS
QM1: hard cap 41st → quota_exceeded — PASS
QM2: connection distribution ≤ 20 each — PASS
QM3: permanent slots cannot unsubscribe — PASS
QM4: LRU swap BUFFER before WATCHLIST before HOLDINGS — PASS
QM5: syncHoldings add/remove/budget — PASS
QM6: syncWatchlist add/remove/budget — PASS
QM7: idempotent duplicate subscribe — PASS
QM8: subscription status shape — PASS
QM9: market overview KGI shape — PASS
QM10: core heatmap shape — PASS

Total: 11/11 PASS
```

## 8. Build Results

- `contracts build`: GREEN (no changes to contracts)
- `api build (tsc)`: GREEN
- Related tests (quote-realtime-wire, kbar): 19/19 PASS

---

## 9. Hard-line Status

- [x] MAX_SLOTS = 40 enforced (manager level, not bypassable via env)
- [x] No broker.* write (manager uses direct fetch, not kgi-broker.ts)
- [x] No contracts change
- [x] No DB migration
- [x] No TradingView scraping
- [x] Lane boundary maintained (only modified apps/api files)

---

## 10. Assumptions Made

1. KGI gateway `/quote/unsubscribe` endpoint exists at EC2 (`http://43.213.204.233:8787`) — gateway currently has it as stub but logs warn, non-fatal.
2. Index symbols `^TWII` / `^TPEX` are valid KGI subscription symbols — if gateway rejects them, tick data returns null (graceful degradation).
3. Watchlist/holdings budgets (5+10) are hardcoded per 楊董 spec — not configurable via env.
4. Connection assignment is round-robin by index (first 20 → conn_a, next 20 → conn_b).
5. Market overview fallback chain: KGI tick (realtime) → TWSE OpenAPI EOD (free) → null.
