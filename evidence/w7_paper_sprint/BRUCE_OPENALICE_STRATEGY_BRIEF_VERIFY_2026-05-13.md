# Bruce Verify: OpenAlice Strategy-Level Brief (PR #416)
Date: 2026-05-13T07:10 UTC
Verifier: Bruce
DeploymentId: 703b161a-1dff-45ed-a6b2-1afd11bc886c
StartedAt: 2026-05-13T07:05:19Z (15:05 TST)
Main HEAD: e47c6e4

---

## Segment A — Endpoint Live Check

### GET /api/v1/openalice/strategy-brief/latest
- HTTP: 200
- Pre-generate: `{ data: null, stale_reason: "never_generated" }` — PASS (cron not yet fired, expected)
- Post-generate: returns in-memory result with status=blocked_data_quality

### POST /api/v1/openalice/strategy-brief/generate
- HTTP: 200 (first and only call — no repeat)
- Response time: ~2s (no OpenAI call triggered — data blocked before LLM path)
- Result:
  - status: `blocked_data_quality`
  - blockedReason: `BLOCKED_DATA_QUALITY: cont_liq_yaml:no_files_found, tw_institutional_buysell:empty, companies_ohlcv:empty`
  - generationMode: `source_only_fallback`
  - hallucinationCheckPassed: `null` (not applicable — blocked before LLM call)
  - sections count: 0
  - disclaimer: `research_only`

### Source Pack Detail
- contLiqDays: 0 — yaml files absent from Railway deployment (reports/trading_room/cont_liq_period1_daily/ not present)
- institutionalRows: 0 — tw_institutional_buysell table empty (no backfill yet)
- ohlcvRows: 0 — companies_ohlcv table empty (no backfill yet)
- snapshots:
  - cont_liq_v36: ok=True, staleReason=null (local_embedded)
  - strategy_002: ok=True, staleReason=null
  - strategy_003: ok=True, staleReason=null
- trailComplete: False (snapshots OK but contLiqDays=0 blocks trail)

### Cron Status
- 14:00 TST cron: will fire tomorrow (15:05 TST today has already passed, cron registered but idempotent check applies)
- Today manual trigger confirmed endpoint is reachable and correctly applies data-quality gate

---

## Segment B — OPENAI_MODEL Env

### Finding
- `OPENAI_MODEL` Railway env var: NOT SET
- Code fallback (`openai-quota-guard.ts:73`): `MODEL_ROUTINE = process.env["OPENAI_MODEL"] ?? "gpt-4o-mini"`
- Effective model: `gpt-4o-mini`

### Memory Pin vs Reality
- Memory pin `gpt-5.4-mini` is STALE — per `openalice-ai-reviewer.ts:28-30` comment:
  > "gpt-5.4-mini" was a Codex CLI internal namespace name, not a real OpenAI public-API model. OpenAI returned 4xx model_not_found.
- The code was already fixed to use `gpt-4o-mini` as default.
- No `OPENAI_MODEL` env var needed — absence is correct.

### Verdict
- NOT a regression. `gpt-4o-mini` is correct. Memory pin `gpt-5.4-mini` = stale artifact from Codex CLI namespace confusion.
- OpenAI quota at time of verify: used=0, limit=200, resetDay=2026-05-13 (no calls consumed — blocked path did not invoke LLM).

---

## Segment C — Hard Line Firewall

| Check | Result |
|---|---|
| 0 promote wording (進場/賣出/買進/出脫/做多/做空/目標價/勝率/approved/live-ready) | PASS — sections=[], no AI content generated |
| Neutral tone (觀察到/資料顯示) | PASS — no AI content; blocked state honest |
| 0 token/credential leak in response | PASS — no Bearer/sk-proj/finmind_token in full response |
| Source labels present | PASS — blockedSources explicitly listed in sourcePack |
| Hallucination check recorded | PASS — hallucinationCheckPassed=null correct for blocked state (LLM never called) |

---

## Regression (5 checks)

| Check | Result |
|---|---|
| /health uptime normal | PASS — status:ok, uptime:248s, deploymentId:703b161a matches |
| /api/v1/briefs?date=2026-05-13 HTTP 200 | PASS — 200, 11 briefs returned |
| /api/v1/lab/strategy/cont_liq_v36/snapshot 200 v47 | PASS — 200, schema=lab_tr_strategy_snapshot_v0, no compoundReturn |
| /api/v1/market/overview/twse 200 | PASS — 200, source=twse_openapi |
| audit-logs broker.* 24h count = 0 | PASS — 0 broker audit entries |

---

## Hard-Line Status Summary

- prod broker write 24h = 0: PASS
- 0 promote wording in generated brief: PASS (sections=[])
- 0 token leak: PASS
- regression 5 checks: ALL PASS
- OPENAI_MODEL = gpt-4o-mini (memory pin gpt-5.4-mini was stale alias — not regression)

---

## Root Cause: BLOCKED_DATA_QUALITY

Three data sources missing from prod:

1. `cont_liq_yaml:no_files_found` — `reports/trading_room/cont_liq_period1_daily/` yaml files not in Railway deployment (monorepo root path, Railway CWD trap analog). Operator must commit today's yaml OR set LAB_YAML_LOCAL_DIR env var.
2. `tw_institutional_buysell:empty` — table exists but 0 rows. Needs backfill via POST /api/v1/internal/finmind/backfill (PR #393 pending merge/backfill).
3. `companies_ohlcv:empty` — same as above, needs backfill.

All three are DATA gaps, not code bugs. Endpoint behavior is correct — it refuses to fake data and returns BLOCKED_DATA_QUALITY with full source attribution.

---

## Verdict

**OPENALICE_STRATEGY_BRIEF_PASS_WITH_CAVEATS**

- Endpoint live, auth-gated, routes correct: PASS
- Generate fires, source pack assembled, snapshots all OK: PASS
- BLOCKED_DATA_QUALITY for expected data gaps (yaml/OHLCV/institutional): CORRECT BEHAVIOR
- Hard lines 5/5: PASS
- Regression 5/5: PASS
- OPENAI_MODEL: gpt-4o-mini CORRECT (memory pin stale)
- OpenAI call count: 0 (no quota consumed — gate fires before LLM path)
- Cron will first auto-fire tomorrow 14:00 TST

## Still Blocked

- cont_liq yaml files not committed/deployed to Railway
- tw_institutional_buysell + companies_ohlcv tables need backfill (PR #393 data)
- Until these three data sources are present, generate will always return BLOCKED_DATA_QUALITY

## Next Fix Owner

- Jason: confirm PR #393 backfill executed for tw_institutional_buysell + companies_ohlcv
- Operator (楊董/Jason): commit today's cont_liq yaml to `reports/trading_room/cont_liq_period1_daily/2026-05-13.yaml`
- Once data present: re-trigger POST generate to get first AI brief
