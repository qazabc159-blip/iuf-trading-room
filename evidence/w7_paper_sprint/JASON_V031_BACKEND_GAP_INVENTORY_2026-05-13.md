# v0.3.1 Backend Gap Inventory
**Author**: Jason (backend-strategy lane)
**Date**: 2026-05-13
**Purpose**: Codex writes server-side payload injection in `final-v031-live.ts`. This document maps what each screen needs vs what already exists, and confirms which gaps were filled.

---

## How `final-v031-live.ts` Works

Three payload builders, each called by `buildFinalV031LivePayload(screen)`:
- `buildMarketIntelPayload()` — Market Intel screen
- `buildIdeasPayload()` — Strategy Ideas screen
- `buildPaperPayload()` — Portfolio / Paper Trading Room screen

---

## Screen 1: Market Intel (`/market-intel`)

### Endpoints Already Called by Codex

| Endpoint | Status | Shape |
|----------|--------|-------|
| `GET /api/v1/market-intel/news-top10` | EXISTS | `{ data: { items[], input_row_count, ai_call_success, selection_mode, as_of, next_refresh_at } }` |
| `GET /api/v1/market-intel/announcements?days=30&limit=20&scope=market` | EXISTS | `{ data: { items[], failures } }` |
| `GET /api/v1/internal/finmind/status` | EXISTS | `{ data: { state, datasets[], updatedAt } }` |

### What the Payload Builds

```ts
{
  screen: "market-intel",
  generatedAt,
  stats: { total, aiSelected, sourceOk, sourceTotal: 4, nextRefresh },
  topicCounts: { all, ai, semi, fin, auto },
  items: [{ symbol, name, title, source, tag, why, age, category, rank }],
  sources: [{ name, label, state, status, fresh }],
  readiness: { coverage, freshness, reviewQueue }
}
```

### Gap Analysis

**`sourceTotal: 4` but only 3 sources are wired**. The fourth source is implied (主管機關公告) and hard-coded as `state: "warn"`. This is acceptable — Codex already accounts for it.

**漲跌家數 / advance-decline** is NOT used by `buildMarketIntelPayload()`. The market intel screen's readiness bar only uses coverage/freshness/reviewQueue derived from existing data. No breadth data is consumed by this screen's payload builder.

**Gap confirmed**: No missing endpoint for Market Intel. The existing 3 endpoints are sufficient for the current payload shape.

---

## Screen 2: Strategy Ideas (`/ideas`)

### Endpoints Already Called by Codex

| Endpoint | Status | Shape |
|----------|--------|-------|
| `GET /api/v1/strategy/ideas?decisionMode=paper&includeBlocked=true&limit=12&sort=score` | EXISTS | `StrategyIdeasView` — full shape including rationale, quality, marketData, topThemes |

### What the Payload Builds

```ts
{
  screen: "strategy-ideas",
  generatedAt,
  summary: { total, allow, review, block, bullish, bearish, neutral, quality },
  items: [{ symbol, companyName, sector, meta, decision, status, direction, score,
            confidence, completeness, signalCount, latest, reason, missing, themes, delta }],
  selected: items[0]
}
```

### Gap Analysis

**Ideas detail page**: The `setIdeaDetail()` JS function in the hydration script renders detail from the list item shape — it does NOT call a `/ideas/:id` endpoint. All fields (`reason`, `themes`, `completeness`, `signalCount`, `marketData.decision`) are already in the list response.

**Source-backed evidence**: The list item `reason` field maps from `item.rationale.primaryReason || item.primaryReason || item.marketData.primaryReason`. Already in shape.

**Gap confirmed**: No missing endpoint for Ideas. The existing `/api/v1/strategy/ideas` returns the full detail shape. The main runtime issue is KGI bars quality gate (bars quality = insufficient when KGI not live during market hours) — this is a data availability issue, not a missing endpoint.

**Note for Codex**: When `quality.grade === "insufficient"` the `completeness` score will be low (20-30%). This is correct behavior, not a bug.

---

## Screen 3: Portfolio / Paper Trading Room (`/portfolio`)

### Endpoints Already Called by Codex

| Endpoint | Status | Shape |
|----------|--------|-------|
| `GET /api/v1/paper/health` | EXISTS | `PaperHealthState` |
| `GET /api/v1/paper/portfolio` | EXISTS | `{ data: PortfolioPosition[], summary }` |
| `GET /api/v1/paper/fills` | EXISTS | `{ data: PaperFillLedgerRow[] }` — FILLED only |
| `GET /api/v1/paper/orders` | EXISTS | `{ data: PaperOrderState[] }` — all statuses |
| `GET /api/v1/portfolio/kgi/positions` | EXISTS | `{ data: { source, status, positions[], fetchedAt } }` |
| `GET /api/v1/strategy/ideas?decisionMode=paper&...` | EXISTS | (see Ideas above) |
| `GET /api/v1/companies/:ticker` | EXISTS | company detail |
| `GET /api/v1/companies/:id/quote/realtime` | EXISTS | quote |
| `GET /api/v1/kgi/bidask/:symbol` | EXISTS | bid/ask |
| `GET /api/v1/kgi/ticks/:symbol` | EXISTS | tick history |
| `GET /api/v1/companies/:id/ohlcv?interval=1d` | EXISTS | OHLCV bars |

### What the Payload Builds

```ts
{
  screen: "paper-trading-room",
  generatedAt, health, selected: { symbol, name, sector, price, open, high, low, close,
    previous, change, changePct, ohlcv, bidAsk, ticks, quoteState },
  watchlist: [{ symbol, name, meta, price, changePct }],
  ideas, portfolio, orders, fills, kgi, ohlcv, bidAsk, ticks
}
```

### Gap Analysis

**Paper trade history (all statuses)**: `listPaperOrders()` already calls `GET /api/v1/paper/orders` which returns all statuses. The `orders` field in payload is complete.

**Fills by order**: `GET /api/v1/paper/fills` returns FILLED-only. Adequate for fills display.

**Gap identified — `GET /api/v1/paper/portfolio/history`**: Codex may want a single endpoint that returns full order history with status, fill details, and timestamps for a trade history log. The existing endpoints cover this via `paper/orders` + `paper/fills` but a unified history endpoint is cleaner for display.

---

## Gaps Filled (this session)

### Gap 1 — `GET /api/v1/market/breadth/twse` (NEW)

**Why**: Although `buildMarketIntelPayload()` doesn't call breadth currently, Codex may want to add a breadth widget (漲跌家數) to the market intel screen. The existing `/api/v1/breadth` uses `companies_ohlcv` DB which may be stale/empty after market close or backfill gaps. This new endpoint hits TWSE STOCK_DAY_ALL live data.

**Shape**:
```json
{
  "up": 847,
  "down": 412,
  "flat": 63,
  "total": 1322,
  "topGainers": [{ "code": "2330", "name": "台積電", "close": 870.0, "change": 7.0, "changePct": 0.81, "tradeValue": 6234567890 }],
  "topLosers": [...],
  "topVolume": [...],
  "asOf": "2026-05-13T13:30:00+08:00",
  "source": "twse_openapi",
  "staleAfterSec": 60
}
```

**Implementation**: `getTwseMarketBreadth()` added to `apps/api/src/data-sources/twse-openapi-client.ts`. Route registered at `GET /api/v1/market/breadth/twse`.

**Cache**: 60-second in-memory cache (`_breadthCache`). Fail-open: returns `{ up:0, down:0, flat:0, total:0, ... }` on TWSE failure.

### Gap 2 — `GET /api/v1/paper/portfolio/history` (NEW)

**Why**: Codex's portfolio screen shows `orders` (all statuses) and `fills` (FILLED only) separately. A unified history endpoint is cleaner for a trade history log component. Returns all orders with status, fill detail, and timestamps in one call.

**Shape**:
```json
{
  "data": [
    {
      "orderId": "uuid",
      "symbol": "2330",
      "side": "buy",
      "orderType": "limit",
      "qty": 1,
      "quantity_unit": "SHARE",
      "status": "FILLED",
      "fillQty": 1,
      "fillPrice": 870.0,
      "fillTime": "2026-05-13T10:30:00.000Z",
      "createdAt": "2026-05-13T09:00:00.000Z",
      "idempotencyKey": "key"
    }
  ],
  "summary": { "totalOrders": 5, "totalFills": 3, "currency": "TWD", "simulated": true }
}
```

**Implementation**: Route registered at `GET /api/v1/paper/portfolio/history`. Thin adapter over existing `listOrders()` — no new storage, no DB migration.

---

## Endpoints Codex Can Use for v0.3.1

### Market Intel Screen
| Endpoint | Data | Auth |
|----------|------|------|
| `GET /api/v1/market-intel/news-top10` | AI精選新聞 | READ_DRAFT_ROLES |
| `GET /api/v1/market-intel/announcements` | 官方公告 | READ_DRAFT_ROLES |
| `GET /api/v1/internal/finmind/status` | FinMind狀態 | Owner |
| `GET /api/v1/market/overview/twse` | TAIEX指數 | READ_DRAFT_ROLES |
| `GET /api/v1/market/overview/kgi` | KGI即時指數→TWSE fallback | READ_DRAFT_ROLES |
| `GET /api/v1/market/breadth/twse` | **NEW** 漲跌家數+top20 | READ_DRAFT_ROLES |
| `GET /api/v1/breadth` | 漲跌家數 (from OHLCV DB) | READ_DRAFT_ROLES |

### Ideas Screen
| Endpoint | Data | Auth |
|----------|------|------|
| `GET /api/v1/strategy/ideas` | 策略候選列表 (full detail shape) | READ_DRAFT_ROLES |
| `GET /api/v1/vendor/strategy/ideas` | 精簡 vendor shape | READ_DRAFT_ROLES |
| `GET /api/v1/strategy/ideas/ai-rerank` | AI重排序候選 | READ_DRAFT_ROLES |
| `GET /api/v1/strategy/brief-commentary` | 策略摘要 | READ_DRAFT_ROLES |

### Portfolio Screen
| Endpoint | Data | Auth |
|----------|------|------|
| `GET /api/v1/paper/health` | Paper系統健康 | any auth |
| `GET /api/v1/paper/portfolio` | 持倉快照 | any auth |
| `GET /api/v1/paper/fills` | 成交記錄(FILLED only) | any auth |
| `GET /api/v1/paper/orders` | 所有委託 | any auth |
| `GET /api/v1/paper/portfolio/history` | **NEW** 完整交易歷史 | any auth |
| `GET /api/v1/portfolio/kgi/positions` | KGI真實持倉 | Owner only |
| `GET /api/v1/portfolio/preview` | 簡易預覽 | READ_DRAFT_ROLES |
| `GET /api/v1/trading/balance` | 帳戶餘額 | READ_DRAFT_ROLES |
| `GET /api/v1/trading/accounts` | 帳戶列表 | READ_DRAFT_ROLES |

---

## Hard-Line Status

- No `apps/web/*` touched
- No `broker/*` touched
- No contracts changed
- No DB migration
- No `risk-engine.ts` touched
- No `market-data.ts` core touched
- Build: GREEN (tsc clean)
- Tests: 247/247 PASS

---

## Files Changed

1. `apps/api/src/data-sources/twse-openapi-client.ts` — Added `getTwseMarketBreadth()`, `TwseMarketBreadthResult`, `TwseBreadthStockRow` types, `_resetTwseBreadthCache()` test helper
2. `apps/api/src/server.ts` — Added `GET /api/v1/market/breadth/twse` + `GET /api/v1/paper/portfolio/history` (strategy route block)
