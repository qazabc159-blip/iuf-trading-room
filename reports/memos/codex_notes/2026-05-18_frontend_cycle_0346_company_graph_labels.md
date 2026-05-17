# 2026-05-18 Frontend cycle 0346 - Company graph label cleanup

Owner: Codex frontend (`apps/web`)
Scope: `/companies?tab=graph` My-TW-Coverage company graph labels

## Latest merged state

- `origin/main` is at `a424897` (`fix(web): localize AI quality source labels`, PR #651).
- Recent frontend fixes:
  - `#651` removed visible AI recommendation template labels (`Penalty`, `sourceTrail`, `SOURCE TRAIL`).
  - `#650` hardened company coverage panels against partial My-TW-Coverage payloads.
  - `#649` made `/companies?tab=graph&q=...` deep-linkable.
  - `#648` localized market heatmap industry labels.
  - `#642` activated the company graph tab.

## Open PRs / team progress

- `gh pr list` currently shows no open PRs.
- Latest main validate after #651 is green.
- No newer Elva/Jason/Jim/Bruce PR is waiting on frontend review.

## Blocked items and owners

- Production deploy verification remains blocked by missing GitHub Actions secrets `SEED_OWNER_EMAIL` / `SEED_OWNER_PASSWORD`.
- Owner: Jason / repo admin.
- Heatmap stock universe / KGI fallback semantics remain Elva/Jason/API-owned.

## Chosen frontend-safe task

Clean up remaining visible English/template labels in the My-TW-Coverage company graph tab:

- `COMPANY GRAPH` -> `公司圖譜`
- `SEARCH` -> `搜尋`
- `RELATION TYPES` -> `關係類型`
- `TOP KEYWORDS` -> `熱門關鍵字`
- `TOP CONNECTED COMPANIES` -> `高連結公司`
- `score` -> `分數`

During browser smoke, the graph tab also exposed a fail-soft gap: a partial stats/search envelope could make the client render crash instead of showing the empty/degraded graph state. This cycle will keep that fix scoped to the same graph tab by guarding the relation-type metric and search-result array shape.

This is frontend-only, keeps existing API contracts unchanged, and directly improves the My-TW-Coverage knowledge graph surface Yang called out.
