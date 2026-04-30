---
name: W7 Paper Sprint Evidence Index
description: W7 Week 7 Paper Sprint 階段累積證據檔索引 — 含 L0 hot-fix / L1 D1+D2 ingest+cache / L3 PR review / L4 OpenAlice 5 types design / L5 housekeeping+secret inventory / overnight progress log
type: index
date: 2026-04-30 ~11:10 TST D-Bundle dispatch (PR #28+#29+#30 open, reviews running)
window: 2026-04-29 evening → 2026-04-30 morning (25-cycle overnight + L6 RADAR live-wire + D-Bundle)
mainCommitChain: c53fd77 ← 7a473ec ← 6e33564 ← 35435dc ← d8a7b16 ← e0e3f1e ← 920b467
openPrs: "#28 (Jim D-UI deplumb) / #29 (Jason D3+D5+theme cron) / #30 (Elva data-loaders cookie auth)"
---

# W7 Paper Sprint — Evidence INDEX

W7 paper sprint cumulative evidence index. All files in `evidence/w7_paper_sprint/`.

## Sprint summary

10-day target: paper E2E by 2026-05-09. Day 1+2 of sprint.

- **Day 0 (2026-04-29 evening)** — L0 functional regression hot-fix (envelope unwrap + OrderTicket buttons + W7 D5 routes) → PR #23 merged `d8a7b16`.
- **Day 1 (2026-04-29 night)** — L1 D1 Market Agent skeleton + ingest backend + 0016 migration → PR #24 merged `35435dc`.
- **Day 2 (2026-04-30 overnight)** — L1 D2 RedisCacheBackend (lazy-connect, 500ms timeout, W7 #11 non-blocking on cache failure) → PR #26 merged `7a473ec`. Hotfix #25 deploy fix `6e33564` interleaved.
- **Day 2 (2026-04-30 ~10:05 takeover dispatch)** — L6 RADAR live-wire bundle (F1+F2+F3+F4) → PR #27 merged `c53fd77`. 7 mockOnly→live wire / BriefBundle compose / new `/api/v1/reviews/log` route / orphan delete. Bruce GREEN + Pete ALL_GREEN. Deploy `177c5edd` LIVE.

Live deploy GREEN on `c53fd77` end of L6 dispatch.

---

## 0. Cycle / progress logs

| File | Purpose |
|---|---|
| `overnight_progress_log_2026-04-29_to_30.md` | Cycle-by-cycle log (Cycle 0 → 26 takeover close). 25 cycles 全程；収/派/記 entries / Elva decisions / hard-line conformance per cycle. |
| `eod_summary_2026-04-30_morning.md` | First-cut EOD summary for 楊董 morning（C9 close 後出）— PRs #21-#26 landed + W7 progress + ★HIGH RISK SECURITY surface + L4 design Q1-Q9 + backlog. |
| **`overnight_closeout_FINAL_2026-04-30.md`** | **★ Final takeover closeout（C26，~09:30 TST 楊董接手前）** — 6-section 完整收板：PRs / 員工別匯報 / cycle 帳 / hard lines / 今日可完成事項 A-D 系列 / Elva 接手後動作。|
| **`INDEX.md`** | **This file** |

---

## 1. L0 — Functional regression hot-fix (envelope + OrderTicket)

| File | Purpose |
|---|---|
| `l0_jason_root_cause_fix.md` | Jason root cause analysis: `radar-api.ts get<T>()` was raw-casting `{ data: T }` envelope; OrderTicket buttons had no onClick. |
| `l0_bruce_functional_sweep_audit.md` | Bruce functional sweep showing scope of regression (companies/themes/ideas/runs/signals/positions/quotes/risk-limits all empty). |
| `l0_bruce_pr23_verify.md` | Bruce PR #23 verify (post-fix). |

PR #23 merged → main `d8a7b16`.

---

## 2. L1 D1 — Market Agent skeleton (ingest backend + 0016 migration)

| File | Purpose |
|---|---|
| `l1_d1_jason_market_agent_skeleton.md` | Jason design + impl notes for Market Agent skeleton (HMAC-protected ingest endpoint, agent state, `apps/api/src/market-ingest.ts` MemoryCacheBackend stub). |
| `pr24_bruce_desk_review.md` | Bruce PR #24 desk review (8/8 GREEN). 9 unit tests T1-T8 in `apps/api/src/market-ingest.test.ts`. |

PR #24 merged → main `35435dc`.

---

## 3. L1 D2 — RedisCacheBackend (production cache wiring)

| File | Purpose |
|---|---|
| `l1_d2_redis_cache_design.md` | Spec: lazy-connect singleton, reconnect strategy, per-key TTL, 500ms write-timeout via `Promise.race`, W7 hard line #11 (cache failure must NOT block ingest). |
| `l1_d2_impl_log.md` | Jason implementation log (2 files +226/-7). |
| `pr26_bruce_review.md` | Bruce PR #26 desk review — APPROVE conditional on CI green. F1 (`(e: Error)` strict mode) low; F4 (test location vs spec §6) flagged for Elva. |
| (inline) Elva F4 waiver | D1 PR #24 precedent: tests already co-located in `market-ingest.test.ts`. Functional impact zero. Documented in `.tmp_pr26_elva_waiver.md` (transient). |
| `post_merge_regression_2026-04-30_cycle8.md` | Bruce post-merge regression on `35435dc` (Cycle 8) — flagged `deploy (web)` failing → triggered hotfix PR #25. |
| `post_merge_regression_2026-04-30_cycle8_6.md` | Bruce post-merge regression on `7a473ec` (Cycle 8.6) — 8/8 PASS, CONDITIONAL_GREEN→GREEN after CI run `25123955534` SUCCESS. |

PR #26 merged → main `7a473ec`. Hotfix PR #25 (`6e33564`) interleaved at Cycle 8.5.

---

## 4. L3 — PR review (post-RADAR cutover follow-ups)

| File | Purpose |
|---|---|
| `l3_pr22_pete_desk_review.md` | Pete pr-reviewer desk review on PR #22 (api-gap close, 5-item force-MOCK fixes). Merged → `e0e3f1e`. |

---

## 5. L4 — OpenAlice 5 task types design (D5/D6/D7 roadmap)

| File | Purpose |
|---|---|
| `l4_openalice_5_task_types_design.md` | Jason ~350-line design: 5 new types `theme-signal` / `risk-brief` / `news-synthesis` / `weekly-review` / `pre-market-brief`. Single migration `0017_openalice_extended_content.sql` (idempotent). Cost ~$0.005/day for 5 types, ~$0.008/day across all 8 types at gpt-5.4-mini. Hard-line matrix 50/50 PASS. D5/D6/D7 sequencing. 9 open questions for 楊董. |
| `l4_elva_desk_review_2026-04-30.md` | Elva desk review verdict: APPROVE — design only, ready for 楊董 to answer Q1-Q9 then dispatch D5. 8 sections covering scope/hard-line/schema/cost/sequencing/Q-actionability/concerns/verdict. |

**D5 dispatch gated** on 楊董 Q3 (news_items existence) + Q8 (KGI live position scope) + Q9 (PR slicing) minimum. Q1/Q2/Q4-Q7 have Elva-recommend defaults.

---

## 5b. L6 — RADAR live-wire bundle (F1+F2+F3+F4) → PR #27 → main `c53fd77`

| File | Purpose |
|---|---|
| `l6_radar_live_wire_jason.md` | Jason design + impl notes: F1 7 mockOnly→real fetch (killMode kept) / F2 BriefBundle compose + ActivityEvent.summary fix + ReviewBundle/WeeklyPlan typed arrays / F3 NEW `GET /api/v1/reviews/log` + radar-uncovered re-point / F4 orphan content-drafts-queue.tsx delete (0 importers). 8 unit tests T1-T8. |
| `pr27_bruce_desk_review.md` | Bruce verifier-release desk review verdict: **GREEN**. 6/6 hard lines PASS. 8/8 review items PASS. 3 non-blocking deferred (previewOrder shape mismatch / .claude/worktrees stale / futuresNight stub). |
| `pr27_pete_desk_review.md` | Pete pr-reviewer 7-axis desk review verdict: **ALL_GREEN**. 0 blocker / 2 LOW suggestion / 4 nit / 6 praise. mergeable CLEAN, CI 2/2 SUCCESS. |

**Live verify post-deploy**: deploymentId `177c5edd` (uptime 41s). 4 endpoints route-shape probe: `/api/v1/reviews/log` + `/api/v1/plans/brief` + `/api/v1/ops/activity` + `/api/v1/strategy/runs/:id/ideas` 全 401 (auth-gated, not 404 = 路由全註冊).

---

## 5c. L7 D-Bundle — UI deplumb + D3 OHLCV + D5 chart prep + theme cron + data-loaders

**Driver**: 楊董 verbatim 2026-04-30 ~10:30 TST 「如果這個GITHUB不夠成熟我們自己研發也可以啊 我要做的是成熟的機構等級產品網站怎麼可以卡在這??? 哪有交易網站只有幾十家公司能看? 全部我都ACK 不用再問我 直接全部開幹 另外其他員工沒事做的繼續推進主線 全部動起來」

| File | Purpose |
|---|---|
| `bruce_d_postload_regression.md` | Bruce static analysis — RED FLAG: schema mismatch in `apps/web/lib/radar-types.ts:28` (`symbol/score/momentum/intradayChgPct/fiiNetBn5d`) vs backend `ticker/chainPosition/beneficiaryTier` → `/companies` page broken. Direct cause of "看起來只有幾十家". |
| `jim_d_ui_deplumbing.md` | Jim D-Day work log: companies page rewrite to `getCompanies()` from `lib/api.ts` (correct contracts shape) + PortfolioClient decoratives sweep (VIX·TW / SIZ-BRK / inline kill-switch / +1.4bps / OF 12). PR #28. |
| `jason_d3_d5_themecron.md` | Jason D-Day work log: 0017 OHLCV schema + mulberry32 mock + Redis cache 5-min TTL + 8 unit tests / 0018 daily_theme_summaries + OpenAI gpt-5.4-mini producer + 4h worker interval. PR #29. |

**Live data verification** (graph sync ran successful before D-Bundle, confirmed via `scripts/debug-relations-fullscan.ts`):
- Companies: 1734 / 1736 from MTC repo (2 dropped for empty ticker/name)
- Relations: 19103 (1727 of 3470 companies have relations)
- Keywords: 5926 (1586 of 3470 companies have keywords)

**Open PRs (all draft, reviews in flight)**:
- **PR #28** `jim/w7-d-ui-deplumbing-2026-04-30` `ab8cfe8` — fixes Bruce's RED FLAG schema mismatch. Bruce + Pete reviewing.
- **PR #29** `jason/w7-d3-d5-d-themecron-2026-04-30` 6 commits ending `f932884` — D3+D5+theme cron, 8 unit tests, mock-driven KGI-independent.
- **PR #30** `elva/w7-data-loaders-cookie-auth-2026-04-30` `12910bf` — cookie-auth login flow for 3 production data-loader scripts (already shipped 19103 rels + 5926 kw live).

**Hard lines (D-Bundle)**: ✓ no `/order/create` change ✓ no KGI SDK import ✓ migrations 0017+0018 idempotent (`IF NOT EXISTS`) ✓ Redis cache fail-open (W7 #11) ✓ kill-switch ARMED untouched ✓ OPENAI_MODEL pinned `gpt-5.4-mini`.

---

## 6. L5 — Housekeeping + Secret inventory (HIGH RISK surface)

| File | Purpose |
|---|---|
| `l5_housekeeping_audit_2026-04-30.md` | Bruce L5 first-pass housekeeping audit. Cat-D 13-file list of files containing live KGI identifiers. |
| `l5_secret_inventory_reconciliation_2026-04-30.md` | Bruce L5 reconciliation against `secret_inventory.md`. **★★ CRITICAL findings**: (a) `secret_inventory.md` fully stale (0/21 tracked); (b) 7 additional untracked files beyond Cat-D (4 source-tree + 2 TS adapter + 1 evidence); (c) plaintext password `<REDACTED:KGI_PASSWORD_OLD_ROTATED>` in `evidence_content_sprint_2026-04-23/bruce_b1_w1_runtime_verify.md` line 235 NSSM startup command; (d) no `.gitignore` rules for affected paths. **Risk score: HIGH**. [A2 COMPLETE 2026-04-30] |

**Action items** (楊董 ACK received 2026-04-30 — A1 ROTATED, A2 REDACTED):
1. ★ ROTATE KGI password — DONE (A1)
2. Authorize redaction PR for 20 SECURITY-flagged files — DONE (A2)
3. Update `secret_inventory.md` to current state
4. Add `.gitignore` rules / move to `evidence-private/`
5. Source-tree IDs policy decision (illustrative or synthetic)

---

## Hard-line state (W7 Paper Sprint, post-Cycle 9)

- ✓ `/order/create` 409 untouched (no real-money path)
- ✓ Kill-switch ARMED untouched
- ✓ No KGI SDK import in apps/api
- ✓ `MARKET_AGENT_HMAC_SECRET` env-only
- ✓ L1 D2 cache write failure does NOT block ingest (W7 #11)
- ✓ 4 deferred operator-gateway live HTTP probes still POST_MERGE_DEFERRED
- ✓ No auto credential rotation (HIGH RISK SECURITY surface still pending 楊董 ack)
- ✓ Mission Command Yellow Zone honored: design-only L4 artifact, advisory desk review, no executor dispatch under explicit gate

## Sprint forward path (D5+ blocked)

D5 work (migration 0017 + risk-brief + pre-market-brief) requires 楊董 picks for Q3/Q8/Q9 + SECURITY ack before dispatch. `BLOCKED_NO_NEW_DISPATCH_REASON: l4_d5_gated_on_yang_dong_q1_q9_decisions_and_security_rotation_ack`.

— Elva, 2026-04-30 ~01:40 TST overnight Cycle 9 close

---

## 7. L7 D-Bundle MERGED → main (~11:30 TST, post Mission Command GREEN dispatch)

**Merge sequence** (all squash, all 楊董 verbatim ACK GREEN Zone):
1. PR #29 `1e1243f` — Jason D3 OHLCV + D5 chart prep + daily theme cron
2. PR #28 `d6e907b` — Jim UI deplumb + 3470 companies fix
3. PR #30 `8b32e11` — Elva data-loaders cookie auth

**Railway GHA deploy**: workflow_run GREEN on `8b32e11` (api 1m1s / worker 1m24s / web 1m47s). Migrations 0017+0018 auto-applied via `pnpm migrate && pnpm start:api`.

**Live verify (post-deploy `f567e110-7158-4728-8a75-12f7c0bdc452`)**:
| Check | Result |
|---|---|
| `/health` | 200 ok |
| `POST /auth/login` | 200, cookie set, user/workspace returned |
| `GET /api/v1/companies?limit=5` | 3470 entries returned |
| `GET /api/v1/companies/2330/ohlcv?limit=5` | ~190 daily bars 2025-07-24 → 2026-04-29, source=mock |
| `GET /api/v1/themes/daily/2026-04-30` | row id `86665de6...` generated `2026-04-30T03:27:07.497Z`, route=`fallback_template`, sourceEventCount=0 |

**Migrations 0017 + 0018 confirmed live**: tables `companies_ohlcv` + `daily_theme_summaries` populated and queryable.

**Two non-blocking observations** (filed for follow-up):
1. **OPENAI fallback**: theme cron used `worker_cron:fallback_template` (OPENAI_API_KEY likely missing on Railway worker env, or OpenAI call failed). Need to verify Railway worker env config.
2. **Top theme is placeholder**: `[BROKEN-2] To Fix [Balanced]` ranks #1 by priority due to seed placeholder rows. Known data quality issue (themes with `priority=5` and broken naming). Cron output cosmetically poor until placeholders pruned or de-prioritized.

**Earlier login 500 on cold deploy**: transient — first probe hit 500 mid-deploy boot, subsequent probes 200 OK. Not a regression.

**Hard lines (D-Bundle merge, all PASS)**: ✓ /order/create 409 untouched ✓ kill-switch ARMED untouched ✓ no KGI SDK import ✓ migrations 0017+0018 idempotent (`IF NOT EXISTS`) ✓ Redis cache fail-open (W7 #11) ✓ OPENAI_MODEL pinned `gpt-5.4-mini` ✓ no secret rotation auto-triggered.

— Elva, 2026-04-30 ~11:30 TST D-Bundle merge + live verify GREEN

---

## 8. Day 2 dispatch (~12:15 TST, post-ACK GREEN Zone Maximum Productive Push)

**Trigger**: 楊董 verbatim ACK directive 11:50 TST「不要等我。Go.」+ KGI gateway up confirmation「請繼續 operator-gated read-only checks」.

**3-lane parallel dispatch**:
| Lane | Owner | agentId | Status | Scope |
|---|---|---|---|---|
| A | Bruce | `a4c578da9cc97e7e2` | RUNNING | A2 redaction PR (20 files), `secret_inventory.md` reconcile, `.tmp_*` gitignore, `scripts/audit/secret_regression_check.py`, NSSM clear runbook |
| B | Jason | `a9c159ae6e514bd13` | **DONE** | TASK1 P0 `resolveCompany()` UUID-first + ticker fallback + onError stack log + `companies-ticker-resolution.test.ts` T1-T4 (auto-merge); TASK2 worker `routeReason` typing + `openai_fallback_rca_2026-04-30.md` (env check needed); TASK3 migration `0019_deprioritize_placeholder_themes.sql` + `.down.sql` idempotent UPDATE (auto-merge); TASK4 `previewOrderResultSchema` exported in `contracts/broker.ts` + ci.test (DRAFT — needs Jim sync); TASK5 `l4_d5_d7_3pr_breakdown_2026-04-30.md` D5/D6/D7 plan. Push script: `scripts/jason_task_push_2026_04_30.py` (4 branches). |
| C | Jim | `af3b2dd8c33bba92c` | DONE | `/companies/[symbol]/page.tsx` rewrite to contracts shape; `OhlcvCandlestickChart.tsx` lightweight-charts v5; `loading.tsx`, `error.tsx`; `lib/api.ts` helpers; DRAFT PR (NOT auto-merge per §8) |

**Lane D — Elva self deliverables (Day 2 ~12:15 TST)**:
- `kgi_readonly_probe_2026-04-30.ps1` — 8-endpoint operator-gated probe (skip /position, /order/create, POST subscribe; /position MUST 503)
- `kgi_readonly_probe_2026-04-30_runbook.md` — operator instructions + 4-line collapsed report format
- PR #20 closed (§C4 supersede note)
- `memory/plans/path_b_w2_tunnel_proposal.md` frontmatter SUPERSEDED_BY_W7_MARKET_AGENT_OUTBOUND_PUSH (§C2)
- MEMORY.md Path B W2 entry marked `[SUPERSEDED]`

**Backend regression mid-dispatch**: `/api/v1/companies/2330` returns 500 in production. Root cause at `apps/api/src/server.ts:1626` — handler `getCompany(id)` UUID-only lookup; ticker `2330` triggers lookup miss; onError swallows root cause. Owner: Jason TASK1 P0 (in flight). Jim's Lane C work uses `getCompanyByTicker` list-scan workaround until Jason's PR lands.

**Awaiting**: Lane A+B return → consolidated 10-line closeout per §10 + git ops for Lane C DRAFT PR.

— Elva, 2026-04-30 ~12:15 TST Day 2 dispatch in flight
