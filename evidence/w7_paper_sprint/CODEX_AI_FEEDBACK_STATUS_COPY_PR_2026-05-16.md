# CODEX_AI_FEEDBACK_STATUS_COPY_PR_2026-05-16

## Scope
- Branch: `fix/web-ai-feedback-status-copy-2026-05-16`
- Component: `apps/web/app/ai-recommendations/RecommendationFeedbackActions.tsx`
- Purpose: make AI recommendation feedback failures specific enough for owner-session and backend readiness without changing the backend contract.

## Change
- Non-2xx feedback responses now parse the same-origin proxy JSON when available.
- User-facing failure copy distinguishes:
  - `401/403`: owner session not accepted.
  - `404` / `not_found`: recommendation version changed.
  - `API_BASE_UNCONFIGURED`: data service not configured.
  - `400`: feedback payload validation failed.
  - network exception: feedback service connection failed.
  - generic non-2xx: feedback service syncing.
- Existing `like / dislike / skip / acted` controls and `POST /api/recommendations/:id/feedback` path are unchanged.

## Verification
- `git diff --check origin/main..HEAD` PASS
- `pnpm.cmd install --frozen-lockfile --prefer-offline` PASS
- `pnpm.cmd --filter @iuf-trading-room/contracts build` PASS
- `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS
- Python Playwright browser smoke PASS:
  - fake local Orchestrator on `http://127.0.0.1:3057`
  - local web on `http://127.0.0.1:3058`
  - `NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:3057`
  - added local-only `iuf_session=codex-local-smoke` cookie to pass middleware routing without real credentials
  - opened `/ai-recommendations/rec-gone`
  - clicked the first feedback action
  - fake backend returned `404 {"ok":false,"error":"not_found"}`
  - UI rendered: `推薦版本已更新，這筆回饋暫未寫入。`
  - screenshot: `evidence/w7_paper_sprint/CODEX_AI_FEEDBACK_STATUS_COPY_PR_2026-05-16.png`

## Safety
- Frontend-only component copy/state handling.
- No `apps/api` broker/risk/contracts edits.
- No KGI live broker write.
- No real-order path promotion.
- No `PAPER_LIVE` or default live execution mode.
