# Codex Full-Site QA + Mobile KGI Copy Fix — 2026-05-18

## Baseline

- Production commit checked: `de7e8bc fix(api): repair prod contract p0 surfaces (#693)`
- Deploy run checked: `26028351482` — success
- API health: `https://api.eycvector.com/health` returned `200`
- Open PRs at start: none
- QA mode: authenticated owner-session browser scan via CDP, desktop `1366x900` and mobile `390x844`

## Production routes scanned

23 route/viewport combinations:

- Desktop: `/`, `/market-intel`, `/ai-recommendations`, `/portfolio`, `/companies`, `/companies/2330`, `/quant-strategies`, `/lab/three-strategy`, `/lab/three-strategy/cont_liq_v36`, `/m`, `/heatmap`, `/news`, `/admin/brain/llm`, `/admin/events`, `/admin/tools`, `/admin/uta/accounts`, `/admin/strategies`
- Mobile: `/`, `/m`, `/ai-recommendations`, `/companies/2330`, `/portfolio`, `/admin/uta/accounts`

Raw scan artifacts:

- `evidence/w7_paper_sprint/prod-full-site-qa-2026-05-18-de7e8bc-auth/qa-results.json`
- `evidence/w7_paper_sprint/prod-full-site-qa-2026-05-18-de7e8bc-auth/qa-important.json`

## What is working

- No sampled route rendered the Next.js not-found page.
- `/heatmap` and `/news` redirect to `/market-intel` instead of 404.
- No sampled route had document-level horizontal overflow.
- Homepage, AI recommendations, company page, portfolio, quant strategy list/detail, Brain admin, EventLog admin, Tools admin, UTA admin, and strategy admin all render populated surfaces.
- `/admin/brain/llm` no longer crashes and shows Brain LLM content.
- `/admin/uta/accounts` keeps SIM/read-only safety wording and does not expose a live-order action.

## Issues found

### Fixed in this PR — raw KGI errors shown to users

`/m` displayed backend payload fragments directly in the quote cells when KGI ticks returned 422/503:

- `{"error":"SY...`
- `{"error":"GA...`

This is not fake data, but it is bad product behavior. Users should see a safe market-data state, not raw gateway or allowlist errors.

Fix:

- Added a small whitelist copy helper for KGI quote failures.
- `/m` now maps failures to short Traditional Chinese labels:
  - 422 / `SYMBOL_NOT_ALLOWED` → `未開放`
  - 5xx / `GATEWAY_UNREACHABLE` / timeout → `讀取暫停`
  - auth failures → `需重新登入`
  - unknown failure → `暫無報價`
- `cont_liq_v36` now reuses the same helper for non-OK quote responses, so research strategy badges also avoid raw HTTP/backend text.

Verification artifacts:

- `evidence/w7_paper_sprint/mobile-kgi-friendly-errors-2026-05-18/mobile-m-kgi-friendly-errors-smoke.json`
- `evidence/w7_paper_sprint/mobile-kgi-friendly-errors-2026-05-18/mobile-m-kgi-friendly-errors.png`
- `evidence/w7_paper_sprint/mobile-kgi-friendly-errors-2026-05-18/mobile-m-kgi-friendly-errors-quotes.png`

### Still open — KGI quote backend/gateway availability

Several pages still receive KGI quote failures from production:

- `/m`: 422 for `0050`, 503 for `2330` / `2454`
- `/portfolio`: 503 for `2330` ticks/bidask through the web proxy
- `/companies/2330`: 503 for ticks/bidask
- `/lab/three-strategy/cont_liq_v36`: 422/503 for strategy quote symbols

The pages render instead of going blank, and this PR makes the visible copy safe. The actual KGI quote availability is still owned by the Jason/KGI gateway/API lane.

### Still open — stale or fallback data states

- `/m` latest brief is explicit that the brief is based on `2026-05-15` and is stale by 3 days.
- `/lab/three-strategy` still states it is using Athena fallback/research forward-observation data. This is honest copy, not fake data, but it should not be treated as a production trading signal.
- `/market-intel` renders an honest empty/live-state shell when today-selected content is unavailable.

Owners:

- OpenAlice/news freshness: Elva/Jason
- Athena strategy freshness: Athena/Jason
- KGI quote availability: Jason/KGI gateway

## Verification run for this PR

- `pnpm.cmd install --offline --frozen-lockfile`
- `pnpm.cmd --filter @iuf-trading-room/contracts build`
- `pnpm.cmd --filter @iuf-trading-room/web exec vitest run app/m/MobileKgiWatchlist.test.ts` — 4/4 pass
- `pnpm.cmd --filter @iuf-trading-room/web typecheck` — pass
- `pnpm.cmd --filter @iuf-trading-room/web build` — pass, with existing Sentry/OpenTelemetry warning only
- Local browser smoke on `/m` with intercepted 422/503 quote responses — pass:
  - raw JSON/error code hidden
  - `未開放` / `讀取暫停` visible
  - screenshot captured

## Bottom line

The site is no longer in the earlier “production blocker / migration broken / route 404” state. The sampled product surfaces mostly render. The biggest current product-quality issue I could safely fix from the frontend is raw KGI quote error leakage, and this PR fixes it while preserving no-fake-data behavior.
