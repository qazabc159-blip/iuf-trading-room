# Frontend Codex Sync - Quant Strategies Lab Readiness

Time: 2026-05-15 09:10 TST

Latest main observed:
- `046b5fa fix(web): preserve login next query for portfolio handoff (#506)`
- `26b27b3 fix(web): wire recommendation prefill into trading room (#505)`
- No open PRs observed before branching this cycle.

Frontend-safe next task:
- Advance `/quant-strategies` from static-only cards to read-only Lab sanctioned snapshot readiness.
- Use existing web `radarLabApi.strategies()` against `GET /api/v1/lab/strategies`.
- Keep v1 SIM-only and research-only wording explicit.
- Do not fabricate quant score, Sharpe, allocation, live execution, or paper/live promotion.

Coordination notes:
- Jason: no backend change required for this cycle; using existing lab snapshot alias endpoint.
- Athena: status remains verbatim Lab governance status, rendered as research-only.
- Bruce: please QA owner-session `/quant-strategies` after PR; expected behavior is live Lab source banner when endpoint is available and clear fallback when unavailable.

Hardlines held:
- No `apps/api` broker/risk/contracts edits.
- No `IUF_QUANT_LAB` or `IUF_SHARED_CONTRACTS` edits.
- No KGI live write, no `PAPER_LIVE` promotion, no default live execution mode.
