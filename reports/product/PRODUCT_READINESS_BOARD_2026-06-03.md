# IUF Trading Room Product Readiness Board

Date: 2026-06-03
Owner lane: Codex frontend/productization
Goal: turn IUF Trading Room into a paid Taiwan-stock AI battle trading room that customers can subscribe to monthly/yearly, connect broker accounts safely, and use AI + strategy systems to support trading decisions.

## Executive Verdict

The product has moved past pure demo stage. The current main branch has live deployment, CI, Daily Production Smoke, quote/K-line work, AI recommendation gates, market-intel gates, representative heatmap work, company AI analyst work, and KGI SIM/F-AUTO surface work.

It is not yet subscription-ready. The main blocker is no longer one missing endpoint. The blocker is product convergence:

- Customer-facing pages, owner/admin operations, OpenAlice diagnostics, and Lab research pages are still mixed in the same navigation surface.
- The Trading Room is the future paid core, but still needs production-grade stability, real-time quote behavior, indicator trust, broker/SIM state clarity, and no visual jumping.
- AI recommendations and company AI analyst reports exist, but must consistently feel like professional decision support, not tool output or fallback text.
- Data states are more honest than before, but must become decision-grade: source, freshness, confidence, and next action must be visible without making the product feel broken.
- Subscription, entitlement, onboarding, billing, broker-linking, and risk consent are still not a complete customer journey.

## Current Production Signal

Observed from repo/GitHub/production checks on 2026-06-03:

- `origin/main` latest: `be3e5d55 feat(api): MIS full-universe sweep — intraday quotes for all ~1978 stocks (Tier B) (#935)`
- Latest main CI: green.
- Latest Deploy to Railway: green.
- Daily Production Smoke: green.
- API `/health`: HTTP 200.
- Public app routes redirect unauthenticated users to login, as expected.
- Protected product APIs require owner/session cookies; anonymous curl returns 401. Full content quality must be checked with owner-session browser tests, not anonymous API checks.

## Product Layers

| Layer | Purpose | Current State | Subscription Risk | Product Direction |
| --- | --- | --- | --- | --- |
| Customer App | What paying customers use daily | Partially ready | Internal/admin features still visible in product shell | Separate customer nav from owner/admin nav |
| Trading Room | Core paid workflow | High value, still uneven | Layout, K-line stability, real-time confidence, broker state must be flawless | Make this the flagship page |
| AI Decision Stack | AI recs, company analyst, market intelligence | Real endpoints exist | Professional quality and source trail not yet consistently subscription-grade | Turn AI into auditable decision support |
| Broker/SIM Execution | Paper, KGI SIM, KGI read-only, real disabled | Safety boundary exists | Manual/SIM/auto execution flows need unified UX and audit | Safe SIM-first broker integration |
| Quant Automation | S1/F-AUTO sanctioned lane | Narrow but valuable | Only one true strategy; do not show many half-ready strategies | Present one trusted SIM strategy, not a lab catalog |
| Internal Ops | Brain/EventLog/ToolCenter/UTA/Admin | Useful for owner/team | Confusing if sold as customer product | Keep owner-only or repackage as customer-readable logs |
| SaaS Platform | Plans, billing, entitlements, onboarding | Early | Cannot charge reliably without plan/role gating | Add subscription spine |

## Route Readiness Board

| Route | Audience | Paid Product Role | Data State | Current Verdict | Required Before Paid Launch |
| --- | --- | --- | --- | --- | --- |
| `/` | Customer + owner | Daily command center | Partial/live mix | Visually strong, but internal OpenAlice admin nav is still mixed into primary product | Split customer nav vs owner/internal nav; ensure top 3 AI rec + market intel are decision-grade |
| `/market-intel` | Customer | Market intelligence | Live/AI gated | Has AI news and heatmap gates, but must stay fresh and source-backed | Unified Taiwan red/green convention, source/freshness, institutional blocks, no raw dump |
| `/ai-recommendations` | Customer | AI stock recommendation product | Live gated | Core endpoint exists and strict QA exists | Stable 5+ non-fallback cards, performance feedback, source trail, trading-room handoff |
| `/portfolio` | Customer | Trading Room / paper + SIM workflow | Active but still core WIP | Highest product value and highest UX risk | Stable no-jump K-line, real-time quote pulse, trusted indicators, funds/positions/orders/fills unified |
| `/companies` | Customer | Company discovery | Partial | Useful, but route/theme flow must stay clean | Better discovery, no mobile/legacy leaks, no blank modules |
| `/companies/[symbol]` | Customer | Company cockpit + AI analyst | Partial/live | Improved, but AI analyst must become professional-grade | Source-backed report, useful conclusion, clean K-line readout, no tool-key/fallback prose |
| `/themes` | Customer | Theme/industry lens | Partial | Useful if connected to heatmap/AI/news | Clean route flow, company links, theme rationale |
| `/quant-strategies` | Customer + owner | Strategy/SIM allocation | Partial | Should show S1 as the one sanctioned strategy, not a menu of half-ready research | S1 capital, next run, SIM orders, PnL, risk, automation state |
| `/ops/f-auto` | Owner now; later advanced customer | F-AUTO/S1 operations | Active owner surface | Good internal page, not yet customer-grade | Convert to strategy observer dashboard with clear SIM-only guard |
| `/plans` | Customer | Trade plan ledger | Partial | Useful concept | Tie AI rec -> plan -> order preview -> execution record |
| `/alerts` | Customer | Alert center | Partial | Potentially valuable | Explain source, trigger rule, next action; hide owner dispatch for normal users |
| `/briefs` | Owner/customer? | AI daily brief | Mixed | OpenAlice operational language remains | Decide if this is customer content or internal content queue |
| `/admin/brain/llm` | Owner/admin | Internal cost ops | Owner only | Not customer product | Keep admin-only; do not sell as customer feature |
| `/admin/events` | Owner/admin; later user audit subset | Internal event log | Improving | Good ops primitive | Customer should see personal execution/audit events, not raw admin event streams |
| `/admin/portfolio/snapshots` | Owner/admin | Internal portfolio versioning | Improving | Useful but too admin-shaped | Repackage as customer portfolio history if needed |
| `/admin/tools` | Owner/admin | Internal tool registry | Improving | Not customer product as-is | Keep admin-only; expose only customer-safe tool results |
| `/admin/uta/accounts` | Owner/admin | Account/broker management | Early | Too internal for customer nav | Either complete broker connection flow or keep admin-only |
| `/admin/strategies` | Owner/admin | Lab/status truth | Internal | Useful for team | Customer sees simplified strategy status only |
| `/lab/*` | Internal research | Quant research | Mixed | Not customer product | Hide from paid customer nav unless explicitly a research tier |
| `/runs/*` | Internal/advanced | Run detail | Partial | Useful but technical | Only expose curated run summaries |
| `/settings/account` | Customer | Account/settings | Basic | Needs subscription controls | Add plan, billing, broker connection, risk consent |
| `/login`, `/register` | Customer | Onboarding | Basic | Needs SaaS polish | Trial invite, plan selection, consent, broker setup path |

## P0 Product Gaps

### P0-A: Customer/Admin Boundary

Problem: OpenAlice admin surfaces are still visible in the main product shell and even covered by tests that keep them visible. This was useful during rescue mode, but it is wrong for a subscription product.

Acceptance:

- Normal customer nav shows only customer product pages.
- Owner/admin nav remains available behind owner role or an internal operations switch.
- Admin routes remain protected server-side.
- Homepage keeps tactical design, but no longer reads like an internal cockpit for customers.

Recommended PR: `fix(web): split customer and owner operations navigation`

### P0-B: Trading Room as Flagship Product

Problem: The Trading Room is the core revenue feature but still carries the most user-visible risk: layout polish, scrollbars, K-line jumping, real-time price trust, indicator trust, and order panel clarity.

Acceptance:

- First meaningful render is fast.
- No native ugly horizontal/vertical scrollbars inside the desktop layout.
- K-line does not remount during quote pulse.
- Zoom, pan, latest, full range controls are visible and deterministic.
- MA/VWAP/support-resistance/RSI/MACD are computed from real OHLCV/K-bar data.
- Quote freshness and source are visible.
- Paper/KGI SIM/KGI read-only/real-disabled boundaries are unambiguous.
- Order preview, submit, positions, funds, fills, and events form one coherent story.

Recommended PR series:

1. `fix(web): harden trading room shell and order panel fit`
2. `fix(web): make trading room indicators decision-grade`
3. `fix(web): connect trading room execution ledger and SIM status`

### P0-C: AI Decision Quality

Problem: AI has endpoints and guardrails, but the paid product must feel like professional decision support rather than a generated paragraph.

Acceptance:

- AI recommendation cards have entry, stop, TP1/TP2, reason, risk, source trail, data completeness, and handoff.
- Company AI analyst report has company overview, recent events, technical structure, chips/institutional flow, themes, risks, conclusion, source time.
- Tool names, fallback keys, raw prompt/metadata, and debug language never appear in customer-facing report text.
- When data is incomplete, the report says what is missing and what decision is still possible.

Recommended PR: `fix(web): make company AI analyst report customer-grade`

### P0-D: Market Intelligence and Heatmap Trust

Problem: Market Intel and heatmap are high-value, but they must feel like a curated Taiwan-market battle map, not a data dump.

Acceptance:

- Taiwan convention is consistent everywhere: up = red, down = green.
- Industry heatmap uses fixed representative pools where required.
- Full-market heatmap labels are Chinese and not random sector dumps.
- Three institutional blocks show real data or a useful source state, never blank space.
- AI news has why it matters, source, time, related companies/themes, and next action.

Recommended PR: `fix(web): unify market-intel heatmap and institutional truth`

### P0-E: Subscription Spine

Problem: A monthly/yearly product needs plan/tier entitlement before real customers enter.

Acceptance:

- Define plan tiers and feature matrix.
- Gate advanced features by entitlement.
- Settings page shows current plan, trial state, billing action, broker connection status, and risk consent status.
- Owner/admin features are not confused with paid customer features.

Recommended PR: `feat(web): add subscription readiness shell and entitlement map`

## Suggested Paid Packaging

| Tier | Intended User | Includes | Excludes |
| --- | --- | --- | --- |
| Trial | New customer | Login, delayed market overview, limited AI news, limited company pages | Broker connection, order submission, automation |
| Pro | Active retail user | AI recs, company analyst, heatmap, market intel, paper trading, alerts | KGI SIM and automation |
| Trader | Power user | Broker read-only, KGI SIM, strategy observer, order/fill audit, advanced alerts | Real order automation by default |
| Elite/Desk | Advanced/team | Strategy automation controls, workspace, audit export, deeper OpenAlice reports | Anything requiring unapproved live broker writes |

## Product QA Required Before Charging

Minimum daily owner-session suite:

1. Login.
2. Homepage loads with no internal-only confusion for customer role.
3. AI recommendations: 5+ non-fallback cards, handoff works.
4. Market Intel: fresh AI news and heatmap convention.
5. Trading Room: search 5 symbols, quote pulse starts, K-line stable, indicators toggle, paper preview works.
6. Company 2330: K-line readable, AI analyst report customer-grade.
7. Quant strategy S1: capital/readiness/SIM state visible.
8. Event/audit: paper/SIM action appears in customer-readable ledger.
9. Settings: subscription and broker connection state visible.

## Decisions Needed From Yang

These decisions do not block technical cleanup, but they are needed before paid launch:

1. Should normal paid customers see OpenAlice/Brain/EventLog/ToolCenter names, or should those remain internal-only?
2. First subscription tiers: Trial / Pro / Trader / Elite, or a simpler two-tier launch?
3. Broker policy for launch: Paper + KGI SIM + KGI read-only only, with real order disabled until separate approval?
4. Should F-AUTO/S1 be sold as a customer-facing automation feature at launch, or initially owner-observed only?
5. Risk/compliance copy: should product language say "decision support" only, not "buy/sell advice"?

## Codex Next Move

Start with the highest-value product task:

`P0-B Trading Room as Flagship Product`

Reason:

- It is closest to the revenue promise.
- It is the page Yang repeatedly identifies as most important and most visibly not good enough.
- It connects every important system: AI handoff, quote, K-line, indicators, broker/SIM state, funds, orders, fills, risk, and event audit.

Immediate implementation target after this board:

- tighten the trading-room shell and order panel fit;
- preserve the K-line iframe while quote pulse updates;
- make indicator labels and source/freshness decision-grade;
- verify with owner-session Playwright screenshots.

