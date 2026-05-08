# NEW THREAD HANDOFF — IUF Trading Room / Codex

Date: 2026-05-07
Workspace: `C:\Users\User\Desktop\小楊機密\交易\IUF_TRADING_ROOM_APP`
Language / UX: 繁體中文優先；台股語境；不要把核心介面改成英文。

## 0. Purpose

This file is for starting a new Codex conversation without losing project context.

The old conversation is very long and should become read-only history. The new thread should continue from this compressed state, not restart the project.

## 1. Product Definition

IUF Trading Room is a Taiwan-stock AI trading war room.

It is not a generic financial information website. It should become a personal trading operating system for an independent Taiwan-stock operator:

- 台股研究
- FinMind 官方資料
- OpenAlice / OpenAI 自動研究與每日簡報
- AI 訊號與 source trail
- 量化驗證與策略 bundle
- 紙上交易 preview / fills / portfolio / audit
- 風控 gate
- 未來接 KGI 即時報價與正式下單

The product goal is to turn scattered workflows from news, Excel, broker UI, backtests, and notes into a verifiable, risk-controlled, executable trading workflow.

## 2. User Preference / Important Behavioral Rules

- User wants autonomous execution. Do not stop to ask yes/no for safe scoped work.
- If blocked, write owner / blocker / bypass task and keep moving.
- User is very sensitive to:
  - ugly layout
  - text overlap
  - horizontal white scrollbars
  - useless empty pages
  - fake mock data
  - English replacing Traditional Chinese
  - deleted features/buttons instead of making them useful
- The site should feel like a polished product, not a debug dashboard.
- Traditional Chinese is required for operator-facing UI. Some technical source labels can remain English only when appropriate.
- Do not include, repeat, store, or upload user credentials or secret values.

## 3. Current Role

Codex role:

Frontend Product Owner — `apps/web` real-data + product workflow truth.

Codex owns:

- `apps/web/**`
- frontend evidence
- information architecture
- real-data rendering
- source-state semantics
- UX / workflow clarity
- company page / dashboard / market intel / daily brief / quant bundle inbox frontend

Codex can request backend endpoints from Jason / Elva, but must not take over backend governance.

## 4. Hard Stop-Lines

Never violate:

- No live submit.
- Do not touch `/order/create`.
- Do not touch KGI SDK / broker write-side.
- Do not touch Railway secrets.
- Do not display or log token values.
- No migration 0020 promotion.
- No destructive DB/schema action.
- No fake/mock data presented as live.
- No fake strategy metrics: Sharpe, win rate, equity curve, strategy ranking, fake backtest.
- No buy/sell recommendation, target price, guarantee wording.
- FinMind / K-line / TradingView must not be used as fill price or risk source.
- 台股單位 safety:
  - 1 張 = 1000 股
  - 零股 = actual shares
  - 2330 must never default to 1 LOT
  - LOT qty=1 must clearly mean 1000 shares and notional must reflect that.

## 5. Current Data / Platform Status

FinMind:

- User has paid Sponsor 999.
- Expected API quota: 6000 calls/hour.
- Token is in Railway env. Do not show token.
- FinMind is data fuel, not governance pass.
- FinMind can support:
  - OHLCV / K-bar
  - minute K
  - monthly revenue
  - financial statements
  - balance sheet
  - cashflow
  - institutional flow
  - margin / short
  - dividend
  - PER/PBR / market value / equity-related datasets
  - Taiwan news / announcements where backend exposes them

OpenAlice / OpenAI:

- OpenAlice should become the autonomous research / daily brief workflow.
- User wants daily content, key market info, news, and AI-reviewed source-traced summaries to update automatically, not by manual approval forever.
- OpenAI API can be used for AI review / summarization, but output must remain source-traced and governance-safe.

KGI:

- Live submit still blocked by KGI `libCGCrypt.so`.
- KGI write-side must remain untouched.
- Read-only quote / account / position integration can be planned only when backend is ready and does not imply live submit.

Paper:

- Paper E2E UI is a main workflow.
- Paper UI should show preview, notional, odd-lot / board-lot, risk reasons, capital, stale quote, fills/readiness/portfolio when backend exists.
- No real broker submit.

Quant:

- Quant Lab must not show fake metrics.
- Show only true bundle state, source status, gate status until Athena + Bruce approve schema and harness.

## 6. Recently Completed / Deployed Work

Important recent successful work:

### PR #253

OpenAlice `/briefs` truth surface deployed.

### PR #254

Daily brief publish status repair.

Key behavior:

- OpenAlice-approved daily briefs and worker fallback formal briefs now surface as `published`.
- Legacy approved/draft rows normalized at repository boundary.

### PR #255

OpenAlice action-word false reject repair.

Key behavior:

- Factual source labels like institutional buy/sell are no longer rejected as trading advice.
- Actual buy/sell instructions, target prices, guarantees, Sharpe, win-rate claims remain blocked.

### PR #258

OpenAlice producer theme quality filter.

Key behavior:

- Worker-generated content no longer selects cleanup themes:
  - `[BROKEN-*]`
  - `[DEPRECATED]`
  - `[ORPHAN]`
  - `placeholder`
  - `To Fix`
  - priority `<= 0`
- Applies to theme summaries, review summaries, daily theme summaries, daily briefs, company-note linked themes, signal clusters.

### PR #262

Homepage OpenAlice workflow truth.

Commit: `c72c874`

Key behavior:

- Homepage now surfaces latest published OpenAlice daily brief content.
- Distinguishes:
  - today's formal brief
  - stale latest brief
  - awaiting-review draft
  - missing brief
- Shows first two published brief sections on homepage with Traditional Chinese cleanup and unsafe-advice masking.
- Keeps homepage truthful: if source trail is not closed, it says so instead of filling fake content.
- Railway deploy succeeded for web/api/worker.

Checks for #262:

- Web typecheck PASS
- Web build PASS
- CI PASS
- Railway deploy PASS
- No token, no `/order/create`, no KGI write-side, no fake strategy metrics.

## 7. Known Current Pain Points

The user still sees the website as unfinished. Main issues:

1. Homepage / 戰情台
   - Still not valuable enough as a trading command center.
   - Needs more actionable workflow state, not stale counters.
   - Must avoid old info and meaningless empty panels.

2. OpenAlice / 每日簡報
   - Backend pipeline exists and recent fixes improved publishing.
   - Still needs a complete visible loop:
     - generate
     - AI review
     - source trail
     - publish
     - homepage / briefs display
     - failure reason / next action

3. Major info / news
   - FinMind news backend work exists but frontend may not be fully useful.
   - Need source-traced Taiwan-stock important info, not empty placeholders.

4. Company page / K-line
   - K-line work improved daily/minute/sparse semantics previously.
   - Need continue verifying production behavior.
   - Company page must not be a pile of boxes; workflow should be clear:
     - quote/K-line
     - company fundamentals
     - FinMind datasets
     - paper preview
     - source state

5. Paper E2E
   - Continue company page preview → portfolio readiness → fills readout → audit visibility.
   - No submit / no broker write-side.

6. Quant Lab
   - Most dangerous surface.
   - Must not imply valid strategy performance.
   - Should show bundle inbox / validation state only.

7. Layout / visual quality
   - User dislikes rigid one-card-per-page templates.
   - External design vendor may redesign homepage visual direction.
   - Codex should preserve functional controls/endpoints so backend work is not wasted.
   - Do not remove buttons; make them meaningful, disabled with reason, or hidden if not ready.

## 8. Immediate Next Priorities

Use Trade Capability visible progress as KPI.

Priority 1 — Homepage command center truth

- Make homepage answer:
  - What data is fresh today?
  - What did OpenAlice publish?
  - What workflow can the operator run now?
  - What is blocked and who owns it?
- Avoid pure cosmetic PRs.

Priority 2 — OpenAlice daily brief closed loop

- Improve `/briefs` + homepage workflow display.
- Show source trail, reviewer verdict, publish status, failure reason.
- If stale/missing, show next backend/worker reason.

Priority 3 — Paper E2E UI

- Company page preview panel:
  - PAPER badge
  - symbol
  - side
  - quantity
  - SHARE / LOT
  - estimated notional
  - 20,000 TWD capital
  - risk result
  - block reasons
  - quote status
- Portfolio:
  - readiness rail
  - fills readout
  - audit visibility if endpoint exists

Priority 4 — FinMind / Market Intel

- Use Sponsor 999 responsibly.
- Show dataset health, row counts, updatedAt, missing data reason.
- Do not show fake live.
- News/major info must have source and time.

Priority 5 — Quant bundle inbox

- Show true state only:
  - bundle received
  - source status
  - schema status
  - validation state
- No fake metrics.

## 9. Current Coordination Pattern

Elva / Jason / Bruce / Pete / Mike may be active.

Read latest channel files if needed:

`C:\Users\User\.claude\projects\C--Users-User\memory\board\codex_channel\codex_to_elva_*.md`

Shared status board:

`evidence/w7_paper_sprint/frontend_realdata_status_board_2026-05-01.md`

Do not let long status reading replace actual work. Read enough to avoid collisions, then proceed.

## 10. Recommended New Thread First Task

Start by checking:

1. `git status --short`
2. `git log origin/main -5 --oneline`
3. open PR list
4. latest Railway / CI state if needed
5. homepage production behavior after PR #262

Then continue with one of:

- Homepage command-center workflow value pass
- OpenAlice daily brief closed-loop display
- Paper E2E company → portfolio flow
- Market Intel / FinMind news truth surface

Do not start with broad visual redesign unless explicitly working from external designer output.

## 11. New Thread Prompt

Paste this into the new Codex conversation:

```text
請接手 IUF Trading Room 專案。請先讀：

C:\Users\User\Desktop\小楊機密\交易\IUF_TRADING_ROOM_APP\evidence\w7_paper_sprint\NEW_THREAD_HANDOFF_CODEX_2026-05-07.md

工作目標：
我們做的是「台股 AI 交易戰情室」，不是一般財經資訊站。核心是把台股研究、FinMind 官方資料、OpenAlice / OpenAI 自動每日簡報、AI 訊號、量化驗證、紙上交易、風控與未來 KGI 下單整合成一套可驗證、可風控、可執行的投資作業系統。

請你：
1. 先確認 git status、origin/main、open PR、最新 CI/Railway 狀態。
2. 不要問我 yes/no，安全 scoped work 直接做。
3. 遵守 stop-line：不碰 token、不碰 Railway secrets、不碰 /order/create、不碰 KGI write-side、不碰 migration 0020、不做 fake live、不做假策略績效、不做買賣建議。
4. UI 必須繁體中文優先，台股語境，不能再把核心介面改英文。
5. KPI 是 Trade Capability visible progress，不是 PR 數量或純美化。
6. 優先推進：首頁戰情台真工作流、OpenAlice 每日簡報閉環、Paper E2E UI、FinMind/重大訊息 truth surface、Quant bundle 真狀態。

請從 handoff 的「Immediate Next Priorities」開始，先做最能讓網站從半成品變成真正交易戰情室的一步。
```

