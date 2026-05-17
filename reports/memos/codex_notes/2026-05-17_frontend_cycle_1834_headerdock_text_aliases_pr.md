# 2026-05-17 18:34 TST Frontend cycle - HeaderDock text aliases

## Latest merged state
- `origin/main` is at `0802c5b` / PR #610, with HeaderDock notification severity aliases normalized after the prior empty-body, envelope, unread-query, and field-alias proxy fixes.
- Recent frontend evidence under `evidence/w7_paper_sprint` ends at `CODEX_HEADERDOCK_SEVERITY_ALIASES_PR_2026-05-17.md`.

## Open PRs
- #549 `fix(api): market-data/overview perf -- switch to listCompaniesLite` remains open and is Jason/API-owned.

## Blocked items and owner
- Jason owns #549 and any backend notification contract changes. This cycle will not touch `apps/api`, broker/risk/contracts, KGI paths, or shared contracts.
- No Elva/Bruce frontend blocker found for the selected task.

## Selected frontend-safe task
- Normalize HeaderDock notification title/message text aliases in the web proxy so live/audit/event payloads that send `summary`, `description`, `text`, `content`, `headline`, `event`, or `action` still render useful drawer text.
- Scope is bounded to `apps/web` proxy normalization plus focused evidence, typecheck, and mock browser/proxy smoke.
