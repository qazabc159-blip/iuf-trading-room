# Codex Daily Brief Source-Trail / Mojibake Repair

Date: 2026-05-07
Branch: fix-web-briefs-source-trail-repair-2026-05-07
Trade Capability Score: +1

## Why

The daily brief page is part of the automated OpenAlice content workflow. It still contained mojibake and overloaded panels, which made the page unusable for checking whether daily content was generated, reviewed, source-traced, and published.

## Changes

- Rewrote `/briefs` into a clean Traditional Chinese OpenAlice workflow surface.
- Shows today's daily brief state: published, awaiting review, missing, or blocked.
- Shows OpenAlice runner / dispatcher / reviewer / publish status with timestamps.
- Shows recent OpenAlice jobs and content draft queue with source job references.
- Shows formal published brief only when a real row exists.
- Shows draft source trail only as awaiting-review content; it is not presented as formal daily brief.
- Cleaned content draft helper labels and Owner fallback action text.

## Sources / Endpoints

- `GET /api/v1/briefs`
- `GET /api/v1/content-drafts`
- `GET /api/v1/openalice/jobs`
- `GET /api/v1/openalice/observability`
- `GET /api/v1/session`

## Checks

- `pnpm.cmd --filter @iuf-trading-room/contracts build`: PASS
- `pnpm.cmd --filter @iuf-trading-room/web build`: PASS
- `pnpm.cmd --filter @iuf-trading-room/web typecheck`: PASS
- mojibake sentinel scan: PASS
- `git diff --check`: PASS
- added-line stop-line grep: PASS

## Stop-Line Proof

- No token value.
- No order route or broker write path.
- No migration/schema/destructive DB change.
- No fake live data: draft content stays labeled as draft / awaiting review.
- No unapproved strategy metrics.

## Next

- Verify deployment after PR merge.
- Continue Market Intel /重大訊息 live frontend once backend deploy state is verified.
- Continue paper company-to-portfolio workflow.
