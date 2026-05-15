# CODEX_AI_FEEDBACK_STATUS_COPY_2026-05-15

Cycle: 2026-05-15 19:48 TST
Branch: `fix/web-ai-feedback-status-copy-2026-05-15`
Worktree: `IUF_TRADING_ROOM_APP_ai_feedback_copy_worktree`

## Scope

Frontend-only polish for AI recommendation feedback status copy.

`RecommendationFeedbackActions` previously collapsed every non-2xx response into `回饋尚未寫入`. That was safe, but too vague for a product surface that now has real recommendation IDs, owner-only auth, and backend resolver dependencies.

## Shipped locally

Updated `apps/web/app/ai-recommendations/RecommendationFeedbackActions.tsx`:

- Keeps the existing `like / dislike / skip / acted` controls.
- Keeps same-origin `POST /api/recommendations/:id/feedback`.
- Parses non-2xx proxy JSON response when available.
- Shows specific frontend copy for:
  - `401/403`: `Owner session 未通過，回饋暫未寫入。`
  - `404` / `not_found`: `推薦版本已更新，這筆回饋暫未寫入。`
  - `API_BASE_UNCONFIGURED`: `資料服務尚未設定，回饋暫未寫入。`
  - `400`: `回饋格式未通過，暫未寫入。`
  - network failure: `回饋服務連線失敗，請稍後再試。`
  - generic backend issue: `回饋服務同步中，暫未寫入。`

No backend resolver behavior was changed.

## Verification

Dependency setup in the clean worktree:

```powershell
pnpm.cmd install --frozen-lockfile --prefer-offline
pnpm.cmd --filter @iuf-trading-room/contracts build
```

Typecheck:

```powershell
pnpm.cmd --filter @iuf-trading-room/web typecheck
```

Result: PASS.

Same-origin feedback proxy smoke:

- Fake backend: `http://127.0.0.1:3047`
- Web dev: `http://127.0.0.1:3048`
- `NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:3047`

| Request | Status | Body |
| --- | ---: | --- |
| `POST /api/recommendations/rec-ok/feedback` | 200 | `{"ok":true}` |
| `POST /api/recommendations/rec-gone/feedback` | 404 | `{"ok":false,"error":"not_found"}` |
| `POST /api/recommendations/rec-forbidden/feedback` | 403 | `{"ok":false,"error":"forbidden_role"}` |
| `POST /api/recommendations/rec-down/feedback` | 500 | `{"ok":false,"error":"feedback_down"}` |

## Safety

- No `apps/api` changes.
- No broker/risk/contracts changes.
- No KGI live write path.
- No real-order or `PAPER_LIVE` promotion.
- Handoff navigation is unchanged; this only improves status wording after feedback attempts.

## Release status

Patch was prepared locally on the 2026-05-15 cycle.

2026-05-16 follow-up: promoted onto latest `origin/main` on branch
`fix/web-ai-feedback-status-copy-2026-05-16`; see
`CODEX_AI_FEEDBACK_STATUS_COPY_PR_2026-05-16.md` for the current PR
verification and browser smoke.
