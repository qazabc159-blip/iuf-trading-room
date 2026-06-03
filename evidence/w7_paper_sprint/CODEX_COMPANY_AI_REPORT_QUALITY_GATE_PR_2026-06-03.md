# Codex Evidence — Company AI Analyst Report Quality Gate

Date: 2026-06-03
Owner: Codex frontend
Scope: Company page AI analyst report product quality

## Why

Yang reported that the company page AI analyst report could show internal tool labels and generic placeholder diagnostics such as `get_market_overview`, `get_news_top10`, `too_short`, and `generic_placeholder_line`. That is not acceptable for a subscription product.

## Change

- Added a pure report-quality gate in `aiAnalystReportQuality.ts`.
- The company page AI report now blocks Markdown rendering when the generated text leaks engineering internals:
  - tool names;
  - run/token fields;
  - generic placeholder reasons;
  - raw/source dump phrasing.
- Blocked reports show a customer-facing regeneration state instead of pretending the text is a formal analyst report.
- Added styling so the state reads as a product quality hold, not a raw error.
- Added unit tests covering clean reports, engineering-leak reports, and quality-protected placeholder reports.

## Verification

Local checks:

```powershell
pnpm.cmd --filter @iuf-trading-room/web test "app/companies/[symbol]/ai-analyst-report-panel.test.ts"
pnpm.cmd --filter @iuf-trading-room/web typecheck
pnpm.cmd --filter @iuf-trading-room/web build
git diff --check
```

Result:

- Focused AI report tests: 29/29 passed.
- Web typecheck: passed.
- Web production build: passed.
- Diff check: passed, with only Windows CRLF conversion warnings.

## Product Boundary

This does not delete or hide the AI analyst feature. It prevents bad generated output from being presented as a formal report, while keeping the user path to regenerate the report. No broker execution, KGI live order path, migrations, contracts, F-AUTO/S1, or Quant Lab code changed.
