# OpenAlice 100-Company Exposure Batch — Operational Design

**Date**: 2026-05-01 15:55 Taipei (W7 paper sprint Day 2, Block 1 Lane B)
**Author**: Elva
**Scope**: Operational design for re-scoring 100 companies' 5-dim exposure scores via OpenAlice. **NOT** a schema change — schema already exists from W6 L4 design.
**Status**: DRAFT — gated on 楊董 ACK + OpenAlice runner availability (NSSM service status check).

---

## 0. Why this is the right next step

Per `institutional_grade_roadmap_2026-05-01.md` §3 P1-11: **OpenAlice 跑首批 100 公司 exposure 重評（產出真評分）**.

Current data quality state per `project_data_quality.md` (memory entry):
- 1734 / 1736 companies have **seed placeholder exposure** (5 dimensions all = 0.5 default)
- UI hides these gracefully via 4-state BLOCKED, but at institutional grade we want **real evaluations** — not hidden empty cells
- OpenAlice infrastructure is LIVE: prompt registry + 5 task types in production (per L4 D5/D6/D7 design); `theme_summary` + `company_note` + `daily_brief` + `theme-signal` + `risk-brief` already running

P1-11 is the operational push to fill the empty exposure score column for the **first 100 most-tradable companies** (TWSE tier, high market cap, high relations density), so the screener / radar / theme cards stop showing "BLOCKED — exposure unavailable" for the trading universe that matters.

---

## 1. Scope (what & what NOT)

### IN SCOPE
- **Universe**: top-100 by `coverage_priority_score = market_cap × keyword_count × relations_count × (1 if TWSE-listed)` over `companies` table. Single SQL pick — frozen as `evidence/w7_paper_sprint/openalice_100co_universe_2026-05-XX.json` once selected
- **5 exposure dimensions** rated 0.0–1.0 each (already in contracts):
  1. `aiExposure` — AI / GPU / TPU revenue / partnership exposure
  2. `taiwanExposure` — domestic Taiwan vs offshore revenue mix
  3. `usExposure` — US market revenue / customer dependency
  4. `chinaExposure` — China market exposure (revenue + supply chain)
  5. `volatilityProfile` — historical volatility tier (low/mid/high)
- **OpenAlice task type**: NEW `company_exposure_rebrief` (extends existing `company_note` template with 5-dim JSON output schema) — registered in prompt registry
- **Gate**: paper-only research output. **NO** trading decision auto-fires from these scores. `aiExposure ≥ 0.7` does not auto-promote to order.

### OUT OF SCOPE (explicitly)
- Full 1634-company batch (P2-1, deferred to W8+)
- CompanyGraph completion (P2-2)
- Live tradable scoring (zero broker linkage)
- Quote-time exposure recompute (no realtime push; this is offline batch)
- Migration touch (5-dim columns already exist on `companies` from W6 L4)

---

## 2. Top-100 selection SQL

```sql
-- evidence/w7_paper_sprint/openalice_100co_universe_pick.sql (DRAFT)
WITH coverage_score AS (
  SELECT
    c.id,
    c.ticker,
    c.name_zh,
    c.market_cap_ntd_million,
    COALESCE(c.is_twse_listed, false)              AS is_twse,
    (SELECT COUNT(*) FROM company_keywords ck WHERE ck.company_id = c.id) AS kw_count,
    (SELECT COUNT(*) FROM company_relations cr WHERE cr.company_id = c.id OR cr.related_company_id = c.id) AS rel_count
  FROM companies c
  WHERE c.deleted_at IS NULL
    AND c.market_cap_ntd_million IS NOT NULL
    AND c.market_cap_ntd_million > 0
)
SELECT
  id, ticker, name_zh,
  market_cap_ntd_million,
  kw_count,
  rel_count,
  ROUND(
    (LOG(market_cap_ntd_million) * 10
     + kw_count
     + rel_count * 0.5
     + (CASE WHEN is_twse THEN 50 ELSE 0 END))::numeric,
    2
  ) AS coverage_priority_score
FROM coverage_score
ORDER BY coverage_priority_score DESC
LIMIT 100;
```

Run once on production replica → snapshot result to `evidence/w7_paper_sprint/openalice_100co_universe_2026-05-XX.json`. Universe is FROZEN per session; re-running on different day produces different list, that's fine — just freeze for traceability.

---

## 3. Task type design

### 3.1 Prompt template (additions to existing registry)

```yaml
# memory/plans/openalice_prompts/company_exposure_rebrief.yaml (DRAFT)
type: company_exposure_rebrief
model: gpt-5.4-mini       # OPENAI_MODEL pinned per memory feedback
maxTokens: 800
temperature: 0.2
systemPrompt: |
  You are an institutional-grade Taiwan equity research analyst. Score the
  given company across 5 exposure dimensions, returning ONLY valid JSON
  matching the provided schema. Each dimension must be 0.0–1.0 inclusive.
  Provide a 1-sentence rationale per dimension. NO speculation beyond known
  public information. NO trading recommendations.
userPromptTemplate: |
  Company: {{name_zh}} ({{ticker}})
  Market cap: {{market_cap_ntd_million}} NTD-million
  Top keywords: {{keywords_top10}}
  Related companies: {{related_companies_top5}}

  Score these 5 exposure dimensions (0.0–1.0):
  1. aiExposure — AI/GPU/TPU revenue or partnerships
  2. taiwanExposure — domestic TW revenue share
  3. usExposure — US market dependency
  4. chinaExposure — China market + supply-chain dependency
  5. volatilityProfile — implied volatility tier (low / mid / high)

  Output JSON ONLY:
  {
    "aiExposure": 0.0,        "aiRationale": "...",
    "taiwanExposure": 0.0,    "taiwanRationale": "...",
    "usExposure": 0.0,        "usRationale": "...",
    "chinaExposure": 0.0,     "chinaRationale": "...",
    "volatilityProfile": 0.0, "volatilityRationale": "...",
    "confidence": 0.0,
    "evaluatedAt": "ISO-8601"
  }
outputSchemaRef: contracts/openalice/company-exposure-rebrief.schema.json
```

### 3.2 Output validation

- Producer must `JSON.parse` + zod-validate against schema before write
- Failures → write to `content_drafts` table with `status='REJECTED'` + `failure_reason`, surface in admin queue
- No partial writes — atomic per-company

---

## 4. Cost & throughput estimate

- **Per-call cost** (gpt-5.4-mini @ ~$0.15/M-input, $0.60/M-output): ~600 input tokens + 400 output tokens ≈ **$0.000333 / company**
- **Batch cost (100 companies)**: ~**$0.034**
- **Throughput**: prompt registry default rate-limit is 2 RPS → **~50s wall-clock** for 100 calls (well within single overnight cycle)
- **Failure budget**: <5% transient failures expected (OpenAI 429 / 500); retry with exponential backoff per existing OpenAlice runner pattern

---

## 5. Pipeline stages

```
Stage A — Universe pick (manual, one-shot, ~5min)
  → operator runs SQL → JSON snapshot → commit evidence

Stage B — Worker enqueue (Jason backend, ~1h impl)
  → new endpoint POST /api/v1/openalice/enqueue/exposure-rebrief
  → body: { universeFile: "openalice_100co_universe_2026-05-XX.json" }
  → for each row: insert into openalice_jobs (task_type='company_exposure_rebrief', payload={companyId, ...}, status='QUEUED')

Stage C — Worker run (existing OpenAlice runner, no code change)
  → NSSM service picks up QUEUED jobs
  → calls OpenAI gpt-5.4-mini per row
  → validates output → writes to content_drafts (REJECTED on schema fail)

Stage D — Admin review queue (existing UI, no change)
  → human approves / rejects each draft
  → on approve: UPDATE companies SET ai_exposure=, taiwan_exposure=, ... WHERE id=

Stage E — Verify (Bruce, ~30min)
  → SELECT count(*) FROM companies WHERE ai_exposure != 0.5 → expect 100 (post-approval)
  → frontend smoke: /companies/2330 should show real ai_exposure not BLOCKED

Stage F — UI re-render (passive)
  → next page load picks up real values; 4-state badge LIVE not BLOCKED for 100 companies
```

---

## 6. Hard-line / stop-line matrix

| Rule | Compliance |
|---|---|
| No live broker submit affected | ✓ — pure read/write to `companies` + `content_drafts` |
| No KGI SDK touch | ✓ — OpenAlice path only |
| OPENAI_MODEL pinned `gpt-5.4-mini` | ✓ — explicit in prompt YAML |
| No auto-promote to trading decision | ✓ — Stage D human approve gate |
| No migration | ✓ — schema already exists per W6 L4 |
| No secret rotation | ✓ — uses existing OPENAI_API_KEY |
| No mass dispatch without 楊董 ACK | ✓ — gated; this doc is design only |
| Cost ceiling | ✓ — $0.034 per batch, far below any concern |
| Idempotency | ✓ — re-running on same universeFile → existing rows in `companies` updated, no duplicate `content_drafts` if `(companyId, task_type, evaluation_date)` unique constraint enforced |

---

## 7. Acceptance criteria

1. Universe pick SQL executes on prod replica, returns 100 rows
2. Result frozen to JSON evidence file
3. New prompt template registered + producer routing in worker
4. POST `/api/v1/openalice/enqueue/exposure-rebrief` returns `{ enqueued: 100 }`
5. Worker drains queue (~50s wall-clock), 0 hard failures
6. Admin queue surfaces 100 drafts (or N rejected with reason)
7. Operator approves all 100 (or rejects with audit reason)
8. Post-approval: `SELECT COUNT(*) FROM companies WHERE ai_exposure != 0.5` returns 100
9. `/companies/2330` (and 99 others) frontend shows real exposure values, NOT placeholder, NOT BLOCKED
10. Bruce 4-state harness PASS on `/companies/[symbol]` for 5 sample companies from the 100

---

## 8. Effort estimate

| Lane | Owner | Files | Hours |
|---|---|---|---|
| Universe pick SQL + run | Elva | 2 (SQL + JSON snapshot) | 0.5 |
| Prompt template + schema | Jason | 2 (YAML + zod schema) | 1 |
| Worker enqueue endpoint | Jason | 1 (server.ts extend) | 1.5 |
| Producer routing | Jason | 1 (worker handler) | 1 |
| Admin queue UI render (already exists) | — | 0 | 0 |
| Operator review session (100 drafts) | 楊董 | — | 1 |
| Verify + frontend smoke | Bruce | — | 0.5 |
| **Total impl** | — | — | **~5h** |
| **Total wall-clock incl. operator review** | — | — | **~6h** |

Fits within W7 paper sprint Day 4–5 window (5/4–5/5 trading days), parallel to Codex Contract 2/3 wiring.

---

## 9. Sequencing — when to dispatch

**Not yet** — gated on:
1. ✓ Codex Contract 1 wiring DONE (today, in flight)
2. ◯ Codex working tree clean (Codex still on cleanup phase)
3. ◯ Jason 0020 v2 merge DONE (Jason offline)
4. ◯ Mike + Pete + 楊董 ACK on 0020 v2 (gated by 3)
5. ◯ 楊董 explicit ACK on this design

When 1-4 done → dispatch Jason for Stage B+C impl (~3h), parallel to Codex Contract 2/3 wiring. Stage A (universe pick) Elva-self can do anytime once 楊董 ACKs.

---

## 10. Risk / failure modes

| Risk | Mitigation |
|---|---|
| OpenAI 429 rate-limit | exponential backoff; existing retry pattern in worker |
| LLM hallucinates exposure score with no basis | low confidence flag in output; admin can reject; 100 is small enough for full human review |
| Schema validation failure | drafts go to REJECTED bucket; admin queue surfaces with reason |
| Universe pick changes between runs | one-shot frozen JSON; treat as evidence artifact, not live query |
| Operator review fatigue (100 drafts) | UI batches by sector; operator can approve in groups; rejection loops back for re-prompt with hint |

---

## 11. References

- Existing 5-task-type design: `evidence/w7_paper_sprint/l4_openalice_5_task_types_design.md`
- OPENAI_MODEL pin: `feedback_openai_model_pinned_gpt54mini.md`
- Data quality memory: `project_data_quality.md` (1734/1736 placeholder exposure)
- Worker runner pattern: existing NSSM service (`P0.5-5 Runner daemon` from W3)
- Roadmap entry: `evidence/w7_paper_sprint/institutional_grade_roadmap_2026-05-01.md` §3 P1-11

---

**Drafted in Block 1 of 68h sprint (5/1 12:33 → 5/4 09:00). Implementation gated by 楊董 ACK + Jason availability + Contract 1 cleanup. ~5h impl + ~1h operator review = ~6h total wall-clock.**
