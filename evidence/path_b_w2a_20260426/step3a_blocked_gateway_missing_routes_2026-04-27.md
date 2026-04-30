---
name: Step 3a BLOCKED — Gateway missing quote read-side routes
description: 09:36 TST 開盤後跑 Step 3a 的失敗根因 — gateway 只有 subscribe，沒有 stream/poll
type: project
date: 2026-04-27 09:38 TST
status: BLOCKED_PRE_REQ_MISSING (not a fail)
---

# Step 3a BLOCKED — Gateway missing quote read-side routes

## 1. Symptom
- 09:37:30 TST 跑 `path_b_w2a_step3a_2330_90s.py`
- WS connect fail HTTP 403 → script line 178-180 fallback bug：`if capture is None` 但 WS error 回 dict 不 None → REST fallback 沒走
- 修 fallback 也沒用：REST endpoint 也不存在

## 2. Root cause
Gateway `/openapi.json` 顯示只有 10 routes：

```
/deals
/health
/order/create
/position
/quote/subscribe/tick
/session/{login, logout, set-account, show-account}
/trades
```

缺：
- `/quote/stream` (WS) — Step 3a 主路徑
- `/quote/ticks?symbol=...&limit=...` (REST poll) — Step 3a fallback
- `/quote/subscribe/bidask` — script line 80, 176
- `/quote/bidask?symbol=...` — bidask read

Gateway 目前 quote 是「subscribe 後 KGI SDK callback 內部處理」，**沒對外 expose 給 Elva 跨機讀**。

## 3. Cross-check pre-existing evidence
- Path B W1.5 closeout（2026-04-25）有列 read-side endpoints：position/trades/deals/logout — quote 是 W2 tunnel 才會 expose
- W2 tunnel proposal §4 設計含 quote stream/poll route，但 **proposal status = 待 楊董 拍板才動 W2b**，未實作
- → 缺 routes 不是 regression，是 W2b scope，今天不在 W2a 範圍內

## 4. What DID PASS（trimmed preflight 5/5）
| # | Endpoint | Result |
|---|---|---|
| 0 | `/health` | 200, kgi_logged_in=true, account_set=false→true |
| 1 | `/session/show-account` | 200, 1 account (broker <REDACTED:KGI_BROKER_ID> / acct <REDACTED:KGI_ACCOUNT>) |
| 2 | `/session/set-account` | 200 ok=true |
| 3 | `/quote/subscribe/tick {2330}` | 200 ok=true label=tick_2330 |
| 5 | `/trades?full=true` | 200 trades={"無效單":[]} |
| 6 | `/deals` | 200 deals={} |
| 7 | `/health` re-check | 200 + logged_in + account_set |

→ 所有 W1.5 read-side endpoints **gateway alive 全綠**。
→ /position **跳過**（per 楊董 binding，Candidate F containment 來才開）。

## 5. Step 3a result（archived）
`evidence/path_b_w2a_20260426/quote_step3a_2330_90s.json` 記錄 transport=ws / WS 403 / pass=false / 0 ticks 0 bidasks。

## 6. Decision
- **Step 3a quote read-side verify：DEFERRED to W2b**（gateway 加 quote stream/poll routes 後）
- 今天可繼續做的：等 Jason F PR + W1.5 read-side full pass 已成立
- Gateway 仍 alive，未 crash，沒踩 /position

## 7. Hard line preserved
- 0 /position call（per binding）
- 0 /order/create call
- 0 /session/login or logout call
- 0 auto restart
- 0 deploy
- Gateway uvicorn alive throughout

## 8. Next action options（pre-Jason-F）
A) 收 Step 3a 為 W2b 範圍，今天不再嘗試
B) 若楊董要 quote 讀取 evidence，需新 work order 給 Jason 加 `/quote/ticks` GET endpoint（design-only，可在 F PR 之後再排）
C) Continue read-side observation — /trades /deals 每隔幾分鐘 poll 一次，看開盤後是否有 row 進來

預設 (A)。

—— Elva 09:38 TST
