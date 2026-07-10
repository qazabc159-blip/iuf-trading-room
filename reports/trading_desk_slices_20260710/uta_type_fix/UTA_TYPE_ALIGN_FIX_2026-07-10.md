# UTA Orders Type Alignment Fix — 2026-07-10

Bug: Pete #1206 review finding. `apps/web/lib/api.ts`'s `UnifiedOrderEntry`
declared `side`/`quantity`/`orderType`/`simOnly`, none of which exist on the
real backend `UnifiedOrderRecord`
(`apps/api/src/broker/unified-order-store.ts`, uses `action`/`qty`, and has
no per-row sim flag at all). `getUtaOrders()`'s claimed `total` field is also
never sent by the server (`server.ts:22091` responds `{ data: { orders } }`
only). Consumer `apps/web/app/admin/uta/accounts/page.tsx` read the
nonexistent fields, leaving the 方向/數量/安全模式 columns blank in prod.

## Prod verification (before fixing)

`GET https://api.eycvector.com/api/v1/uta/orders?limit=50` with a real owner
session (curl, 2026-07-10):

```json
{"data":{"orders":[]}}
```

Confirms the envelope shape (`{data:{orders}}`, no `total`) and that prod
currently has zero unified orders — no real non-empty row available to
screenshot directly.

## Fix

- `apps/web/lib/api.ts`: `UnifiedOrderEntry` now mirrors the real
  `UnifiedOrderRecord` subset this page renders (`action`, `qty`, no
  `simOnly`); `getUtaOrders()`'s return type drops the phantom `total`.
- `apps/web/app/admin/uta/accounts/page.tsx`: `OrdersTable` reads
  `o.action`/`o.qty` instead of `o.side`/`o.quantity`.
- New `apps/web/app/admin/uta/accounts/uta-order-vocab.ts`: since the backend
  has no per-row sim flag, "安全模式" is derived from `adapterKey` —
  `POST /api/v1/uta/orders`'s zod schema (`server.ts`) only ever accepts
  `adapterKey ∈ {"kgi","paper"}`, and both are hard-locked to SIM/paper at
  the trading-service layer (CLAUDE.md 🔴 真金下單路徑). Any future adapter
  outside that known-locked set renders "待確認" rather than silently
  claiming SIM.

## Evidence

- `uta_accounts_mock_render.png` — full-page render, local `next dev`
  (`NEXT_PUBLIC_API_BASE_URL` pointed at a throwaway local mock HTTP server
  serving `/auth/me` as Owner + fixture `/api/v1/uta/adapters` +
  `/api/v1/uta/orders` shaped exactly like the real `UnifiedOrderRecord`,
  since prod has no real orders to screenshot). KPI strip shows 近期委託=2,
  SIM 委託=2.
- `uta_accounts_orders_table_scrolled.png` — OrdersTable scrolled to reveal
  all 9 columns: 方向 shows 買進/賣出 (green/red badges), 數量 shows
  `1000`/`2`, 安全模式 shows `SIM`/`SIM` — the three previously-blank
  columns all render real values.
- Zero browser console errors during the render (`page.on("console")`
  capture, empty array).
- Mock server + screenshot script were throwaway (`node http` server +
  `@playwright/test` chromium launch script), not committed — this file
  documents the recipe for reproducibility.

## Tests

- `apps/web/app/admin/uta/accounts/uta-order-vocab.test.ts` (new, 5 cases):
  `sideLabel`/`isKnownSimOnlyAdapter`/`safetyModeLabel` pure-function
  coverage.
- `apps/web/lib/api.uta-orders.test.ts` (new, 2 cases): `getUtaOrders()`
  against a mocked fetch shaped like the real prod envelope (including the
  curl-verified empty-array case), asserting `action`/`qty` round-trip and
  `total` is absent.
- Full suite: `pnpm --filter @iuf-trading-room/web test` 549/549 green (+7
  new). `pnpm typecheck` 15/15 green. `pnpm run build:web` green (all routes
  incl. `/admin/uta/accounts`).
