# Codex Homepage Workflow Repair

Date: 2026-05-06
Branch: feat-web-home-workflow-repair-2026-05-06
Trade Capability Score: +1

## Why This Exists

The homepage was behaving like a stale information wall and several shared frame labels were corrupted. This slice repairs the product truth layer before any outsourced visual redesign:

1. Replaces corrupted shared PageFrame labels with readable Traditional Chinese.
2. Replaces the homepage content model with a trading workflow cockpit.
3. Removes stale theme/signal/run tables from the homepage path.
4. Keeps empty, blocked, and missing states explicit instead of filling space with fake content.

## Pages / Components Changed

- apps/web/components/PageFrame.tsx
- apps/web/app/page.tsx
- apps/web/app/globals.css

## Endpoint / Source List

- GET /api/v1/data-sources/finmind/status
- GET /api/v1/diagnostics/finmind
- GET /api/v1/market-data/overview
- GET /api/v1/ops/snapshot
- GET /api/v1/briefs
- GET /api/v1/content-drafts
- GET /api/v1/paper/health
- GET /api/v1/strategy/ideas
- GET /api/v1/strategy/runs

## Behavior Change

- Homepage now shows the current trading workflow state: FinMind, market data, OpenAlice daily brief, paper health, strategy/quant intake, and next workflow links.
- Homepage no longer promotes stale signals, stale themes, or old strategy runs as useful current content.
- Major information/news remains explicitly EMPTY until the FinMind/news backend path is fully deployed.
- PageFrame now renders readable Traditional Chinese labels across all pages.

## State Semantics

- LIVE: endpoint returned usable data for the workflow.
- EMPTY: endpoint returned zero rows, missing today brief, or pending source.
- BLOCKED: endpoint failed, auth expired, token/source unavailable, or workflow gate closed.

## Checks

- contracts build: PASS.
- web typecheck: PASS.
- web build: PASS.
- git diff --check: PASS with CRLF warnings only.
- added-line stop-line grep: PASS.
- mojibake sentinel scan for homepage/PageFrame: PASS.

## Stop-Line Proof

- No token value displayed or logged.
- No fake live data added.
- No broker write path or formal order route touched.
- No migration/schema/destructive DB action touched.
- No FinMind or K-line data used as paper fill or risk source.
- No unapproved strategy metric, price-objective wording, or return-assurance wording added.

## Next Slice

1. Rebase after PR #235 and push PR.
2. Continue OpenAlice daily brief automation closure and Market Intel live frontend once the backend deploy path is confirmed.
3. Continue Paper E2E company-to-portfolio flow guide after the paper stack is fully deployed.
