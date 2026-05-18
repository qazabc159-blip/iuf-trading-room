# 2026-05-19 03:45 TST - Codex P0 Company Page Layout Truth Sync

## Latest merged state
- `origin/main` is at `7d5238a` after PR #717 (`fix(web): promote ai rec v3 primary surface`).
- PR #716, #715, #714, #713 already clarified Strategy Lanes, Brain LLM cost, ToolCenter, and EventLog truth states.
- Production `/ai-recommendations` owner-session smoke passed after #717: 5 v3 cards in the first panel, no duplicate v3 cards, no English fallback copy, no console/page errors.

## Open PRs / team progress
- GitHub open PR list is empty at task start.
- Market Intel production owner-session scan shows the page renders AI selected news, source status, why-matters copy, and company/theme/recommendation links. It needs continued QA, but it is not the biggest visible product breakage in this slice.

## Blocked items / owners
- `/companies/2330` production owner-session scan shows company data is mostly wired, but KGI `ticks` and `bidask` endpoints return 503 from the gateway. Owner: Jason/Bruce for gateway/session readiness. Frontend must keep the BLOCKED state honest.
- Company page desktop layout has a clear frontend P0: right-column modules collapse into an unreadable narrow vertical rail. This is not a backend issue and is safe for Codex to fix.

## Chosen frontend-safe task for this cycle
- Fix `/companies/[symbol]` product layout so the right-side modules cannot collapse into vertical unreadable text on desktop and mobile.
- Scope: company page frontend layout/CSS only, plus evidence.
- Acceptance:
  - `/companies/2330` desktop and mobile remain route 200.
  - Existing live/degraded/company data remains visible.
  - Right-side modules use readable card widths or stack below main content instead of letter-by-letter vertical text.
  - KGI 503 blocks remain clearly labeled BLOCKED with endpoint/owner/next action; no fake quote/tick data.
  - Run web typecheck and browser smoke with screenshots.

## Hardlines
- Do not touch `apps/api`, broker/risk/contracts, KGI live broker writes, real-order paths, or OpenAlice source.
- No mock/fake data.
- Preserve black/gold tactical company page style.
