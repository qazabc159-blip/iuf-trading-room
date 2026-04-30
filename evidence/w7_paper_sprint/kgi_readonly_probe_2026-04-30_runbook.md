---
name: KGI Gateway Operator-Gated Read-Only Probe Runbook
description: 2026-04-30 W7 read-only probe sequence; 8 endpoints; no /position write, no /order/create, no subscribe POST. Operator runs on Windows host.
type: runbook
date: 2026-04-30
trigger: 楊董 W7 D-Bundle ACK §11 + KGI gateway live confirmation 「請繼續 operator-gated read-only checks」
gatewayState:
  kgi_logged_in: true
  KGI_GATEWAY_POSITION_DISABLED: true
  KGI_GATEWAY_QUOTE_DISABLED: false
  passwordRotated: 2026-04-30
  passwordEnvVar: KGI_PERSON_PWD (Windows-local only, NOT in chat / repo / evidence)
---

# KGI Gateway Read-Only Probe Runbook — W7 D-Bundle Day 2

## 為何要做

楊董 verbatim：「請繼續 operator-gated read-only checks」

D-Bundle merge 後：
- 凱基新密碼已 rotate，operator (楊董本人) 已手動 login
- gateway live state：kgi_logged_in=true / position disabled / quote enabled
- Elva 必須驗證最新 main + 最新 SDK 在新密碼 session 下，read-only 路徑全綠
- 任何 500 / native crash / connection drop 立即 STOP，不准重試

## 範圍 (8 個 endpoint)

| # | Endpoint | Method | 為何安全 |
|---|---|---|---|
| 1 | `/health` | GET | 無 auth, 純 metric |
| 2 | `/session/show-account` | GET | 讀已 cache 的 account list (login 後 SDK 已 populate) |
| 3 | `/quote/status` | GET | ring buffer count, 無 auth |
| 4 | `/quote/kbar/status` | GET | k-bar buffer metric |
| 5 | `/quote/kbar/recover?symbol=2330` | GET | historical pull, 無 subscription mutation |
| 6 | `/trades` | GET | 歷史委託讀, account-set 後才有資料 |
| 7 | `/deals` | GET | 歷史成交讀, 同上 |
| 8 | `/position` | GET | **預期 503 POSITION_DISABLED** — circuit breaker 保命驗證 |

## 嚴禁範圍

| Endpoint | 為何不能碰 |
|---|---|
| `POST /session/login` | 會踢掉現有 operator session |
| `POST /session/logout` | 同上 |
| `POST /session/set-account` | 操作者已設過, 重設會 mutate broker state |
| `POST /quote/subscribe/*` | mutate SDK subscription buffer |
| `POST /order/create` | W7 hardline 永久 409, 但連碰都不要碰 |
| `/position` 期望 200 | **不允許**, 必須 503; 若 200 = circuit breaker 失效, 立即停 + 通知 |

## 執行步驟 (operator)

### Step 1 — 確認 gateway 仍 alive (操作者目視)

```powershell
curl http://127.0.0.1:8787/health
```

預期看到 `"kgi_logged_in":true,"account_set":true` (or note=...).

若 kgi_logged_in=false → 已被踢, STOP, 找 Elva。

### Step 2 — 跑 probe 腳本

```powershell
cd C:\Users\User\Desktop\小楊機密\交易\IUF_TRADING_ROOM_APP\evidence\w7_paper_sprint
powershell -ExecutionPolicy Bypass -File .\kgi_readonly_probe_2026-04-30.ps1
```

預期：8 個 probe 全部 PASS，產出 `kgi_readonly_probe_2026-04-30_runlog.txt`。

### Step 3 — 確認 verdict

打開 `kgi_readonly_probe_2026-04-30_runlog.txt`，每個 probe 都應該有 `verdict: PASS`。

| Verdict | 動作 |
|---|---|
| 全 8 PASS | 通知 Elva → 進 D5 OpenAlice plan / 繼續 sprint |
| 任一 FAIL / UNEXPECTED | 停, 把 runlog 整份貼給 Elva, 不重跑 |
| BLOCKED (gateway down) | 停, 立即通知 Elva, 不重啟 gateway (有可能是 native crash 留下的 session 殘骸) |
| `/position` 回 200 | **嚴重**, circuit breaker 失效, 立即 stop, Elva 必須先看 |

## 不要做的事

- 不要把 runlog 上傳 chat / Slack / repo (內含 account 資訊, 可能含實價)
- 不要重跑失敗的 probe — 失敗訊號本身是診斷
- 不要在 probe 期間動 KGI Windows GUI (彈窗會 race condition)
- 不要 POST 任何 endpoint, 即使 schema 看起來像「只是查詢」
- 不要碰 `/quote/subscribe/*` — subscribe = mutate

## 收板格式

probe 完成後通知 Elva 用這 4 行：

```
1. probe verdict: 8/8 PASS  | or  X/8 PASS, fail at #Y (label)
2. /position 503 確認: YES/NO
3. /trades + /deals 有資料: YES/NO/EMPTY
4. /quote/kbar/recover 2330 bars 數: <int>
```

## 為何這份不直接由 Elva 自動執行

- gateway 在 Windows 本機 127.0.0.1:8787, Elva (Linux/容器化推進環境) 打不到
- 即使 Elva 能打, 嚴禁 agent 在 operator 沒在鍵盤前面時碰 live KGI session
- runlog 內含 broker_id / account_flag / 歷史成交, 屬 operator 私有資訊不該過 agent context

— Elva, 2026-04-30 W7 Day 2 ~12:15 TST
