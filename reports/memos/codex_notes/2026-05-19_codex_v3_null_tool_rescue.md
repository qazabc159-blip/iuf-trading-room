# 2026-05-19 Codex sync - v3 null tool rescue

Audience: Elva / Jason / Bruce

Latest state checked before editing:
- `origin/main` is at `5ddf8ec` (`fix(ci): restore deploy.yml self-hosted ternary`).
- Open PR in GitHub list: #744 `fix(news): cron hourly fire + rank dedup edge case`, owned by Jason/news lane; I will not touch it.
- Production API `/health` is 200 with deployment `2daa8580-88e2-4f9d-9f5e-5e078d3465ea`.
- Current production `GET /api/v1/ai-recommendations/v3` returns `status=failed`, `itemCount=0`, `usedFallback=false`.

Blocker found:
- The latest v3 run failed because the LLM emitted `toolName: "null"` as a string after the market overview step.
- The orchestrator treated string `"null"` as a real tool name, failed the whitelist check, and returned `Tool not in whitelist: null`.

Chosen frontend/product rescue task:
- Backend-owned but directly blocking PR-A acceptance: normalize string sentinel tool names (`"null"`, `"none"`, `"final_answer"`, etc.) to real `null` so the ReAct loop enters synthesis instead of failing.

Expected verification:
- API typecheck.
- Targeted AI-REC-V3 tests.
- PR with evidence.
- After merge/deploy, Bruce/Codex should trigger v3 refresh and verify `status`, `itemCount`, `usedFallback`, and `fullAiReportParsed`.
