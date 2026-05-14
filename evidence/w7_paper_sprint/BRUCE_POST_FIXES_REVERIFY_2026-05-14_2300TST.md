# Bruce Post-Fix Re-Verify — 2026-05-14 23:00 TST

**Verifier:** Bruce  
**Deploy:** PR #472 + #473 merged → deploymentId=552a28bb startedAt=2026-05-14T14:57:34Z (22:57 TST)  
**Auth:** Owner (qazabc159@gmail.com)

---

## 0. Deploy Confirm

| Item | Value |
|------|-------|
| Old deploymentId | 7cc8a3f7-e0f1-4e5c-a967-8c6a08b04308 |
| New deploymentId | 552a28bb-c2c6-451c-8023-ade72e70f1ed |
| New startedAt | 2026-05-14T14:57:34Z (22:57 TST) |
| CI PR #472 | success |
| CI PR #473 | success |

---

## 1. Backfill Trigger (Task 1)

**Command:** `POST /api/v1/admin/brief/backfill {"from":"2026-05-14","to":"2026-05-14"}`  
**Response:** `{"data":{"from":"2026-05-14","to":"2026-05-14","fired":["2026-05-14"],"skipped":[],"errors":[]}}`  
**Result:** HTTP 200, fired=["2026-05-14"]

**Finding:** Backfill tick was called for 2026-05-14. However, the existing published brief (createdAt=2026-05-14T00:16:48Z, id=29defd06) was NOT replaced — the pipeline dedup at `runPipelineTick` line 1448 (`brief_already_exists_for_date`) skips re-generation when a published brief exists. The `fired` array reflects the tick being invoked, not successful re-generation. The existing brief pre-dates PR #471 sanitizer (merged 22:54 TST).

**Status: PARTIAL — backfill API works but cannot overwrite existing published brief**

---

## A. PTR 962.xx Cleanup (PR #472)

**Probe:** `GET https://app.eycvector.com/api/ui-final-v031/paper-trading-room`  
**Result:** HTTP 200, size=170,051 bytes

| Check | Result |
|-------|--------|
| `962.` regex count | **0** (PASS) |
| `等待KGI` mentions | 1 (PASS — correct placeholder) |

**Verdict: PASS**

---

## B. TAIEX Display Label (PR #473 P1-A)

**Probe:** `GET /api/v1/market/overview/twse`  
**Response excerpt:** `{"taiex":{"value":41751.75,...},"sourceState":"live","taiexDisplayLabel":"今日收盤"}`

| Check | Result |
|-------|--------|
| taiexDisplayLabel field present | YES |
| Value when sourceState=live | "今日收盤" (PASS) |
| Value when sourceState=lkg | "上日收盤" (spec: untestable off-hours) |
| sourceState at verify time | live |

**Note:** Initial Python parse attempted `d.get('taiexDisplayLabel')` at wrong level (not nested). Raw curl confirmed field is top-level in TWSE response.

**Verdict: PASS**

---

## C. Lab netAbsoluteReturnPct (PR #473 P1-B)

**Probe:** `GET /api/v1/lab/strategy/cont_liq_v36/snapshot`  
**Path:** `snapshot.headlineMetrics.netAbsoluteReturnPct`

| Check | Result |
|-------|--------|
| netAbsoluteReturnPct | **759.87** (PASS) |
| netAbsoluteReturnAfterCost | 7.5987 (PASS — source value) |
| strategyNetAbsoluteReturnPct | 400.89 (common-window, correct) |
| source | local_embedded |
| stale_reason | null |

**Note:** Initial Python query used `d.get('headlineMetrics')` (top-level) instead of `d['snapshot']['headlineMetrics']`. Corrected via saved JSON file parse.

**Verdict: PASS**

---

## D. 5/14 Brief Sanitizer (PR #471 + Backfill)

**Brief ID:** 29defd06-84e8-4f5f-83b8-20f434c971fd  
**createdAt:** 2026-05-14T00:16:48Z (08:16 TST — PRE-sanitizer deploy)  
**status:** published

| Check | Result |
|-------|--------|
| U+FFFD in section 0 (Market Overview) | **24** (FAIL) |
| U+FFFD in section 1 (Theme Summaries) | **46** (FAIL) |
| U+FFFD in section 2 (Company Notes) | 0 (PASS) |
| Total U+FFFD | **70** (FAIL) |
| "內部研究草稿" | False (PASS) |
| "供人員審閱" | False (PASS) |
| TBD | False (PASS) |

**Root cause:**  
- 5/14 brief was generated at 08:16 TST, before PR #471 sanitizer merged (22:54 TST)
- Backfill called the pipeline tick, but `runPipelineTick` dedup check skips re-generation if published brief already exists for that date (line 1448: `brief_already_exists_for_date`)
- `fired=["2026-05-14"]` in backfill response = tick invoked, NOT = brief replaced
- Sanitizer (`scrubReplacementChars`) correctly uses `/[ufffd]+/g` — logic is correct but never ran on this brief
- FFFD source: CP950-corrupted "低軌衛星" and "5G" theme thesis fields in DB → LLM echoed replacement chars → pre-sanitizer pipeline stored them

**Fix required:** Either (a) delete existing 5/14 published brief from DB so backfill can re-generate, or (b) modify `runPipelineBackfillRange` to force-override existing briefs. Owner of fix: Jason.

**Verdict: FAIL — pre-sanitizer brief in prod**

---

## Summary

| Item | Result |
|------|--------|
| A. PTR 962.xx cleared | PASS |
| B. TAIEX taiexDisplayLabel | PASS |
| C. Lab netAbsoluteReturnPct=759.87 | PASS |
| D. 5/14 brief U+FFFD=0 | FAIL (70 remaining, pre-sanitizer brief) |

**POST_FIXES_VERIFY_PASS: 3/4**

---

## Blocker for D

**Severity:** P1 (user-visible mojibake in published brief)  
**Owner:** Jason  
**Action required:** Add `force` param to backfill that deletes existing brief before re-generating, OR delete 29defd06 from DB directly and re-run backfill.  
**Cannot be resolved by Bruce** — requires DB delete or API schema change.

---

## Can Deploy / Ship?

- A/B/C: SHIP — features confirmed live
- D: NOT fully resolved — existing 5/14 brief still has mojibake. Tomorrow's brief (generated post-sanitizer deploy) will be clean. For today: requires Jason DB intervention.
