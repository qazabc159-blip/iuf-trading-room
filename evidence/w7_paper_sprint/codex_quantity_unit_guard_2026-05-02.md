# Codex Quantity Unit Guard Closeout — 2026-05-02

## Decision

台股下單單位不可再隱含推斷：

- `SHARE` = 零股股數。`qty=1`, `price=800` => NT$800。
- `LOT` = 整張張數。`qty=1`, `price=800` => 1,000 股 => NT$800,000。

前端、paper backend、KGI mapping 都必須保留 `quantity_unit`，不得把零股單靜默轉成整張單。

## Files

- `packages/contracts/src/paper.ts`
- `apps/web/lib/order-units.ts`
- `apps/web/lib/paper-orders-api.ts`
- `apps/web/components/portfolio/OrderTicket.tsx`
- `apps/web/app/companies/[symbol]/PaperOrderPanel.tsx`
- `apps/api/src/domain/trading/order-intent.ts`
- `apps/api/src/domain/trading/paper-executor.ts`
- `apps/api/src/broker/paper-broker.ts`
- `apps/api/src/domain/trading/paper-to-kgi-mapping.ts`
- `apps/api/src/__tests__/quantity-unit-required.test.ts`
- `apps/api/src/__tests__/paper-executor.test.ts`

## Behavior

- Trading room order ticket defaults to `SHARE` / 零股.
- Trading room submit opens a review modal showing unit, actual shares, price, and notional.
- Company page order panel shows unit math and native confirmation before submit.
- Paper order request schema requires `quantity_unit`.
- `SHARE` rejects `qty >= 1000`.
- Paper executor fills `LOT` by effective shares (`qty * 1000`) and `SHARE` by raw shares.
- Paper broker stores/fills effective share quantity when a generic trading order explicitly uses `LOT`.
- KGI mapping keeps the hard invariant:
  - `SHARE -> oddLot=true`
  - `LOT -> oddLot=false`

## Verification

Passed:

- `pnpm.cmd --filter @iuf-trading-room/contracts build`
- `pnpm.cmd --filter @iuf-trading-room/web typecheck`
- `pnpm.cmd --filter @iuf-trading-room/api typecheck`
- `pnpm.cmd --filter @iuf-trading-room/web build`
- `pnpm.cmd --filter @iuf-trading-room/api build`
- `node --test --import tsx/esm apps/api/src/__tests__/quantity-unit-required.test.ts apps/api/src/__tests__/paper-executor.test.ts`

The unit test suite now explicitly locks:

- `1 SHARE * 800 = 800`
- `1 LOT * 800 = 800,000`
- Missing `quantity_unit` is rejected.
- `SHARE qty=1000` is rejected.
- `SHARE` maps to KGI `oddLot=true`; `LOT` maps to `oddLot=false`.
