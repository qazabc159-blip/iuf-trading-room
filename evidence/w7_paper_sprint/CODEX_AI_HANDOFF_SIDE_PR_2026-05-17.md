# CODEX AI Handoff Side PR Evidence - 2026-05-17

Branch: `fix/web-ai-handoff-side-2026-05-17`

Task:
- Preserve AI recommendation direction through `/ai-recommendations -> /portfolio` handoff.
- Map contract-backed `direction` values safely: `偏多 -> side=buy`, `偏空 -> side=sell`, `中性 -> no side override`.
- Keep paper room behavior SIM-only and do not touch broker/risk/backend contracts.

Changed surface:
- AI recommendation list/detail handoff links now include `side=buy|sell` only for directional recommendations.
- `/portfolio` and `/final-v031/portfolio` whitelist and forward `side`.
- `paper-trading-room` prefill parsing/hydration stores `side`, shows it in metadata, and selects the vendor ticket side button when present.

Verification:
- `pnpm.cmd install --frozen-lockfile --prefer-offline` passed.
- `pnpm.cmd --filter @iuf-trading-room/contracts build` passed.
- `pnpm.cmd --filter @iuf-trading-room/web typecheck` passed.
- Browser smoke on `http://127.0.0.1:3107/portfolio?ticker=2317&prefill=true&from_rec=REC-BEAR&entry=100&stop=95&tp=112&side=sell` passed with auth-presence cookie:
  - Portfolio iframe `src` preserved `side=sell`.
  - Embedded paper ticket active side was `sell`.
  - Submit button class was `submit sell`.
  - Prefill box contained `REC-BEAR` and direction metadata.
  - No browser console errors were observed.
- `git diff --check` passed.
- Code hardline/secret scan over touched frontend code and cycle note found no matches.

Screenshots:
- `evidence/w7_paper_sprint/ai-handoff-side-sell-1366x900.png`

Safety:
- No KGI live broker write path changed.
- No `executionMode='live'` or `PAPER_LIVE` promotion added.
- No secrets or tokens added.
- No homepage/vendor tactical layout rewrite.
