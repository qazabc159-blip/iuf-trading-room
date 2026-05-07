# Codex OpenAlice Producer Theme Quality Filter

Time: 2026-05-07 07:20 TPE
Branch: `fix-openalice-skip-placeholder-themes-2026-05-07`
Trade Capability Score: `+1`

## Why

Production logs after #255 showed OpenAlice drafts are now auto-approved, but the worker still selected cleanup themes such as `[BROKEN-*]` and `[DEPRECATED]` for theme summaries, review summaries, and signal clusters. That makes the homepage and daily brief look stale or useless even when automation is running.

## Change

- Added `apps/worker/src/jobs/theme-quality.ts` with a shared production-theme filter.
- Worker producers now skip cleanup/deprecated/placeholder themes and priority `<= 0` themes before building operator-facing content.
- Covered:
  - `theme-summary-producer`
  - `review-summary-producer`
  - `daily-theme-summary-producer`
  - `daily-brief-producer`
  - `company-note-producer` linked-theme context
  - `signal-cluster-producer`
- Daily theme summary OpenAI prompt now asks for Traditional Chinese and explicitly forbids buy/sell instructions, target prices, guarantees, Sharpe, win-rate, and strategy performance claims.

## Sources / Semantics

- Source: `themes`, `theme_summaries`, `company_notes`, `company_theme_links`, worker OpenAlice producers.
- State semantics: invalid cleanup data is not deleted and not called an error; it is excluded from automated operator-facing generation so live automation focuses on production themes.
- No fake-live data is introduced.

## Checks

- Worker typecheck: PASS
- Worker build: PASS
- API typecheck: PASS
- Theme-quality unit test via compiled worker output: PASS
- Diff check: PASS

## Stop-Lines

- No token value displayed or logged.
- No `/order/create`.
- No KGI write-side.
- No migration/schema/destructive DB change.
- No fake daily brief.
- No buy/sell recommendation.
- No strategy metric.
