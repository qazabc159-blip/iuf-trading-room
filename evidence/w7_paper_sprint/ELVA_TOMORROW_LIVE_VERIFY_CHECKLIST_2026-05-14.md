# 明早 09:00 TST Wave 4 Live Verify Checklist — 2026-05-14

**Owner**: Bruce (auto)
**When**: 2026-05-14 開盤後 09:00-13:30 TST 任何時段都可跑（建議 09:30-10:00 第一輪）
**Dispatch trigger**: Elva 派 / Bruce 自主跑 / 或楊董手動 ping

---

## Phase 1 — EC2 自動啟動驗證（09:00-09:15 TST）

| # | Check | Expected | How |
|---|---|---|---|
| 1.1 | EC2 instance state | `running` | `aws ec2 describe-instances --instance-ids i-03762861d4ce08932 --region ap-east-2` |
| 1.2 | EC2 8787 health | `{"status":"ok","kgi_logged_in":true,"account_set":true}` | `curl http://43.213.204.233:8787/health` |
| 1.3 | Auto Live Login Scheduled Task | log written to `C:\kgi-gateway-logs\startup_live_login.log` | SSM Run `Get-Content` |
| 1.4 | EventBridge cron evidence | `iuf-kgi-gateway-taipei-weekday-start-0820-tst` 有 fire | `aws events list-rule-names` |

---

## Phase 2 — KGI Tick 真實流入（盤中任時）

| # | Check | Expected | How |
|---|---|---|---|
| 2.1 | `/api/v1/market/overview/kgi` | `source=kgi_tick` 且 taiex 數字跟盤中 TWSE 一致（誤差 < 5 秒） | curl + Owner token |
| 2.2 | `/api/v1/market/heatmap/kgi-core` | `tiles=24+` 含真實 changePct | curl |
| 2.3 | `/api/v1/kgi/quote/subscription-status` | `slotsUsed=22-40`, `connection_a=20`, `connection_b=N` | curl |
| 2.4 | 單檔個股 tick 流動 | 2330 tick `last_tick_at` 在 60s 內更新 | curl `subscription-status` |
| 2.5 | K 線聚合 (1m/5m) | 從 tick 即時聚合，K 線 painted | 前端打開個股頁 |

---

## Phase 3 — /ideas 自然解（10:00-11:00 TST）

| # | Check | Expected | How |
|---|---|---|---|
| 3.1 | `/api/v1/ideas` usable count | 50 → **> 5**（理想 30-50） | curl |
| 3.2 | `missing_bars` count | 50 → **< 30** | curl |
| 3.3 | 任一 idea item 有 reasoning + signal source | 含 strategy name + entry/exit reasoning | inspect 1 item |

---

## Phase 4 — 429 QUOTA_EXCEEDED Live Trigger（盤中）

| # | Check | Expected | How |
|---|---|---|---|
| 4.1 | POST 第 41 檔 subscribe | HTTP `429 QUOTA_EXCEEDED` + suggest swap | curl |
| 4.2 | swap LRU watchlist 後第 41 檔可訂 | HTTP 200 + 舊 LRU 被 unsubscribed | curl |

---

## Phase 5 — OpenAlice 14:00 Strategy Brief（14:00-14:30 TST）

| # | Check | Expected | How |
|---|---|---|---|
| 5.1 | 14:00 cron 自動 fire | `/api/v1/openalice/strategy-brief/latest` 有 today brief | curl + Owner |
| 5.2 | Brief content 真實 AI generated | 不再 `BLOCKED_DATA_QUALITY` | inspect response |
| 5.3 | Content sections | today_market_summary + cont_liq_observation + strategy_signals + risk_alerts + commentary | inspect |
| 5.4 | Hard line: 0 promote wording | 0 「進場/賣出/做多/做空/目標價/勝率/approved/alpha confirmed」 | grep response |
| 5.5 | OpenAI model used | `gpt-4o-mini`（NOT gpt-5.4-mini） | response metadata |

---

## Phase 6 — 14:10 自動關機 + EOD Fallback（14:10-14:30 TST）

| # | Check | Expected | How |
|---|---|---|---|
| 6.1 | EC2 14:10 自動 stopped | `aws ec2 describe-instances state=stopped` | aws CLI |
| 6.2 | `/api/v1/market/overview/kgi` post-shutdown | 自動 fallback `source=twse_openapi_eod` | curl |
| 6.3 | `/api/v1/market/heatmap/kgi-core` post-shutdown | `tiles=0` + 標 twseFallback | curl |
| 6.4 | 用戶看不到「Loading...」永久卡 | 主頁正常顯示 EOD 數字 | 前端目視 |

---

## Phase 7 — Paper Cash Capital 三層統一（Jason PR + Codex wire 完後）

| # | Check | Expected | How |
|---|---|---|---|
| 7.1 | Bootstrap `paper-broker.ts` | `process.env.PAPER_BROKER_INITIAL_CASH ?? 10_000_000` = `10000000` | code grep |
| 7.2 | `/portfolio/preview` | `cash=10000000` | curl |
| 7.3 | `/trading/balance?accountId=paper-default` | `cash=10000000` | curl |
| 7.4 | Frontend iframe 顯示 | `模擬資金 NT$ 10,000,000` (千分位) | 前端目視 |

---

## Hard line (永遠守)

| Hard line | Check |
|---|---|
| Prod broker write 24h = 0 | `audit_logs WHERE action LIKE 'broker.%'` |
| No fake bars / scraping | `source` 欄位明確標 `kgi_tick / twse_openapi_eod / finmind` |
| No promote wording | grep response |
| 40 subscription cap | server.ts:3764 + 4.1 test |
| LIVE order /order/create still 409 | curl gateway |
| `paper.* / broker.*` namespace distinct | audit_logs |

---

## Bruce Final Verdict Enum

- **WAVE4_LIVE_FULL_PASS** — 7 phases 全綠
- **WAVE4_LIVE_PASS_WITH_CAVEATS** — 主要 PASS 列細項
- **WAVE4_LIVE_BLOCKED_<phase>** — 某 phase 卡住
- **WAVE4_LIVE_HARD_LINE_FAIL** — 守線破

---

## Output

`evidence/w7_paper_sprint/BRUCE_WAVE4_TOMORROW_LIVE_VERIFY_2026-05-14.md`

明早 Bruce 自主跑 + 用此 checklist 對著 verify。
