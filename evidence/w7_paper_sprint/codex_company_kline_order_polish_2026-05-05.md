# Codex company K-line / order desk polish - 2026-05-05

## Scope

- Page/component: company workbench K-line + simulated order desk shell.
- Files changed: `apps/web/app/globals.css`, `apps/web/app/companies/[symbol]/OhlcvCandlestickChart.tsx`.
- Endpoint/source used: existing company OHLCV / FinMind Sponsor KBar rows already passed into the company page.

## Behavior

- Company workbench keeps K-line as the main surface.
- Simulated order desk gets a wider rail on large desktop and stacks below K-line earlier to avoid cramped right-side layout.
- Order desk title, source row, lock note, price row, summary strip, quick quantity row, and K-line toolbar get more breathing room.
- K-line toolbar is now a compact tool rail: daily/weekly/monthly, minute K, and range controls are separated instead of appearing like large blocks.
- K-line visible window is widened, especially for FinMind minute K, so users see a useful run of bars instead of a tiny clipped sample.
- Latest price is marked with a chart price line and a compact ribbon, while the right price axis remains visible.
- Minute K state uses green/amber/red truth semantics: live means usable FinMind Sponsor data; empty/blocked explains the reason instead of looking broken.
- No trading logic changed; odd-lot / board-lot guards stay in `apps/web/lib/order-units.ts` and `PaperOrderPanel.tsx`.

## Checks

- `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS.
- `pnpm.cmd --filter @iuf-trading-room/web build` PASS.
- `git diff --check` PASS for `apps/web/app/globals.css`.

## Stop-line proof

- CSS-only.
- No token, no fake data, no schema/migration, no Railway secrets.
- No KGI write-side and no live submit.
