# 2026-05-19 Codex Company Panel Auth Fix Start

Latest state before editing:

- `origin/main`: `65b1537 feat: Job#2 ToolCenter lastRunAt+executionHistory, Job#1 LLM usage metadata, Job#3 EventLog event seed (#731)`
- `#730` is merged and production-verified for `/companies/2330` top-level ticker lookup.
- `#732` is merged separately for AI news why/impact/rank quality.
- Production `/companies/2330` now renders the page, but browser verification still shows client-side panel requests returning 401:
  - CoverageKnowledgePanel
  - IndustryGraphPanel
  - full-profile driven institutional / margin panels
  - KGI quote bidask/ticks panels

Chosen frontend-owned task:

Fix browser-side read-only company panel fetches so they use the same-origin app proxy instead of direct cross-origin API calls that drop the owner session cookie. This is read-only and does not touch broker/risk/contracts, KGI live writes, or real-order promotion.

Acceptance:

- `/companies/2330` production browser verification should no longer show 401 for read-only company/full-profile/KGI quote panel requests.
- Panels must render LIVE/EMPTY/BLOCKED based on real upstream state, not auth-blocked by the frontend path.
- Evidence screenshot and network summary under `evidence/w7_paper_sprint`.
