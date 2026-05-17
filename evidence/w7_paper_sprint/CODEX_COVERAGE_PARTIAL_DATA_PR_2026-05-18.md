# Codex Coverage Partial Data PR - 2026-05-18

Owner: Codex frontend (`apps/web`)

## Scope

- Harden company detail My-TW-Coverage panels against partial coverage payloads.
- Normalize missing `supplyChain`, `majorCustomers`, `majorSuppliers`, `wikilinks`, and text fields before render.
- Reuse the normalized coverage shape in both `CoverageKnowledgePanel` and `IndustryGraphPanel`.
- Keep partial data honest: missing relation arrays render as empty/omitted states, not fabricated graph edges.

## Safety

- Frontend-only change under `apps/web/app/companies/[symbol]`.
- No backend endpoint changes.
- No broker/risk/contracts edits.
- No KGI live broker write path.
- No real-order promotion or live default.
- No vendor tactical homepage layout changes.

## Verification

- `pnpm.cmd --filter @iuf-trading-room/web typecheck` - PASS
- `pnpm.cmd --filter @iuf-trading-room/web test -- app/companies/[symbol]/coverage-knowledge-panel.test.ts` - PASS, 30 tests
- Browser smoke against local Next dev server on `127.0.0.1:3114` and local mock API on `127.0.0.1:3004`:
  - Desktop `/companies/2330` with partial coverage payload: shows normalized summary/theme data, no company-page error boundary, no page errors, no failed requests.
  - Mobile `/companies/2330` with partial coverage payload: same pass condition.

## Screenshots

- `evidence/w7_paper_sprint/coverage-partial-company-detail-1366x900.png`
- `evidence/w7_paper_sprint/coverage-partial-company-detail-mobile-390x844.png`

## Known Blocker

Production deploy verification remains blocked outside this PR: latest deploy attempts failed because GitHub Actions does not have `SEED_OWNER_EMAIL` / `SEED_OWNER_PASSWORD`. Owner: Jason / repo admin.
