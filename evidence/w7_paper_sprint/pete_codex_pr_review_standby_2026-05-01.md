# Pete Standby Brief — Codex Mid/Large Frontend PR Desk Review

Issued: 2026-05-01 01:42 Taipei
Owner: Pete
Audience: Codex (PR producer), Elva (lane lead)
Coordination doc: `evidence/w7_paper_sprint/frontend_realdata_status_board_2026-05-01.md`

## Context

Codex 從今晚起接管 frontend real-data conversion。落 code 流程是 hybrid：

- 小型 non-destructive frontend fix → direct commit main（不需 Pete review）
- **中大型 frontend 改動 → branch + PR + Pete desk review + CI PASS + squash merge**

中大型定義：
- 跨多頁 binding（≥3 page files）
- Market Intel/news 新 panel
- 改 shared API wrapper（`apps/web/lib/api.ts`、`radar-api.ts` 等）
- 改 routing / middleware / `app/layout.tsx`

## 你的工作

Standby — Codex 開第一個中大型 PR 時 Elva 會 ping 你（在 board `Blockers` 區寫 `Pete review needed: PR #<n>`）。

你不主動推 — 等 PR 來。

## Review Checklist（每個 Codex 中大型 PR）

### Hard Rule 4-State 驗證

每個 visible panel diff 必須能歸類為 LIVE / EMPTY / BLOCKED / HIDDEN。

- LIVE：必須有 `source` + `updatedAt` field（visible 或 data attr）
- EMPTY：必須有 0-row reason
- BLOCKED：必須有 `blocker` + `owner`
- HIDDEN：整個 panel 不 render

不符合 → REQUEST_CHANGES

### Stop-line 驗證

PR diff **絕對不能**碰：
- `apps/api/src/broker/**` write-side
- `apps/api/src/risk/**` semantics
- `packages/db/migrations/0020*` 或之後 destructive migration
- Railway secrets / env files committed
- `/order/create` live submit gate
- KGI SDK / `libCGCrypt.so` / Market Agent HMAC secret

碰到 → REQUEST_CHANGES + ping Elva

### Conditional Backend 動作驗證

Codex 條件性可動：
- `apps/api/src/server.ts`（小改）
- `apps/api/src/data-sources/**`（announcements 相關）

判斷標準：
- 改動是否真的「小」？（<50 行純加法 OK；refactor/rename → REQUEST_CHANGES）
- 是否跟 Market Intel / company announcements 直接相關？
- 有沒有順便動 risk / broker / migration？（有 → REQUEST_CHANGES）

### Mock Regression 驗證

- grep `mock` / `fake` / `placeholder` / `lorem` 在 PR diff
- 任何 production path 看得到 mock → REQUEST_CHANGES
- dev-only 落地 OK，但要明確 `if (process.env.NODE_ENV !== 'production')` gate

### Source Attribution 驗證

新加的 LIVE panel：
- 是否照 Jason 的 backend contract（在 `evidence/w7_paper_sprint/jason_backend_contracts_2026-05-01.md`）綁？
- 沒 contract 的 surface 不准標 LIVE，必須 BLOCKED 或 HIDDEN

### 一般軟性檢查

- TypeScript pass
- 沒新加 console.log secret
- commit message 清楚（"feat(web)" / "fix(web)" / "chore(web)" 開頭）
- diff 沒夾無關檔（unrelated `apps/api/`、`packages/db/`、`services/**`）

## Verdict 格式

每個 PR 在 PR comment 留：

```
## Pete desk review — <PR#>

Verdict: APPROVE / REQUEST_CHANGES / BLOCKED

4-State coverage:
- LIVE: <count, fields OK>
- EMPTY: <count, reason OK>
- BLOCKED: <count, blocker+owner OK>
- HIDDEN: <count>

Stop-line scan: PASS / FAIL <reason>
Mock scan: PASS / FAIL <files>
Backend contract reference: <link or N/A>

Notes: <free text>
```

## 派工人 ACK

Pete，standby 中。Codex 第一個中大型 PR 開出來時 Elva 會在 board ping 你。

—— Elva
