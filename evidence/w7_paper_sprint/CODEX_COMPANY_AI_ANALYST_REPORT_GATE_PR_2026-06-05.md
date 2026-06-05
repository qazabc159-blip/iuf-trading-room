# CODEX_COMPANY_AI_ANALYST_REPORT_GATE_PR_2026-06-05

## Scope

- Company page AI Analyst Report product quality gate.
- Frontend-only prompt/quality/UI guard.
- No broker write path, KGI live order path, S1 SIM runner, migrations, or contracts touched.

## Problem

The company page could show weak AI analyst output as if it were a formal report when the generated text was incomplete, quality-protected, or leaked internal tool labels. A customer-facing report must be complete and readable, not a raw engineering fallback.

## Shipped

- Strengthened `buildCompanyAiAnalystPrompt()` to require complete nine-section Traditional Chinese reports.
- Added a `missing_sections` quality failure so reports missing any fixed section cannot render as formal analysis.
- Updated the AI report panel to show a formal regenerate state for:
  - engineering/tool label leaks
  - missing nine-section report structure
  - quality-protected placeholder output
- Added CI guard `COMPANY-AI-ANALYST-1` to prevent regressions.

## Verified

- `pnpm.cmd --filter @iuf-trading-room/web typecheck`
- `.\node_modules\.bin\vitest.CMD run "app/companies/[symbol]/ai-analyst-report-panel.test.ts"` from `apps/web`
- `pnpm.cmd exec node --import ./tests/setup-test-env.mjs --import tsx --test ./tests/ci.test.ts --test-name-pattern COMPANY-AI-ANALYST-1`
- `pnpm.cmd --filter @iuf-trading-room/web build`

## Notes

- Running the full web test script currently exposes unrelated pre-existing expectation drift in company registry/subscription tests. Targeted AI report tests and root CI guard passed.
- Browser production screenshot should be captured after this PR deploys.
