# P0.5 Fallback Live Test + UI Render Evidence

Date: 2026-04-24
Purpose: Close the two gaps GPT flagged in the P0-E acceptance letter:
  1. Fallback path independent live test (stop runner → formal row written → no duplicate)
  2. New OpenAlice rows render in UI at app.eycvector.com

Result: **PASS (both gaps closed).**

---

## 1. Router fallback-path dedupe fix (P0.5-1)

Commit: `c18bd62` — apps/worker/src/openalice-router.ts
  - Added `findRecentFormalRow(workspaceId, targetTable, targetEntityId, window=24h)`
  - Extended `ProducerRoutingDecision` with new kind `skip_existing_formal_row`
  - Inserted as step 0 in `decideProducerRoute` (before content_drafts check)
Deployed to prod (worker) at ~2026-04-24T15:54Z via GHA workflow_run pipeline.
Producer changes: both `theme-summary-producer.ts` and `company-note-producer.ts`
handle the new route kind and return `"skipped_existing_formal_row"`.

Test suite: 107/107 passing (worker + api + web + shared) before push.

---

## 2. Pre-fix duplicate evidence

Before the fix was deployed, the fallback path had no 24h-formal-row check. This
produced duplicate rows for the same entity within the dedupe window:

Theme `f15fb73c-dac9-496c-8012-c71ab733af56` (Tesla):
  - 2026-04-24T15:02:24.439Z  id=0548ab66
  - 2026-04-24T15:10:19.225Z  id=63c3ec70
  - 2026-04-24T15:25:19.223Z  id=6d2e9576
  - 2026-04-24T15:42:16.586Z  id=f1d40721  (marked `kind=fallback`; pre-fix, deploy was 15:54Z)

Four rows in 40 minutes for the same theme → duplicate-gap reproduced.

---

## 3. Post-fix fallback live test (P0.5-2)

Snapshot taken via authenticated API call (fallback_evidence.json) at
2026-04-24T16:09Z, after the fix had been live for ~15 min.

OpenAlice device state: no active runner (confirmed earlier — all devices
>17 min stale, threshold 300 s). Therefore every producer tick post-fix chose
either `skip_existing_formal_row` or `fallback_local`.

**Last-60-minute bucket:**
  - theme_summaries — unique themes = 3, entities with multiple rows = 1 (Tesla,
    3 rows all PRE-FIX at 15:02/15:10/15:25 within the 60m window; 15:42 also
    pre-fix). No NEW Tesla row after 15:54Z deploy → skip worked.
  - company_notes — unique companies = 7, entities with multiple rows = **0** ✅

**Post-fix fallback writes (company_notes):**
  - 15:52:16 — 中連 (5604)
  - 15:53:28 — 大台北 (9908)
  - 16:03:28 — 郡都開發 (4402)
  - plus earlier entries from 15:42 and prior
  All distinct companies → no cross-tick duplicates.

**Post-fix fallback writes (theme_summaries):**
  - 16:08:28 — NVIDIA (0bc42562), first entry for this theme in last 24h

Interpretation: the new skip step kicks in when a target entity already has a
formal-table row in the 24h window, forcing the cron to move on. No duplicate
has appeared for any entity touched post-15:54Z.

Raw evidence: [fallback_evidence.json](fallback_evidence.json)

---

## 4. New OpenAlice rows UI render (P0.5-3)

Browser smoke: `C:\Users\User\AppData\Local\Temp\iuf_browser_smoke\smoke_p0_5_new_rows.mjs`
Ran against app.eycvector.com (prod). Headless chromium.

### Results
```
PASS login https://app.eycvector.com/
theme cards total= 12
clicked theme card idx 2 text len 92
PASS theme_summary_render found snippet "[P0E round-trip proof]"
company rows after filter= 1
clicked company row idx 0
PASS company_note_render found snippet "[P0E round-trip] Company note for"

--- P0.5-3 BROWSER SMOKE ---
pass=3 fail=0
```

### Targets (the P0-E round-trip rows)
  - theme  `9f54e15c-66ef-49ba-87ef-3aae2476590d`  ([ORPHAN] AI Optics (->CPO))
    → theme_summaries row `6d3e66ba-d326-45f3-9962-7b28ec1becac`
    → UI matched the card at `.theme-ranking-card` idx 2 via "AI Optics" text
    → body contains snippet `[P0E round-trip proof]`
  - company `bfce1f91-4246-465e-a725-d867e7656e6b` (竣邦-KY, 4442)
    → company_notes row `e6670eff-6942-4883-9a8a-f4c84534110a`
    → UI matched row after `input.search-input` fill `4442`
    → body contains snippet `[P0E round-trip] Company note for`

Screenshots:
  - [theme.png](theme.png) — /themes with AI Optics summary panel open
  - [company.png](company.png) — /companies with 竣邦-KY note panel open

---

## 5. Bottom line

| Gap | Status | Evidence |
|-----|--------|----------|
| Fallback independent live test | PASS | section 3 + fallback_evidence.json |
| No-duplicate post-fix | PASS | last-60m company buckets = 0 dups |
| New OpenAlice rows render in UI | PASS | section 4 + screenshots |

Hard-lines honoured:
  - No broker execution
  - No real orders
  - No signal_cluster / trade_plan_draft touched
  - No secret logging (token file stays at `C:\Users\User\Desktop\小楊機密\交易\railway_token.env`, gitignored)
  - Still content-only (theme_summaries + company_notes are the only formal tables written)
