# 2026-05-19 Codex company ticker lookup P0 start

- Latest `origin/main`: `9a99307 fix(web): clarify quant score pending state (#729)`.
- Open PRs at handoff: none.
- Production state checked this morning: API health OK, migration status synced at 43/43 after Yang set `RAILWAY_MIGRATION_REQUIRED=1`.
- Cross-team notes:
  - Elva/Jason own AI recommendation v3 non-fallback root cause.
  - Bruce should verify production click paths, especially portfolio order symbol after search.
  - Mike watches schema/migration drift only; this task is web-only.
- Chosen frontend-safe task for this cycle:
  - Fix `/companies/2330` degraded page by resolving detail pages through `GET /api/v1/companies?ticker=2330` instead of broad `GET /api/v1/companies`.
  - Reason: direct API ticker lookup is known-good, while the current detail page blocks before panels render if the broad list endpoint or SSR cookie path fails.
- Hardlines:
  - No mock company data.
  - No broker write path.
  - No homepage tactical redesign.
