# CODEX AI Feedback Proxy Errors PR Evidence - 2026-05-17

Branch: `fix/web-ai-feedback-proxy-errors-2026-05-17`

Task:
- Harden the same-origin AI recommendation feedback proxy used by feedback buttons and handoff `acted` telemetry.
- Keep successful backend proxy behavior unchanged.
- Return stable no-store JSON on upstream fetch/read failures instead of an unhandled Next route error.

Changed surface:
- `apps/web/app/api/recommendations/[id]/feedback/route.ts`

Verification:
- `pnpm.cmd install --frozen-lockfile --prefer-offline` passed.
- `pnpm.cmd --filter @iuf-trading-room/contracts build` passed.
- `pnpm.cmd --filter @iuf-trading-room/web typecheck` passed.
- Route smoke with local mock upstream on `NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:3112` passed:
  - Success path: `POST /api/recommendations/REC-BEAR/feedback` returned `200` JSON `{ ok: true, echoed: { reaction: "acted" } }`.
  - Upstream-down path: after stopping mock upstream, the same POST returned `502` JSON `{ ok: false, error: "UPSTREAM_UNAVAILABLE" }`.
- `git diff --check` passed.
- Code hardline/secret scan over touched frontend route and cycle note found no matches.

Safety:
- Frontend-only `apps/web` route hardening.
- No KGI live broker write path changed.
- No real-order path promotion.
- No `executionMode='live'` or `PAPER_LIVE` promotion added.
- No secrets or tokens added.
- No homepage/vendor tactical layout rewrite.
