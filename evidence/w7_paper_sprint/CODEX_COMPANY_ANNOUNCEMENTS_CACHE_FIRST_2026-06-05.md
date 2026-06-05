# Codex Company Announcements Cache-First Fix - 2026-06-05

## Problem

Company important announcements were empty for every checked company.

Production before this fix:

- `GET /api/v1/companies/2330/announcements?days=365` -> `DEGRADED / twse_upstream_non_json`
- `GET /api/v1/companies/6202/announcements?days=365` -> `DEGRADED / twse_upstream_non_json`
- `GET /api/v1/companies/2603/announcements?days=365` -> `DEGRADED / twse_upstream_non_json`

Root cause: the company route called the old per-ticker TWSE live fetch directly. When TWSE returned non-JSON/HTML, every company page showed an empty degraded announcement panel even though the product already has an official `tw_announcements` cache table and a maintained `t187ap11_L` ingest path.

## Fix

- The formal company announcements route now reads `tw_announcements` first.
- If the cache has no rows, it falls back to the maintained `fetchAllTwseMaterialAnnouncements()` chain (`t187ap11_L` primary, `t187ap46_L` fallback), then filters by ticker.
- The old direct per-ticker route is moved behind `/api/v1/internal/legacy/companies/:id/announcements` so product pages do not depend on it.
- Empty official announcements remain explicit `EMPTY / no_official_company_announcements`; media/news are not used to fake official filings.

## Verification

- `pnpm.cmd --filter @iuf-trading-room/api typecheck` PASS
- `pnpm.cmd exec node --import ./tests/setup-test-env.mjs --import tsx --test ./tests/ci.test.ts --test-name-pattern COMPANY-ANN` PASS
  - The command executed the full `ci.test.ts` suite in this shell context: 518/518 PASS.

## Guardrail

Added `COMPANY-ANN-P0-GATE-1` to ensure the formal company announcements route remains cache-first and does not directly call deprecated per-ticker TWSE fetch.
