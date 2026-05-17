# CODEX_AI_TIMESTAMP_READABILITY_PR_2026-05-17

Owner: Codex frontend (`apps/web`)
Branch: `fix/web-ai-source-timestamp-2026-05-17`
Base: `origin/main` at `9c358f6` (`docs(web): add header dock drag regression evidence`)

## Scope

Improve `/ai-recommendations` and `/ai-recommendations/[id]` timestamp readability.

Changed:

- AI recommendation `generatedAt` display now uses compact Asia/Taipei time instead of raw ISO.
- AI recommendation `sourceTrail[].timestamp` display now uses compact Asia/Taipei time when parseable.
- Raw `sourceTrail[].timestamp` is preserved in `title` and `aria-label`.
- Unparseable source timestamps fall back to their original text instead of being forced into an invalid date.

No backend, broker, risk, contracts, KGI, `IUF_QUANT_LAB`, or `IUF_SHARED_CONTRACTS` files were touched.

## Verification

Commands:

```powershell
pnpm.cmd install --frozen-lockfile --prefer-offline
pnpm.cmd --filter @iuf-trading-room/contracts build
pnpm.cmd --filter @iuf-trading-room/web typecheck
```

Browser smoke:

- Started local Next.js web server with a local mock Recommendation API.
- Mocked `generatedAt = 2026-05-17T14:45:00.000Z`.
- Mocked `sourceTrail[0].timestamp = 2026-05-17T14:40:00.000Z`.
- Mocked `sourceTrail[1].timestamp = not-a-date-source-id`.
- Verified list page displays generatedAt as `05/17 22:45`.
- Verified detail page displays generatedAt as `05/17 22:45`.
- Verified list sourceTrail displays timestamp as `05/17 22:40`.
- Verified detail sourceTrail displays timestamp as `05/17 22:40`.
- Verified sourceTrail `title` and `aria-label` keep the raw ISO timestamp.
- Verified invalid source timestamp remains `not-a-date-source-id`.
- Browser console/page errors: none blocking.

Observed non-blocking dev-server warning:

- Next dev emitted the known Sentry/OpenTelemetry dynamic dependency warning during compile.
- It did not appear as a browser runtime error and did not block the tested flow.

## Screenshots

- `evidence/w7_paper_sprint/ai-source-timestamp-list-1366x900.png`
- `evidence/w7_paper_sprint/ai-source-timestamp-detail-1366x900.png`

## Elva / Jason / Bruce Follow-Up

- Elva: the explicitly referenced `reports/codex_notes/2026-05-17_elva_to_codex_unblock_and_priorities.md` was not present in this main worktree or sibling TR worktrees at cycle start. I followed the merged Recommendation v1 spec and the latest evidence instead.
- Jason: latest merged backend/API progress `#624` is in main. New open backend PR `#627` OpenAlice EventLog Phase A is visible, currently `CONFLICTING` with no checks yet. This PR does not request backend changes.
- Bruce: existing AI-to-Portfolio, Quant owner E2E, and HeaderDock owner/drag QA evidence remain intact. This PR adds a small AI readability improvement with targeted browser evidence.

## Blockers

- True production Owner-session QA remains blocked without an already-authenticated production Owner browser context.
  - Owner: Yang / Elva, only if production-authenticated validation is required.
- Backend recommendation source semantics and persistence remain Jason-owned.

## Result

Pass. AI recommendation timestamps are easier to read while preserving raw source evidence for audit/debug context.
