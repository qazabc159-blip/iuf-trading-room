# BLOCK #5 §3 AI Reviewer Content Quality Audit — Pete 2026-05-07

Auditor: Pete
Date: 2026-05-07
Sprint: W7 Paper Sprint

---

## Scope

This is not a PR desk review. This is a live production content quality audit commissioned by Elva
for BLOCK #5 §3 (OpenAlice / AI reviewer automation policy). The question is not whether endpoints
work — Bruce already verified that. The question is: does the published content actually pass the
seven IUF hard-reject rules, and does the AI reviewer prompt correctly enforce them?

Method:
- POST /auth/login → fresh session cookie
- GET /api/v1/briefs?limit=5 → last 5 published briefs (dates 5/3 through 5/7)
- GET /api/v1/audit-logs?limit=100 → AI reviewer verdict distribution
- Read apps/api/src/openalice-ai-reviewer.ts → prompt and gate logic
- Read apps/api/src/openalice-pipeline.ts classifyDraftTier() → tier classification patterns

---

## 1. Brief Content Verdict Table

| Date | Brief ID (prefix) | generatedBy | Sections | Hard-Reject Verdict | Tier Assessment |
|------|------------------|-------------|----------|---------------------|-----------------|
| 2026-05-07 | 74ca1324 | openalice | 5 | PASS | GREEN |
| 2026-05-06 | 70911cf7 | openalice | 4 | PASS | GREEN |
| 2026-05-05 | d74c5166 | openalice | 5 | PASS | GREEN |
| 2026-05-04 | 200dd457 | openalice | 5 | PASS | GREEN |
| 2026-05-03 | 1cb0e978 | openalice | 3 | PASS | GREEN |

All 5 published briefs pass the 7 hard-reject rules. No buy/sell advice, no target price, no
guarantee language, no Sharpe/win-rate metrics found in any published body.

---

## 2. Per-Brief Issues (1-3 items each)

### 2026-05-07 (74ca1324)
1. **BROKEN/DEPRECATED labels exposed in published content body** — Section "今日市場定調" mentions
   "[BROKEN-1]、[BROKEN-2]、[DEPRECATED]" by name. This is internal metadata leaking into the
   user-facing text. Readers see debug tokens that mean nothing to them.
   Severity: suggestion (content quality, not hard-reject violation).
2. **sourceTrail not in /api/v1/briefs response** — The list endpoint does not return a sourceTrail
   field. This is by design (sourceTrail lives on the content_draft intermediary, not on the
   published daily_brief row). However, §3 audit cannot independently verify claim provenance
   from the brief API alone. Confirmed: this is an audit visibility gap, not a runtime bug.
3. PASS on all 7 hard-reject rules.

### 2026-05-06 (70911cf7)
1. **BROKEN/DEPRECATED labels exposed** — Section "盤勢總覽" mentions "[BROKEN]與[DEPRECATED]項目"
   in published content. Same issue as 5/7.
2. PASS on all 7 hard-reject rules.
3. Thinner than 5/7 (4 sections vs 5) — acceptable, not a violation.

### 2026-05-05 (d74c5166)
1. **Date mismatch** — brief.date=2026-05-05 but createdAt=2026-05-06T05:23:50. The brief was
   generated retrospectively on 5/6 for the 5/5 trading date. The AI reviewer prompt Rule 7
   checks payload.date vs today's date at time of draft creation — this would have rejected the
   brief if the date check fired. It likely did not fire because the draft payload was created
   before the batch publish, or payload.date was set to the target trading date (not today).
   This is an architecture observation, not a published content violation.
2. PASS on all 7 hard-reject rules.
3. No BROKEN labels visible in published body.

### 2026-05-04 (200dd457)
1. **Date mismatch** — brief.date=2026-05-04 vs createdAt=2026-05-06. Same retrospective batch
   generation as 5/5 brief.
2. **BROKEN/DEPRECATED labels exposed** — Section "風險與資料備註" mentions "[BROKEN-1]、[BROKEN-2]
   與 [DEPRECATED]" in published content.
3. PASS on all 7 hard-reject rules.

### 2026-05-03 (1cb0e978)
1. **BROKEN/DEPRECATED labels directly in section body** — Section "Market Overview" contains raw
   bullet points: "• [BROKEN-2] To Fix" / "• [BROKEN-1] To Fix" / "• [DEPRECATED] Photoresist Test".
   This is the most egregious exposure — the AI reviewer passed this as Green-tier and it got
   auto-published. The broken theme labels are raw data artifacts, not analyst commentary.
2. **rule-template fallback content visible** — Section "Theme Summaries" contains
   "Generated: 2026-04-25 (rule-template fallback)" and "runner=rule-template" literally in
   the published body. These are internal pipeline metadata tokens.
3. **Date mismatch** — brief.date=2026-05-03 vs createdAt=2026-05-06. Retrospective batch.

---

## 3. AI Reviewer Audit Log Statistics (last 100 entries)

Source: GET /api/v1/audit-logs?limit=100

| Verdict | Count | % of AI decisions |
|---------|-------|-------------------|
| content_draft.ai_approved | 28 | 40.6% |
| content_draft.ai_rejected | 41 | 59.4% |
| content_draft.ai_yellow_held | 0 | 0% |
| content_draft.ai_manual_review | 0 | 0% |
| **Total AI decisions** | **69** | — |

Pipeline run entries (openalice_pipeline.run): 22 additional entries, all with draftId=null
(sourcePackCount=5, trailComplete=false, skippedReason=null). These are pre-market tick runs that
produced no draft — normal behavior when market data pack is not yet complete enough to generate.

### Reject Reason Analysis

All 41 rejects cite Rule 1 (trading action words), with flagged_issues=['1']. No rejects cite
Rules 2-7. This means the classifier is heavily weighted toward Rule 1 triggering.

Confirmed legitimate rejects (examples with actual buy/sell/進場 content):
- 2026-05-06T21:48:30 — "Contains trading action words: 進場" (hard stop, correctly rejected)
- 2026-05-06T21:10:42 — "Contains trading action words: '買進'" (correctly rejected)
- 2026-05-06T19:14:33 — "Contains trading action words: '買進'" (correctly rejected)

Confirmed false positive rejects (4 identified, significant pattern):
- 2026-05-06T22:10:45 — "Contains trading action words: '修復' implies an action related to trading"
  ("修復" = repair/fix, not a trading action)
- 2026-05-06T22:08:26 — "Contains trading action words: '受惠於半導體製程擴張帶動的工業廢棄物處理需求'
  implies a positive trading action"
  ("受惠" = benefit from, this is a descriptive statement, not an instruction)
- 2026-05-06T19:41:30 — "Contains trading action words: '出貨量' which implies trading activity"
  ("出貨量" = shipment volume/output volume, industry data term not trading advice)
- 2026-05-06T16:58:27 — "Contains trading action words: '關注' implies a trading action"
  ("關注" = observe/pay attention to, universally used in research; not a trading instruction)

False positive rate estimate: at least 4 of 41 rejects (~10%) are demonstrably wrong. Actual
rate may be higher since only the reason string is visible, not the flagged content text.

---

## 4. Reviewer Prompt Evaluation

### Dead Code Finding — CRITICAL STRUCTURAL BUG

`buildReviewPrompt()` in `openalice-ai-reviewer.ts` has a **dead code block at lines 114-145**.

The function has two `return` statements:
- Line 112: `return \`... (correct, PR #255 version with source-label exemptions) ...`;`
- Line 114-145: unreachable second prompt template (the old version without source-label exemptions)

TypeScript does not error on unreachable code by default. The function always returns the FIRST
return statement (lines 71-112). The second block at 114-145 is never executed.

**The live prompt is lines 71-112 — the PR #255 corrected version with non-reject examples.**
This is the good news. The dead code is the old, stricter version.

However, the dead code creates a maintenance hazard: future developers may think both prompts
are used, or may edit the wrong block. This should be cleaned up.

### Hallucination Check Coverage

HALLUCINATION_CHECK_COVERAGE: **partial**

Rule 4 in the live prompt (line 80):
"Contains hallucinated news (specific event, number, or company name cited WITHOUT a source URL)."

Assessment:
- The rule is stated correctly in the prompt.
- However, the model is asked to evaluate hallucination based on the draft payload JSON alone.
  The draft payload contains the LLM-generated text but does NOT contain the original source data
  that was used to generate it. The AI reviewer cannot independently cross-check a claim like
  "AI伺服器與高速資料中心對頻寬、功耗與延遲的要求持續提高" against FinMind or market data.
- What the reviewer CAN detect: explicit fabrication patterns (specific named events with no URL,
  company names with specific numeric claims that look invented).
- What the reviewer CANNOT detect: thematic hallucination (broadly plausible-sounding claims
  derived from stale or absent source data that are written in general/vague language).
- The 5/3 brief "Theme Summaries" section passed with rule-template fallback content visible —
  the reviewer did not flag this as a quality issue even though the content is literally pipeline
  metadata, not analyst-generated text.

### Source-Label vs Advice Distinction (PR #255 fix)

The live prompt (lines 85-91) correctly adds the "Important Non-Reject Examples" block:
- "Do NOT reject factual source or dataset labels such as 'institutional buy/sell', '買賣超', '三大法人'"
- "Do NOT reject factual historical descriptions like '外資買超 2,000 張'"

The classifyDraftTier() in openalice-pipeline.ts (lines 523-530) also correctly pre-processes
known dataset label strings (TaiwanStockInstitutionalInvestorsBuySell, tw_institutional_buysell)
before applying red-tier pattern matching.

This dual defense (prompt + classifier) is the correct architecture for PR #255's intent.

### Green/Yellow/Red Tier Logic vs §3 Spec

| Tier | Spec | Implementation | Match |
|------|------|----------------|-------|
| Green | auto-publish | classifyDraftTier()=green + AI approve + confidence>=0.7 + 0 flags | YES |
| Yellow | queue for human | classifyDraftTier()=yellow (strategy/ranking keywords) | YES |
| Red | reject | classifyDraftTier()=red (buy/sell/target/guarantee/Sharpe/勝率) | YES |
| Red override | AI says approve but content is red | fireAiReviewerForDraft() lines 340-358 force-reject | YES |

All three gate tiers are wired correctly. The red-tier override (lines 340-358) is the key safety
net that prevents a prompt-jailbreak from getting red-tier content auto-published.

---

## 5. Overall BLOCK #5 §3 Assessment

### Summary Verdict: YELLOW — functional but with 3 follow-up items

The AI reviewer is operational and correctly enforcing the core buy/sell/target/guarantee rules.
Published briefs in the last 5 days contain no hard-reject violations. The reviewer-to-gate
pipeline (prompt → AI verdict → classifyDraftTier override → approve/reject/hold) is correctly
wired per §3 spec.

### Items Requiring Follow-up (priority ranked)

**1. BROKEN/DEPRECATED metadata tokens in published content body (suggestion, owner: Jason/OpenAlice pipeline)**
- 4 of 5 published briefs contain internal debug tokens ("[BROKEN-1]", "[DEPRECATED]", etc.) in
  the user-facing text.
- Root cause: the OpenAlice brief generator is faithfully reproducing these theme names from the
  input source pack, including themes that are flagged as broken or deprecated.
- The AI reviewer does not flag this because BROKEN/DEPRECATED are not in any reject pattern.
- Fix: filter BROKEN/DEPRECATED themes from the source pack before feeding to brief generator,
  OR add a post-generate cleanup step that strips these token patterns from section bodies.

**2. False positive reject rate (~10%+ of AI rejections) (suggestion, owner: Jason)**
- The GPT-4o-mini model is misinterpreting descriptive Chinese vocabulary ("修復", "受惠",
  "出貨量", "關注") as trading advice.
- Root cause: the old prompt (dead code lines 114-145) listed bare action words without context.
  The live prompt has the non-reject examples section, but the model still over-triggers.
- The classifyDraftTier() redPatterns at lines 560-569 include bare /買進/ and /賣出/ which would
  also catch "外資買進" (foreign investor buying — a source label) in policy text after the
  pre-processing replacements. The pre-processing covers "institutional buy/sell" in English but
  does NOT cover "外資買進" in Chinese as a source label exemption.
- Fix option A: extend classifyDraftTier() policyText replacements to normalize "外資買進/賣出",
  "法人買進/賣出" before running the red-tier patterns.
- Fix option B: add these to the prompt's non-reject examples list.

**3. Dead code block in buildReviewPrompt() (nit, owner: Jason)**
- Lines 114-145 in openalice-ai-reviewer.ts are unreachable (second return statement in a
  function that already returned at line 112).
- Not a runtime bug — the live prompt is correct. But the dead code confuses future readers.
- Fix: delete lines 114-145.

**4. Hallucination check is prompt-only, no ground-truth cross-check (architecture gap, no immediate fix required)**
- The AI reviewer cannot verify claims against source data because the source data is not in the
  draft payload.
- Current mitigation: sourceTrail is captured at the content_draft level and trailComplete flag
  is set. The publish gate uses trailComplete as a precondition (evaluatePublishGate checks
  sourcePack.sourceTrail).
- Observation: sourceTrail is not surfaced in the published /api/v1/briefs response, so external
  audit must go through audit_log or content_draft table directly. This is an audit visibility
  gap, not a safety gap.
- No code change required now. Flag for future audit tooling.

### What is GREEN Already
- No buy/sell advice in any published brief.
- No target price in any published brief.
- No guarantee/勝率/Sharpe in any published brief.
- AI reviewer is running (model=gpt-4o-mini, confirmed in audit log).
- Red-tier override gate is wired and would block a jailbreak attempt.
- Source-label exemption (PR #255) is live and in the active prompt path.
- Yellow-tier hold logic exists and is wired (0 yellow holds in sample — expected, as published
  briefs don't have strategy keyword content).

---

## 6. Elva Merge/Close Recommendation

BLOCK #5 §3 can be declared **functionally GREEN** for the W7 paper sprint scope.

The three follow-up items are improvements, not blockers. None represent a live safety failure.

Suggested owner assignments:
- Item 1 (BROKEN labels in published content) → Jason, suggest as next pipeline PR
- Item 2 (false positive reject rate) → Jason, fix classifyDraftTier policyText normalization
- Item 3 (dead code cleanup) → Jason, 1-line delete, can bundle with next openalice PR

---

Reviewer: Pete
Date: 2026-05-07
Sprint: W7 Paper Sprint
Evidence path: evidence/w7_paper_sprint/PETE_BLOCK5_AI_REVIEWER_CONTENT_AUDIT_2026-05-07.md
