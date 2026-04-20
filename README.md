# IUF Trading Room

> 獨立操盤者的**研究 → 策略 → 執行 → 檢討**端到端作業系統。主題驅動投資、4 層風控、paper/真倉可切換、人類始終在 loop 裡。

[![CI](https://github.com/qazabc159-blip/iuf-trading-room/actions/workflows/ci.yml/badge.svg)](https://github.com/qazabc159-blip/iuf-trading-room/actions/workflows/ci.yml)
[![Deploy to Railway](https://github.com/qazabc159-blip/iuf-trading-room/actions/workflows/deploy.yml/badge.svg)](https://github.com/qazabc159-blip/iuf-trading-room/actions/workflows/deploy.yml)

---

## 現況（2026-04-20）

| 區段 | 狀態 |
|---|---|
| Wave 0–4（Foundation / Research / Signal & Plan / Agent Bridge / War Room Redesign） | ✅ |
| Phase 0 Trading contracts | ✅ |
| Phase 1 Execution skeleton（plan → risk → gate → broker → fill → SSE） | ✅ closed |
| Phase 2 4-layer risk（account / strategy / symbol / session） | ✅ |
| Market Data lane（quote / policy / decision-summary / overview quality） | ✅ |
| Strategy backend（ideas v1.1 / runs v1.2+v1.3） | ✅ |
| Strategy frontend consume（`/ideas` / `/runs` / `/runs/[id]` / query round-trip） | ✅ |

**下一批候選**：`/ideas` Save Run flow、handoff 再收口、Risk layer 持久化、Session layer 風控、Strategy engine 自動成單。

**延後不主動開**：KGI broker adapter、K 線 chart。

**完整專案 briefing**：[`PROJECT_BRIEFING.md`](./PROJECT_BRIEFING.md)（給 LLM / 新手接手看的深度文件）

---

## 架構

```
apps/
  web/       Next.js 15 App Router — 操盤者 UI（CRT phosphor + HUD 戰情室風）
  api/       Hono REST — ~100+ routes，market-data / strategy / risk / trading
  worker/    背景 cron / queue
packages/
  contracts/   Zod schemas — API 雙向契約，單一真相來源
  db/          Drizzle ORM + PostgreSQL schema
  domain/      Repository 介面 + memory 實作
  integrations/  外部整合（TradingView webhook / OpenAlice bridge）
  auth/        workspace / role
  ui/          共享 UI 常數
```

**Tech stack**：TypeScript 5.9 · pnpm 10 · turbo · Next 15 · React 19 · Hono · Drizzle · PostgreSQL 16 · Redis 7 · Zod · Railway

---

## Quick Start

```bash
pnpm install
pnpm dev                # web + api + worker 同時跑
```

Local ports：web `http://localhost:3000` · api `http://localhost:3001`

### 綠 bar 指令

```bash
pnpm typecheck
pnpm build
pnpm test               # deterministic，~67 tests in tests/ci.test.ts
pnpm smoke              # boot API 打幾個 endpoint
```

### DB

```bash
pnpm migrate            # 啟動 postgres 後跑 drizzle migrations
pnpm db:generate
```

### Execution verify

```bash
pnpm verify:execution:local    # 本地 end-to-end
pnpm verify:execution:live     # 打 production
```

---

## Production

- **web**: https://web-production-7896c.up.railway.app
- **api**: https://api-production-8f08.up.railway.app

**部署管線**：`git push main` → GitHub Actions CI（typecheck + build + test + smoke）→ `workflow_run` 觸發 Railway deploy（web / api / worker matrix 並行）

Railway 內建 GitHub webhook 自 2026-04-14 起不可靠，現全走 GHA。詳見 [`RAILWAY_DEPLOYMENT.md`](./RAILWAY_DEPLOYMENT.md) + [`RAILWAY_RUNBOOK.md`](./RAILWAY_RUNBOOK.md)。

---

## 設計原則

1. **契約優先** — `packages/contracts` 用 Zod schema 同時產後端 validator 與前端 type，改一次生兩邊
2. **雙軸品質**（quality vs decision）— 資料面 `quality.grade` 與行情面 `marketData.decision` 刻意分離，UI 都要顯示
3. **風控是閘門，不是牌子** — 每張 order 經 `runRiskCheck` → `evaluateExecutionGate` → broker，4 層 override（account/strategy/symbol/session）
4. **人類在 loop 裡** — `autoTrade` 預設 `false`、`requiresHumanApproval` 預設 `true`
5. **資料品質誠實化** — seed 佔位值（如 `exposure = {1,1,1,1,1}`）UI 標「未評分」，不渲染成真實訊號
6. **視覺識別**：CRT phosphor 磷光綠 + 琥珀重音 + HUD 角括號 + ASCII 分節 + 磷光動態；避免 AI SaaS 模板的圓角柔和感

---

## License

Private — 單一操盤者專用內部系統，非開源專案。
