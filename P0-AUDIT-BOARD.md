# IUF Trading Room P0 Audit Board

時間: 2026-05-18 20:25 TST  
Audit owner: Codex frontend  
Base commit: `5fb641f` (`fix(api): preserve company names in v3 fallback (#697)`)  
Deploy: `Deploy to Railway` run `26031744549`, success  
API health: `https://api.eycvector.com/health` = 200  
Open PR: 0

## Audit Rule

這份 board 是今晚 P0 收斂的作戰地圖。沒有這份 board，不做大改；任何 UI 區塊只能是正式資料、明確 degraded/empty/pending state，或直接不顯示。不得用 mock/fake 冒充 live。

Evidence:

- Route scan JSON: `evidence/w7_paper_sprint/p0-audit-board-2026-05-18/prod-route-scan.json`
- API scan JSON: `evidence/w7_paper_sprint/p0-audit-board-2026-05-18/prod-api-scan-summary.json`
- Screenshots: `evidence/w7_paper_sprint/p0-audit-board-2026-05-18/screens/`

## Production API Snapshot

| Capability | Endpoint | Result | Product meaning |
|---|---|---:|---|
| API health | `/health` | OK | Prod API alive. |
| AI stock recommendations | `/api/v1/recommendations/today` | 200, 4 items | Opens, but below Yang minimum 5. |
| AI recommendation v3 SOP | `/api/v1/ai-recommendations/v3` | 404 `no_v3_run_yet` | v3 run not materialized in prod. |
| AI selected news | `/api/v1/market-intel/news-top10` | 200, 10 items | News selector exists and returns items. |
| Official announcements | `/api/v1/market-intel/announcements?days=30&limit=20&scope=market` | 200, 0 items, `source=empty` | Official announcement lane has empty state; not enough for market-intel completeness. |
| Portfolio snapshots | `/api/v1/portfolio/snapshots?limit=20` | 404 | Admin snapshot page has a broken backend route. |
| Event streams | `/api/v1/event-streams` | 200, 0 streams | Route alive, but EventLog is effectively empty. |
| Tool registry | `/api/v1/tools/registry?isActive=true` | 200, 12 tools | ToolCenter backend exists. |
| Tool calls | `/api/v1/tools/calls?limit=50` | 200, 50 calls | Tool execution history exists. |
| Tool stats | `/api/v1/tools/stats?window=24h` | 200, 8 stats | ToolCenter has real stats. |
| UTA adapters | `/api/v1/uta/adapters` | 200, 2 adapters | UTA adapter registry exists. |
| UTA orders | `/api/v1/uta/orders?limit=50` | 200, 0 orders | UTA orders empty; must show formal empty/read-only state. |
| Quant Lab snapshot | `/api/v1/lab/three-strategy/snapshot` | 200, 3 strategies, `READ_ONLY_FIXTURE_API` | Read-only fixture-backed lane, not production trading signal. |
| KGI core heatmap | `/api/v1/market/heatmap/kgi-core` | 200, 40 tiles | Core heatmap exists, uses 05/15 TWSE EOD when KGI off-hours. |
| Market overview heatmap | `/api/v1/market-data/overview` | 200, 180 heatmap rows | Still includes English sectors from provider data; violates heatmap P0 rule. |

## Route / Capability Board

| Route | Page title | Opens | Blank | Fake data | Old UI | Wrong route | Mobile misload | Main function | Endpoint / wrapper | Data state | P0 issue | Owner | Fix approach | Planned PR |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `/` | 交易戰情台 | Yes | No after full wait | No mock seen | No | No | No | Dashboard, heatmap, market, paper workflow, AI/news summary | `getKgiMarketOverview`, `getKgiCoreHeatmap`, `getTwseMarketHeatmap`, paper health, brief/intel APIs | PARTIAL | Heatmap all-market still has English sector contamination; need confirm AI Top 3 is visible above fold or in command rail. | Codex + Jason | Keep layout; repair data grouping and add clear AI Top 3 if absent. | PR-B then PR-A |
| `/market-intel` | 市場情報 | Yes | No | No mock seen | Uses final-v031 iframe | No | No | AI selected news, source status, announcements, heatmap entry | `/api/ui-final-v031/market-intel`, `/api/v1/market-intel/news-top10`, `/api/v1/market-intel/announcements` | PARTIAL | AI news visible, but official announcements lane is empty and freshness/source copy needs stricter owner/next action; iframe makes text scan brittle. | Codex + Jason | Keep iframe if stable; make source panels explicit and add manual refresh/status visibility. | PR-A / PR-B |
| `/ai-recommendations` | AI 推薦 | Yes | No | No mock seen | No | No | No | AI stock recommendations, detail link, portfolio handoff | `/api/v1/recommendations/today`, `/api/v1/recommendations/:id`, feedback proxy | BROKEN/PARTIAL | Only 4 recommendations; Yang requires at least 5. v3 endpoint returns `no_v3_run_yet`. Buckets show research labels, not the exact product language requested. | Codex + Jason | Trigger/materialize v3 or strengthen v1 fallback to 5+ real-backed items; expose exact product buckets and no “all insufficient” state. | PR-A |
| `/ai-recommendations/[id]` | Recommendation detail | Not fully audited | Unknown | No mock allowed | No | Unknown | Unknown | Detail, trace, feedback, handoff | `/api/v1/recommendations/:id`, `/api/recommendations/:id/feedback` | NEEDS QA | Must verify every card has entry/stop/TP1/TP2/reason/risk/data quality and feedback wiring. | Codex | Use one real id from today response and browser-smoke detail/feedback. | PR-A |
| `/ideas` | Redirect alias | Yes | No | No | No | Redirects intentionally | No | Legacy alias to AI recommendations | `next.config.ts` redirect to `/ai-recommendations` | LIVE | Acceptable if Yang agrees `/ideas` is no longer standalone; otherwise needs product copy. | Codex | Keep redirect and document alias, or make `/ideas` a filtered AI rec view. | PR-A |
| `/portfolio` | 交易室 | Yes | No | No mock seen | Final-v031 trading room | No | No | Search, quote, K-line, indicator toggles, paper order preview/submit shell, paper/KGI labels | `/api/ui-final-v031/paper-trading-room`, KGI ticks, paper endpoints | PARTIAL | Visual is usable, but arbitrary ticker search, paper preview, paper submit, cancel/order/fill flow still need scripted proof. | Codex + Bruce | Run owner-session flow proof; fix missing endpoint states, not UI redesign. | PR-C |
| `/companies` | 公司圖譜 | Yes | No | No mock seen | No | No | No | Company list, themes radar entry | companies list + themes endpoints | PARTIAL | Needs click-flow audit for theme radar -> detail -> back. | Codex | Browser flow and route redirects for old/mobile routes. | PR-E |
| `/companies/[symbol]` (`2330`) | 公司頁 | Yes | No | No mock seen | No | No | No | Company profile, quote, K-line, coverage, graph, AI analyst report | `/api/v1/companies/:ticker/*`, KGI ticks/bidAsk, Brain React run | PARTIAL | No blank panel in first viewport, but KGI tick/bidAsk can 422/503 off-hours; AI analyst generate/display still needs click proof. | Codex + Jason | Every panel must show LIVE/DEGRADED/COMING_SOON_DISABLED with source/owner; verify AI report action. | PR-D |
| `/themes` | 主題頁 | Yes | No | No mock seen | No | No | No | Theme index and company links | `/api/v1/themes/index`, `/api/v1/themes/:token/companies` | PARTIAL | Route bug from company theme radar to theme detail/back is not yet proven fixed. | Codex | Manual click flow; add redirects away from old/mobile theme pages. | PR-E |
| `/quant-strategies` | 量化策略 | Yes | No | No mock seen | No | `/lab` redirects here | No | SIM-only strategy list, subscriptions | Lab strategy API + local strategy config | PARTIAL | Page opens, but strategy statuses/performance/risk need full wording audit against “no trading advice.” | Codex + Athena | Reduce red/error styling to real blockers only; prove detail route. | PR-F |
| `/lab` | Lab alias | Yes | No | No | No | Redirects to `/quant-strategies` | No | Legacy alias | `permanentRedirect("/quant-strategies")` | LIVE | Acceptable alias if navigation copy is clear. | Codex | Document in routing board. | PR-E |
| `/lab/*` | Lab strategy detail | Yes | No | No mock seen, fixture declared | No | No | No | Three-strategy truth board and read-only forward observation | `/api/v1/lab/three-strategy/*`, KGI ticks | PARTIAL/BROKEN | `cont_liq_v36` triggers KGI tick 422/503 for multiple symbols; UI says read-only but still creates noisy failed fetches. | Codex + Jason | Fail-soft quote polling, no raw network noise, clear off-hours/blocked reason per row. | PR-F |
| `/alerts` | 警示通知 | Yes | No | No mock seen | No | No | No | Alerts and unread state | alert/event APIs | PARTIAL | Needs source/last updated/empty-state proof. | Codex | Route smoke and empty-state hardening if needed. | PR-F |
| `/signals` | 訊號頁 | Yes | No | No mock seen | No | No | No | Signal list | signal/recommendation/event data | PARTIAL | Needs endpoint list and no “fake signal” proof. | Codex | Audit content against live endpoints. | PR-F |
| `/plans` | 交易計畫 | Yes | No | No mock seen | No | No | No | Plans / playbook | plans/recommendations/paper data | PARTIAL | Needs proof that plans are sourced, not decorative. | Codex | Source labels and empty-state hardening. | PR-F |
| `/briefs` | AI 日報 | Yes | No | No mock seen | No | No | No | OpenAlice briefs | briefs API/data files | PARTIAL | Current mobile evidence says brief may be 05/15 stale; desktop brief page needs freshness proof. | Codex + Elva | Add stale banner if latest brief not today. | PR-F |
| `/admin/events` | EventLog | Yes | No | No mock seen | Admin-only | No | No | Event stream list, outbox diag | `/api/v1/event-streams`, `/api/v1/admin/event-log/outbox/diag` | EMPTY/PARTIAL | API returns 0 streams; direct `/event-log` is 404. EventLog is not product-credible yet. | Jason + Codex | Seed/emit real events or show formal empty with sources; add route alias/redirect. | PR-F |
| `/admin/portfolio/snapshots` | Portfolio Snapshot | Yes | No | No mock seen | Admin-only | No | No | Trading-as-Git snapshots/diff | `/api/v1/portfolio/snapshots`, `/api/v1/portfolio/snapshots/diff` | BROKEN | Snapshot endpoint returns 404; page displays sync state but capability is unavailable. | Jason + Codex | Add backend route or hide/disable snapshot page from main nav until endpoint exists. | PR-F |
| `/admin/tools` | ToolCenter | Yes | No | No mock seen | Admin-only | No | No | Tool registry, stats, call history | `/api/v1/tools/registry`, `/calls`, `/stats` | LIVE/PARTIAL | Backend has tools/stats/calls; must label executable vs demo/coming soon clearly. | Codex | UI classification and last run/status proof. | PR-F |
| `/admin/uta/accounts` | UTA | Yes | No | No mock seen | Admin-only | No | No | Broker adapters, UTA orders, SIM safety | `/api/v1/uta/adapters`, `/api/v1/uta/orders` | PARTIAL | Adapters live but orders empty; UTA must remain admin-only/read-only unless fully usable. | Codex | Keep out of public routes; strengthen empty/read-only copy. | PR-F |
| `/admin/strategies` | Strategy Lanes | Yes | No | No mock seen | Admin-only | No | No | Quant Lab lane truth state | strategy lane sources | PARTIAL | Must verify no full-page red error and every lane has reason/owner/next action. | Codex + Athena | Classify data missing/schema mismatch/stale/retired/risk blocked. | PR-F |
| `/admin/brain/llm` | Brain LLM cost | Yes | No | No mock seen | Admin-only | No | No | LLM usage/cost summary | Brain usage/model/calls endpoints | PARTIAL | Must verify every number is marked actual vs estimated with source/method. | Codex | Add explicit source/method labels if missing. | PR-F |
| `/event-log` | Public alias | No | 404 | No | N/A | Yes | No | Expected EventLog alias | none | BROKEN | Direct route 404 while nav concept exists. | Codex | Redirect to `/admin/events` or create formal route. | PR-E / PR-F |
| `/portfolio-snapshot` | Public alias | No | 404 | No | N/A | Yes | No | Expected portfolio snapshot alias | none | BROKEN | Direct route 404. | Codex | Redirect to `/admin/portfolio/snapshots` or create formal route. | PR-E / PR-F |
| `/tool-center` | Public alias | No | 404 | No | N/A | Yes | No | Expected ToolCenter alias | none | BROKEN | Direct route 404. | Codex | Redirect to `/admin/tools` or create formal route. | PR-E / PR-F |
| `/uta` | Public alias | No | 404 | No | N/A | Yes | No | Expected UTA alias | none | BROKEN | Direct route 404; public UTA should probably not exist unless usable. | Codex | Redirect only for owner/admin or remove from public expectation. | PR-E / PR-F |
| `/heatmap` | Legacy alias | Yes | No | No | No | Redirects to `/market-intel` | No | Heatmap alias | `next.config.ts` redirect | PARTIAL | Redirect works, but destination heatmap data still has English sector contamination in all-market source. | Codex + Jason | Fix heatmap data normalization/representative groups. | PR-B |
| `/news` | Legacy alias | Yes | No | No | No | Redirects to `/market-intel` | No | News alias | `next.config.ts` redirect | PARTIAL | Redirect works, but destination official announcements empty. | Codex + Jason | Add source/empty owner and refresh state. | PR-A / PR-B |
| `/m` | Mobile page | Yes | No | No mock seen | Mobile-only | Direct mobile route | Yes by design | Mobile quick view | mobile KGI/brief/theme APIs | PARTIAL | Not a desktop misload in this test, but stale brief copy says 05/15. | Codex | Ensure desktop links never land here accidentally; keep mobile stale banner. | PR-E |

## PR Breakdown

| Planned PR | Scope | Highest-risk findings from this board |
|---|---|---|
| PR-A | AI stock recommendations + AI selected news | `/api/v1/recommendations/today` has 4 items, v3 has no run, announcements empty. |
| PR-B | Heatmap + market intel data logic | All-market heatmap includes English sectors; representative industry groups are not enforced yet. |
| PR-C | Trading room backend wiring | `/portfolio` looks usable but paper preview/submit/cancel/fills/arbitrary search need scripted production proof. |
| PR-D | Company page empty modules | `/companies/2330` opens; must prove AI analyst report generation and every quote/tick/warrant/panel state. |
| PR-E | Routing bugs | `/event-log`, `/portfolio-snapshot`, `/tool-center`, `/uta` 404; company/theme click/back flow still needs proof. |
| PR-F | Quant/admin surfaces | Portfolio Snapshot endpoint 404; EventLog empty; Lab detail KGI tick fetches 422/503; Brain/Tool/UTA need truthful labels. |

## Immediate Next Task

Start with PR-A unless Elva assigns a fresher P0: fix AI recommendations/news product visibility. The concrete acceptance target is:

- `/ai-recommendations` shows at least 5 real-backed recommendation cards.
- v3 no longer returns `no_v3_run_yet` in production, or the frontend clearly uses v1/v2 with honest source status.
- Cards expose entry, stop, TP1/TP2, reason, risk, data quality, source, and portfolio handoff.
- `/market-intel` keeps AI selected news visible and adds stronger source/refresh state for empty official announcements.

If PR-A is blocked by backend ownership, move to PR-E because route aliases are frontend-owned and currently 404.
