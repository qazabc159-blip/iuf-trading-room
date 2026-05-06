# Codex FinMind Quota Truth Surface - 2026-05-07

Status: READY FOR REVIEW

Trade Capability Score: +1

## Why this exists

楊董指出 Sponsor 999 每小時應可呼叫 6,000 次，但 production UI 可能仍顯示 600 或讓人看不出是否被舊環境變數覆寫。這不是 cosmetic：如果 quota / tier 顯示不清楚，團隊無法判斷 FinMind 是沒被呼叫、被限流、還是資料集尚未回補。

## Files

- `apps/web/lib/api.ts`
- `apps/web/app/page.tsx`
- `apps/web/app/market-intel/page.tsx`

## Endpoint / Source

- `GET /api/v1/data-sources/finmind/status`
- `GET /api/v1/diagnostics/finmind`

## Behavior

- Frontend type now understands the backend `global.quotaTier`, `global.rateLimitPerHour`, and `health` diagnostics fields.
- Homepage FinMind panel now shows:
  - token presence
  - used / limit
  - quota tier
  - per-hour limit
  - warning if `Sponsor 999` is lower than 6,000/hr
- Market Intel FinMind section repeats tier / limit / request count so the news/data page can explain whether the bottleneck is quota config or dataset ingestion.
- No token value is displayed.

## Stop-line Proof

- No Railway env value is read or changed.
- No token is rendered.
- No FinMind request is forced by this patch.
- No order, broker, KGI write-side, migration, schema, or destructive DB path is touched.
- No buy/sell wording or strategy metric is added.

## Checks

- `pnpm.cmd --filter @iuf-trading-room/contracts build` PASS
- `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS
- `pnpm.cmd --filter @iuf-trading-room/web build` PASS
- `git diff --check` PASS with CRLF warnings only
- Code-only stop-line grep PASS

## Next

After deploy, use homepage or `/market-intel` to see whether production is reporting `Sponsor 999 / 6,000 per hour`. If it still shows 600, the fix is Railway env cleanup, not frontend code.
