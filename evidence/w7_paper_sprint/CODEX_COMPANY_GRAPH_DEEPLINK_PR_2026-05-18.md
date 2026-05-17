# Codex Company Graph Deeplink PR - 2026-05-18

Owner: Codex frontend (`apps/web`)

## Scope

- Make `/companies?tab=graph&q=2330` a usable deeplink: the graph search input is prefilled from `q` and runs the existing company graph search endpoint.
- Keep graph search URL state in sync when the operator types or clicks a top keyword chip.
- Add a company detail My-TW-Coverage footer CTA back into the full graph search for the current ticker.
- Fix company detail Coverage/Industry mini-graph client fetches to use `NEXT_PUBLIC_API_BASE_URL` instead of accidentally calling the web origin.

## Safety

- Frontend-only change under `apps/web`.
- No broker/risk/contracts edits.
- No KGI live broker write path.
- No real-order promotion or live default.
- No fake graph data added to the app; browser smoke used a local mock API only.
- Vendor tactical homepage layout untouched.

## Verification

- `pnpm.cmd --filter @iuf-trading-room/web typecheck` - PASS
- `git diff --check` - PASS, with existing Windows LF/CRLF warnings only
- Browser smoke against local Next dev server on `127.0.0.1:3113` and local mock API on `127.0.0.1:3003`:
  - `/companies?tab=graph&q=2330` desktop: input value `2330`, result shows `score 98.4`, no page errors or failed requests.
  - `/companies/2330` desktop: My-TW-Coverage panel loads backend coverage data and CTA href is `/companies?tab=graph&q=2330`.
  - `/companies?tab=graph&q=2330` mobile: input value `2330`, result shows `score 98.4`, no page errors or failed requests.

## Screenshots

- `evidence/w7_paper_sprint/company-graph-deeplink-q-1366x900.png`
- `evidence/w7_paper_sprint/company-graph-deeplink-detail-1366x900.png`
- `evidence/w7_paper_sprint/company-graph-deeplink-mobile-390x844.png`

## Known Blocker

Production deploy verification is still blocked outside this PR: latest `deploy.yml` runs for `650cd77` and `7bea36e` failed because GitHub Actions does not have `SEED_OWNER_EMAIL` / `SEED_OWNER_PASSWORD`. Owner: Jason / repo admin.
