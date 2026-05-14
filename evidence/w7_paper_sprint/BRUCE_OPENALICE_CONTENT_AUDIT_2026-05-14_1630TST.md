# Bruce OpenAlice Content Audit — 2026-05-14 16:30 TST

**Auditor:** Bruce (Verifier/Release)
**Trigger:** 楊董質疑「OpenAlice 報告一堆錯誤亂碼」
**Method:** Live prod curl — auth Owner → /api/v1/briefs?limit=50 → /api/v1/briefs/:id × 5 → /api/v1/content-drafts?targetTable=daily_briefs → /api/v1/openalice/observability
**Verdict:** MEDIOCRE (1 confirmed mojibake, 3 generic-template briefs, reviewer gate not firing)

---

## Step 1 — Auth

```
POST https://api.eycvector.com/auth/login
→ role=Owner userId=c1753415-5580-463d-a43a-d2a3987ab250
```

---

## Step 2 — Brief List

Total published briefs: 12
All status=published.
Date coverage: 2026-04-24, 2026-04-25, 2026-05-03 ~ 2026-05-14 (one per day).

```
id=29defd06  publishedAt=2026-05-14T00:16:48.497Z  date=2026-05-14  sections=3
id=f3c951a9  publishedAt=2026-05-13T00:47:18.726Z  date=2026-05-13  sections=3
id=5a18441d  publishedAt=2026-05-12T14:01:26.085Z  date=2026-05-12  sections=4
id=d6acc58c  publishedAt=2026-05-12T14:02:21.702Z  date=2026-05-11  sections=5
id=bede2d1f  publishedAt=2026-05-12T14:02:22.714Z  date=2026-05-08  sections=5
```

---

## Step 3 — Per-Brief Quantitative Assessment

### BRIEF 29defd06 — 2026-05-14 (MOST RECENT)

| Field | Value |
|-------|-------|
| publishedAt | 2026-05-14T00:16:48.497Z |
| sections | 3 |
| headings | Market Overview / Theme Summaries / Company Notes |

**Section[0] Market Overview** — chars=399, zh=113, en=176
- CONFIRMED MOJIBAKE at pos 81–121: `�C�y�D�ìP�q�T������A�ѽu�B�a�����B�g�W�Ҳ�`
- This is the thesis field for theme "低軌衛星". U+FFFD replacement chars = garbled bytes survived JSON encode.
- Root cause: 低軌衛星 theme thesis was stored/retrieved with encoding mismatch (likely CP950 input into UTF-8 DB column without proper translit).
- Other 4 themes in same section render correctly (電動車/資料中心/磷化銦/碳化矽).

**RAW MOJIBAKE EXCERPT (section[0], position 67–122):**
```
— Priority 3: 低軌衛星 → [GARBLED: "低軌衛星主要應用於..." original text unknown]
actual bytes: � C � y � D � ì P � q � T � � � � � � A � Ѽ u � B ...
```

**Section[1] Theme Summaries** — chars=1200, zh=142, en=599 — NO ERRORS
- Contains rule-template fallback label: `Generated: 2026-05-13 (rule-template fallback)` — this is visible to user.
- Linked Companies (0): (none) — all 5 themes have zero linked companies. Structurally correct but content-thin.

**Section[2] Company Notes** — chars=1271, zh=487, en=375 — NO ERRORS
- Sample: 台鎔科技(6947) note is coherent, factual, reasonable length.

**Error Summary:**
- [object Object]: NONE
- undefined string: NONE
- NaN: NONE
- Template var `{{}}`: NONE
- Mojibake: YES — 1 instance (低軌衛星 thesis, ~40 chars garbled)
- Truncated sentence: NONE
-荒唐數字: NONE (no numeric claims in this brief)

**reviewerVerdict:** null
**auditChain.adversarialReview:** null
**auditChain.hallucinationCheck:** null
**auditChain.hardReject.rejected:** false

---

### BRIEF f3c951a9 — 2026-05-13

| Field | Value |
|-------|-------|
| publishedAt | 2026-05-13T00:47:18.726Z |
| sections | 3 |
| headings | 市場總覽 / 技術觀察 / 風控警示 |

**Section[0] 市場總覽** — chars=144, zh=127, en=0 — NO ERRORS
```
截至2026年5月13日，台股市場持續呈現風險偏好狀態，日線資料顯示出穩定的交易量和活躍的市場情緒。法人籌碼資料顯示，外資在部分股票上有賣出動作，但整體市場仍然受到投資者的青睞。儘管月營收資料目前狀態不佳，無法提供具體數據，但市場的基本面仍然顯示出一定的韌性，投資者對未來的展望保持樂觀。
```
**FACTUAL CLAIM ISSUES:**
- 「日線資料顯示出穩定的交易量和活躍的市場情緒」— vague, no numbers, not verifiable.
- 「外資在部分股票上有賣出動作」— no tickers, no amounts.
- 「月營收資料目前狀態不佳」— honest admission but provides zero specific data.
- Cross-check with /market-data/overview: overview returns giant policy envelope, no TAIEX number extractable at audit time. **Cannot confirm or deny numeric claims because no specific numbers were made.**

**Content Quality Issue:** This brief contains NO specific numbers, NO specific tickers, NO TAIEX value. Pure vague language. Not "wrong" but essentially content-free.

**reviewerVerdict:** null
**auditChain.adversarialReview:** null
**auditChain.hallucinationCheck:** null

---

### BRIEF 5a18441d — 2026-05-12

| Field | Value |
|-------|-------|
| publishedAt | 2026-05-12T14:01:26.085Z |
| sections | 4 |
| headings | 市場概況 / 主題觀察 / 風險重點 / 研究觀察 |

**Section[0] 市場概況** — chars=121, zh=111, en=0 — NO ERRORS
```
目前未提供日期、主題與個股更新，因此本日觀點以中性框架為主。整體市場敘事暫缺明確催化...
```
**NOTE:** "目前未提供日期" — the brief literally states it has no input data. This is the LLM's fallback template when sourcePackCount=0. Published anyway.

**reviewerVerdict:** null
**auditChain.adversarialReview:** null
**auditChain.hallucinationCheck:** null

---

### BRIEF d6acc58c — 2026-05-11

| Field | Value |
|-------|-------|
| publishedAt | 2026-05-12T14:02:21.702Z (published on 5/12 for 5/11 date) |
| sections | 5 |
| headings | 盤勢總覽 / 主題面觀察 / 公司觀察 / 風險提示 / 後續追蹤重點 |

**Section[0] 盤勢總覽** — chars=123, zh=114, en=0 — NO ERRORS
```
目前缺乏明確的外部主題與近期公司訊息，整體判斷偏向中性整理格局...
```
Again LLM fallback template ("缺乏明確"). No data input. Published anyway.

**Section[2] 公司觀察** — chars=155, zh=143, en=0 — NO ERRORS
```
目前無近期公司備忘錄可供交叉驗證，建議後續建立基本監測框架...
```
No company data → generic framework advice.

**reviewerVerdict:** null / adversarialReview: null / hallucinationCheck: null

---

### BRIEF bede2d1f — 2026-05-08

| Field | Value |
|-------|-------|
| publishedAt | 2026-05-12T14:02:22.714Z (published on 5/12 for 5/8 date) |
| sections | 5 |
| headings | 整體市場狀態 / 主題觀察 / 公司觀察 / 風險提示 / 後續追蹤 |

Section[4] 後續追蹤 (last sentence):
```
此版本僅作內部研究草稿，供人員審閱後再決定後續分析方向。
```
**STOP-LINE CANDIDATE:** brief says "內部研究草稿" — this is published to users and says it's an internal draft. This is a product-grade problem.

**reviewerVerdict:** null / adversarialReview: null / hallucinationCheck: null

---

## Step 3 — Factual Cross-Check

| Claim | Source | Cross-check Result |
|-------|--------|-------------------|
| 5/13 brief: "台股市場持續呈現風險偏好狀態" | f3c951a9 sec[0] | NO_NUMBER — cannot verify/refute |
| 5/13 brief: "外資在部分股票上有賣出動作" | f3c951a9 sec[0] | NO_SPECIFIC_DATA — unverifiable |
| 5/14 brief: 低軌衛星 thesis garbled | 29defd06 sec[0] | CONFIRMED_ERROR — mojibake |
| All 5 briefs: no TAIEX number cited | all | NOT_APPLICABLE (none cited) |

**Factual verdict:** No荒唐數字 found because briefs contain almost NO specific numbers. They avoid numerical claims entirely — this sidesteps hallucination but makes content essentially useless for trading purposes.

---

## Step 4 — OpenAlice Pipeline Health

### content_drafts (targetTable=daily_briefs, last 50 drafts)

Total daily_briefs drafts in last 50: 15
```
approved:        4  (26.7%)
rejected:       10  (66.7%)
awaiting_review: 1  ( 6.7%)
```

**Rejection reasons (sample):**
```
[ai-reviewer] Contains actionable trading advice and guarantees. | issues: 1; 3
[ai-reviewer] The draft contains actionable trading advice suggesting to check company updates
[ai-reviewer] The draft contains an empty date field which violates hard reject rule 6. | issues: 6
source_pack_null_stale_dedup_blocking_pipeline_retry_D3_fix
[ai-reviewer] The draft contains actionable trading advice and lacks a specific date. | issues: 1; 6
```

**Pattern:** ai-reviewer is REJECTING briefs that give specific recommendations, leaving only vague ones that pass. This is a systematic filter creating a selection bias toward content-free output.

### Reviewer Verdict on Published Briefs

ALL 5 published briefs checked:
```
reviewerVerdict:          null (5/5)
auditChain.adversarialReview: null (5/5)
auditChain.hallucinationCheck: null (5/5)
auditChain.hardReject.rejected: false (5/5)
```

**This means:** adversarial review and hallucination check are NOT running on published briefs. hardReject passes (no buy/sell/target-price). The other two gates produce null — they either skipped or the results are not stored in the brief record.

### observability pipeline

```
lastGeneratedAt:  null
lastReviewedAt:   null
lastPublishedAt:  null  ← contradicts 12 published briefs existing in DB
nextRunAt:        null
lastFailureReason: null
sourcePackCount:   0
dispatcherCron.lastFiredAt: null
dispatcherCron.nextRunAt: 2026-05-15T01:00:00.000Z (tomorrow 09:00 TST)
```

**Critical finding:** pipeline observability shows all null even though 12 published briefs exist. The observability endpoint is NOT tracking the publishing events that produced these briefs. This is a monitoring gap (P1).

### 7-day brief volume

DB total: 12 published briefs (spanning 2026-04-24 to 2026-05-14)
Last 7 days (2026-05-07 to 2026-05-14): 6 briefs (one per trading day approx)
Failed/draft in last 50 content_drafts: 10 rejected + 1 awaiting = 11 non-published

---

## Findings Summary

| # | Finding | Severity | Evidence Location |
|---|---------|----------|------------------|
| F1 | CONFIRMED MOJIBAKE: 低軌衛星 thesis in 2026-05-14 brief sec[0] (~40 chars U+FFFD) | P1 | brief 29defd06 section[0] pos 81-121 |
| F2 | ALL PUBLISHED BRIEFS: adversarialReview=null, hallucinationCheck=null | P1 | 5/5 briefs checked — reviewer gate not populating result |
| F3 | 5/12 + 5/11 + 5/8 briefs: LLM fallback template ("目前缺乏...") — published with zero data input | P2 | briefs 5a18441d, d6acc58c, bede2d1f |
| F4 | brief bede2d1f (5/8): says "此版本僅作內部研究草稿" — visible to end users | P1 | bede2d1f section[4] last sentence |
| F5 | Rule-template fallback label "Generated: 2026-05-13 (rule-template fallback)" visible in 5/14 brief Theme Summaries | P2 | 29defd06 section[1] |
| F6 | ai-reviewer rejection rate 66.7% — rejecting "actionable advice" leaving only vague content | P2 | content-drafts daily_briefs 10/15 rejected |
| F7 | observability lastPublishedAt=null despite 12 published briefs | P1 | /openalice/observability pipeline block |
| F8 | All 5 reviewed briefs contain ZERO specific numbers (price/TAIEX/volume) | Observation | cross-check step |

---

## Verdict

**MEDIOCRE**

Not "BAD" (no [object Object], no荒唐數字, no broken JSON). Not "GOOD" (mojibake F1, internal-draft wording F4, hallucination-check not firing F2, content-free LLM fallback pattern F3).

楊董看到「亂碼」的是 F1 (低軌衛星 thesis mojibake in today's brief). 這是真實存在的亂碼，不是誤報。

---

## Recommended Actions

| Action | Owner | Priority |
|--------|-------|----------|
| Fix encoding in theme thesis storage/retrieval (低軌衛星 and any other CP950 input themes) | Jason | P1 |
| Fix brief bede2d1f: remove "內部研究草稿" wording from published brief | Jason | P1 |
| Investigate why adversarialReview + hallucinationCheck = null on published briefs (reviewer pipeline not persisting verdict) | Jason | P1 |
| Fix observability lastPublishedAt to reflect actual publish events | Jason | P2 |
| Remove rule-template fallback label from user-visible output | Jason | P2 |

---

## Raw JSON Samples

### brief 29defd06 section[0] body (raw, with mojibake visible):
```
Market State: Balanced

Active Themes:
• 低軌衛星 [Discovery/Balanced] — Priority 3: [GARBLED ~40 chars U+FFFD]
• 電動車 [Discovery/Balanced] — Priority 3: 電動車完整供應鏈，從電池材料到功率元件到車用電子
• 資料中心 [Discovery/Balanced] — Priority 3: 超大規模資料中心基礎設施，涵蓋伺服器、網通、電源、散熱
• 磷化銦 [Discovery/Balanced] — Priority 3: III-V族化合物半導體，光通訊雷射及高速光電元件基板材料
• 碳化矽 [Discovery/Balanced] — Priority 3: 第三代半導體材料，耐高壓高溫，電動車逆變器及充電樁關鍵材料
```

### brief f3c951a9 section[0] body (5/13, no errors):
```
截至2026年5月13日，台股市場持續呈現風險偏好狀態，日線資料顯示出穩定的交易量和活躍的市場情緒。法人籌碼資料顯示，外資在部分股票上有賣出動作，但整體市場仍然受到投資者的青睞。儘管月營收資料目前狀態不佳，無法提供具體數據，但市場的基本面仍然顯示出一定的韌性，投資者對未來的展望保持樂觀。
```
(No errors but no specific data either)

### brief bede2d1f section[4] tail (INTERNAL DRAFT WORDING):
```
此版本僅作內部研究草稿，供人員審閱後再決定後續分析方向。
```

---

*Generated: 2026-05-14T08:30 UTC (16:30 TST)*
*Commands: curl /auth/login + /briefs?limit=50 + /briefs/:id ×5 + /content-drafts + /openalice/observability*
*No prod DB writes. No token leaked.*
