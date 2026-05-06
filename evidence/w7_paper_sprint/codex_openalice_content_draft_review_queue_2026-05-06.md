# Codex OpenAlice Content Draft Review Queue - 2026-05-06

Status: READY FOR PR

Trade Capability Score: +1

## Why This Exists

OpenAlice can produce daily brief / theme / company-note drafts, but the operator needs a trustworthy review surface before content reaches production pages. This change makes the draft queue useful without pretending any unapproved draft is live content.

## Scope

- Route: `/admin/content-drafts`
- Route: `/admin/content-drafts/[id]`
- Source: `GET /api/v1/content-drafts`
- Files:
  - `apps/web/app/admin/content-drafts/page.tsx`
  - `apps/web/app/admin/content-drafts/[id]/page.tsx`
  - `apps/web/lib/content-draft-view.ts`
  - `apps/web/app/globals.css`

## Behavior

- Lists content drafts with target, title/body preview, producer, source job, draft date / market state, reviewer, status, and updated time.
- Fixes the admin draft row grid: the table rendered 7 cells but CSS defined 6 columns.
- Detail page shows structured daily-brief sections instead of forcing the reviewer to read raw JSON first.
- Detail page adds source/review trail:
  - source job
  - producer version
  - target
  - target ID
  - reviewer / AI reviewer fallback
  - approval / reject / awaiting-review note
- Unapproved drafts are explicitly not shown as official daily brief content.
- Approve/reject remains governed: this PR does not add fake local success, order submit, or broker action.

## Checks

- `pnpm.cmd --filter @iuf-trading-room/contracts build` PASS
- `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS
- `pnpm.cmd --filter @iuf-trading-room/web build` PASS
- `git diff --check` PASS with CRLF warnings only
- added-line stop-line grep PASS
- UTF-8 replacement character check PASS

## Stop-Line Proof

- No token value displayed or logged.
- No `FINMIND_API_TOKEN` / OpenAI key literal in added UI lines.
- No live submit.
- No `/order/create`.
- No KGI write-side.
- No migration/schema/destructive DB action.
- No fake strategy metric.
- No buy/sell recommendation wording.
- No fake approval success button.

## Next

After PR review/merge, production smoke should verify:

1. `/admin/content-drafts` renders without overflow at desktop and mobile widths.
2. `/admin/content-drafts/[id]` shows structured sections for a daily brief draft.
3. awaiting-review drafts do not appear as official published daily briefs.
4. no token appears in DOM, logs, or evidence.
