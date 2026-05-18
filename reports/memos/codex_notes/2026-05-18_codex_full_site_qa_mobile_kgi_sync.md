# 2026-05-18 Codex Full-Site QA Sync

## Latest merged state

- `origin/main`: `de7e8bc fix(api): repair prod contract p0 surfaces (#693)`
- Open PRs: none at cycle start.
- Production health observed during QA: API `/health` returned 200 in the previous pass; `/heatmap` and `/news` redirect to `/market-intel` instead of 404.

## QA signal from production browser pass

- No app-level crash, no Next not-found page, no broad mojibake, and no document-level horizontal overflow across the sampled desktop/mobile routes.
- Core surfaces are populated: homepage heatmap, company page, portfolio/trading room, AI recommendations, quant pages, and admin pages render instead of blank pages.
- Repeated backend/gateway failures remain visible in network calls: KGI ticks/bidask 422/503 on `/m`, `/portfolio`, `/companies/2330`, and strategy detail pages.

## Blocked items and owners

- KGI quote 422/503 root cause: Jason/KGI gateway/API lane.
- Three-strategy pages still disclose Athena fallback/stale snapshot state: Athena/Jason quant data lane.
- Market Intel has honest empty/live-state copy, but today-selected news quality still depends on backend ingest and AI selector freshness: Elva/Jason news lane.

## Chosen frontend-safe task

Fix `/m` mobile KGI watchlist so raw backend JSON/error codes like `{"error":"SYMBOL_NOT_ALLOWED"}` and gateway messages are never shown directly to users. The UI should keep the no-fake-data blocked state, but display short Traditional Chinese product copy such as `未開放`, `讀取暫停`, or `暫無報價`.
