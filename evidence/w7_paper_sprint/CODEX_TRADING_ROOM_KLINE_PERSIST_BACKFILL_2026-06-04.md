# Trading Room K-Line Persistent Backfill

Date: 2026-06-04
Owner: Codex frontend/product rescue lane

## Problem

Trading Room could still fall back to sparse daily K-line history after cache expiry because long FinMind backfill was only cached in Redis. If `companies_ohlcv` still had a tiny partial set, the product could regress toward a 3-candle view on a later load.

## Fix

- Keep the existing real-data gate: official Taiwan daily requests must not render fake or tiny sparse K-line charts as normal product data.
- When FinMind returns enough real daily history, cache it for the immediate response and asynchronously upsert it into `companies_ohlcv`.
- Persist only real FinMind/TEJ-sourced bars (`source: "tej"`), never mock rows.
- Use `onConflictDoUpdate` on `(company_id, dt, interval)` so repeated backfills refresh the same rows instead of duplicating data.
- Run persistence in the background so the Trading Room can draw the chart without waiting for hundreds or thousands of DB writes.

## Files

- `apps/api/src/companies-ohlcv.ts`
- `apps/web/lib/final-v031-paper-ticket.test.ts`

## Verification

- Guard test asserts:
  - long FinMind chunking remains enabled;
  - sparse official Taiwan daily data does not become a fake product chart;
  - FinMind daily backfill is persisted with `onConflictDoUpdate`;
  - only `source: "tej"` rows are written as real OHLCV.

## Product Impact

First successful deep K-line fetch now improves the durable company OHLCV store. This reduces repeat user-visible failures where the Trading Room reloads and only shows a handful of candles.
