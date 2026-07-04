# PR-B2 — Login-Only 端點掃雷清單

**日期**：2026-07-04　**範圍**：`apps/api/src/server.ts` 全部「只驗 session、無 role 檢查」端點（掃描 origin/main + 本 PR 現狀）。
**依據**：`reports/permission_matrix/PERMISSION_MATRIX_v1.md` §2 D3 分組表 + §4 PR-B2 行。
**方法**：逐端點讀 handler 實際邏輯（不看端點名關鍵字），依 D3 七群歸類，不確定一律從嚴（升不降）。
**行號說明**：下列各表「行號」為掃描當下（補閘前）`origin/main` 的 `server.ts` 行號，作為端點定位參考；本 PR 插入 51 個 role 閘後實際行號已下移，以 `git grep` 對應端點路徑字串仍可精確定位。

## 統計總覽

- 掃描到的 login-only 候選端點：**196**（原始掃描 196，含 2 個 middleware 外的 `/` `/health`）
- **補閘：51** 處（本 PR 新增 `requireMinRole` 閘）
  - 升至 **Admin**：14 處
  - 升至 **Analyst**：14 處
  - 升至 **Trader**：23 處
- **維持登入即可（G-PUB / G-SELF-personal 等，不動）：121** 處
- **核實後已在 handler 內有 Owner-only 驗證（掃描誤判，不動）：6** 處（皆為 `/api/v1/admin/*` delegate 到獨立 handler 檔案）
- **不適用（另一套驗證機制 / middleware 外，不動）：18** 處（device-auth bearer、webhook token、`/auth/*` 登入本身、isPublicDiagRoute 允許清單）

## 設計預列必修項（任務指定）

- `POST /api/v1/strategy/ideas/:ideaId/promote-to-paper-submit` → **Trader**（真送紙上單，原本零檢查）
- `GET /api/v1/lab/bundles` + `POST /api/v1/lab/bundles/intake` → **Analyst**（研究 bundle 清單/送入）

以上兩項均在下方清單內，已於本 PR 補閘。

## 補閘清單（51 處，本 PR 新增 requireMinRole 閘）

格式：`server.ts` 行號｜端點｜歸群｜補到的最低角色｜理由

| 行號 | 端點 | 歸群 | 最低角色 | 理由 |
|---|---|---|---|---|
| 798 | `GET /api/v1/audit-logs/summary` | G-ADMIN-ish | Admin | 審計日誌摘要，含 role/actor/method/path，內部治理資料，不確定=從嚴，比照豁免清單精神設 Admin |
| 816 | `GET /api/v1/audit-logs/export` | G-ADMIN-ish | Admin | 審計日誌原始匯出(CSV/JSON)，同上更完整，設 Admin |
| 844 | `GET /api/v1/audit-logs` | G-ADMIN-ish | Admin | 審計日誌列表，同上，設 Admin |
| 865 | `GET /api/v1/event-history` | G-ADMIN-ish | Admin | event-history 底層同 audit log 欄位（entityType/action/status/severity/search），同等敏感度，設 Admin |
| 884 | `GET /api/v1/event-history/summary` | G-ADMIN-ish | Admin | 同上 |
| 902 | `GET /api/v1/event-history/export` | G-ADMIN-ish | Admin | 同上，原始匯出 |
| 928 | `GET /api/v1/ops/snapshot` | G-ADMIN-ish | Admin | auditHours/rankingLimit 等內部 ops 儀表板參數，非一般產品讀取，設 Admin |
| 941 | `GET /api/v1/ops/trends` | G-ADMIN-ish | Admin | 同上 |
| 1129 | `POST /api/v1/market-data/manual-quotes` | G-ADMIN-ish | Admin | 手動覆寫全站報價，影響所有使用者看到的行情與風控計算，資料完整性操作，設 Admin |
| 1142 | `POST /api/v1/market-data/paper-quotes` | G-ADMIN-ish | Admin | 覆寫模擬交易撮合用報價，可操縱 paper 撮合結果，設 Admin |
| 1305 | `POST /api/v1/risk/limits` | G-PORT | Trader | 風控上限寫入，G-PORT 寫=Trader |
| 1325 | `POST /api/v1/risk/kill-switch` | G-ADMIN-ish | Admin | 全域停損/停手開關，安全關鍵操作，影響全體帳戶，不確定=從嚴設 Admin（非單純 Trader 下單寫入） |
| 1335 | `POST /api/v1/risk/checks` | G-PORT | Trader | 下單流程內的風控檢查呼叫，G-PORT 寫=Trader |
| 1394 | `POST /api/v1/risk/strategy-limits` | G-PORT | Trader | 策略層風控上限寫入 |
| 1404 | `DELETE /api/v1/risk/strategy-limits` | G-PORT | Trader | 策略層風控上限刪除 |
| 1444 | `POST /api/v1/risk/symbol-limits` | G-PORT | Trader | 個股風控上限寫入 |
| 1454 | `DELETE /api/v1/risk/symbol-limits` | G-PORT | Trader | 個股風控上限刪除 |
| 1504 | `POST /api/v1/trading/orders` | G-PORT | Trader | 送出交易委託（paper broker），真實下單動作，G-PORT 寫=Trader，高優先缺口 |
| 1534 | `POST /api/v1/trading/orders/cancel` | G-PORT | Trader | 取消委託，寫入動作 |
| 1627 | `GET /api/v1/companies/duplicates` | G-RESEARCH | Analyst | 重複公司偵測報告，資料治理/研究工具，非一般產品讀取 |
| 1639 | `GET /api/v1/companies/merge-preview` | G-RESEARCH | Analyst | 合併預覽，資料治理工具 |
| 1659 | `POST /api/v1/companies/merge` | G-ADMIN-ish | Admin | 實際合併公司記錄，結構性/破壞性寫入知識圖譜，不確定=從嚴升至 Admin |
| 1922 | `POST /api/v1/themes` | G-RESEARCH | Analyst | 新增主題，知識圖譜內容維護寫入 |
| 2039 | `PATCH /api/v1/themes/:id` | G-RESEARCH | Analyst | 主題內容更新，知識圖譜維護寫入 |
| 2087 | `POST /api/v1/companies` | G-RESEARCH | Analyst | 新增公司，知識圖譜維護寫入 |
| 2114 | `PUT /api/v1/companies/:id/relations` | G-RESEARCH | Analyst | 覆寫公司關聯，知識圖譜維護寫入 |
| 2145 | `PUT /api/v1/companies/:id/keywords` | G-RESEARCH | Analyst | 覆寫公司關鍵字，知識圖譜維護寫入 |
| 2196 | `PATCH /api/v1/companies/:id` | G-RESEARCH | Analyst | 更新公司資料，知識圖譜維護寫入 |
| 2338 | `POST /api/v1/strategy/ideas/:ideaId/promote-to-paper-submit` | G-PORT | Trader | 設計預列必修：真送紙上單卻零檢查，G-PORT 寫=Trader |
| 2442 | `POST /api/v1/strategy/runs` | G-RESEARCH | Analyst | 建立策略運算批次(autopilot run)，觸發後端運算資源，非單純讀取，比照研究運算門檻設 Analyst |
| 2487 | `POST /api/v1/strategy/runs/:id/confirm-token` | G-PORT | Trader | 核發 autopilot 執行確認 token，屬下單執行鏈一環 |
| 2493 | `POST /api/v1/strategy/runs/:id/execute` | G-PORT | Trader | 執行 autopilot run，可批次送出真實委託，G-PORT 寫=Trader，高優先缺口 |
| 2833 | `POST /api/v1/signals` | G-RESEARCH | Analyst | 新增訊號，內容寫入 |
| 2855 | `PATCH /api/v1/signals/:id` | G-RESEARCH | Analyst | 更新訊號，內容寫入 |
| 2877 | `POST /api/v1/plans` | G-PORT | Trader | 建立交易計畫，D3 明列於 G-PORT 寫=Trader |
| 3257 | `PATCH /api/v1/plans/:id` | G-PORT | Trader | 更新交易計畫，寫入 |
| 3278 | `POST /api/v1/reviews` | G-PORT | Trader | 新增復盤條目，綁定交易計畫的個人交易日誌寫入 |
| 3597 | `POST /api/v1/briefs` | G-RESEARCH | Analyst | 建立每日簡報內容，內容產製寫入 |
| 4287 | `POST /api/v1/import/my-tw-coverage` | G-ADMIN-ish | Admin | 批次匯入公司資料到資料庫，大範圍資料操作，設 Admin |
| 5955 | `POST /api/v1/kgi/quote/subscribe` | G-PORT | Trader | 訂閱即時報價，消耗共用 40 檔訂閱額度(quota)，屬主動交易資源使用行為非純讀 |
| 6119 | `POST /api/v1/kgi/quote/subscribe/kbar` | G-PORT | Trader | 同 subscribe，消耗共用訂閱額度 |
| 6293 | `POST /api/v1/paper/orders` | G-PORT | Trader | 建立紙上單，真送單動作，高優先缺口 |
| 6587 | `POST /api/v1/paper/orders/:id/cancel` | G-PORT | Trader | 取消紙上單，寫入(已有 ownership check) |
| 6877 | `POST /api/v1/portfolio/kill-mode` | G-ADMIN-ish | Admin | UI 端 kill switch 切換，同 risk/kill-switch 安全關鍵性，設 Admin |
| 13251 | `POST /api/v1/paper/submit` | G-PORT | Trader | 真送紙上單，高優先缺口，同 paper/orders |
| 14486 | `POST /api/v1/lab/bundles/intake` | G-RESEARCH | Analyst | 設計預列必修：研究 bundle 送入，研究內容→Analyst |
| 14527 | `GET /api/v1/lab/bundles` | G-RESEARCH | Analyst | 設計預列必修：研究 bundle 清單，研究內容→Analyst |
| 21199 | `GET /api/v1/uta/accounts` | G-SELF | Trader | D3 G-SELF：自己的 gateway 配對/券商連線狀態，最低 Trader（歸屬檢查留 PR-D） |
| 21458 | `POST /api/v1/uta/orders` | G-PORT | Trader | 統一下單流真實送單，高優先缺口 |
| 21524 | `GET /api/v1/uta/positions` | G-SELF | Trader | 券商真實持倉讀取，同 G-SELF 最低 Trader |
| 21545 | `GET /api/v1/uta/orders` | G-SELF | Trader | 統一下單流委託讀取，同 G-SELF 最低 Trader |

## 已核實：掃描誤判為 login-only，實際已有 Owner-only 驗證（6 處，不動）

這 6 個 `/api/v1/admin/*` 路由在 `server.ts` 內只是一行 `return handleXxx(c)`，role 檢查在各自獨立的 handler 檔案裡（非 server.ts 內聯），初次 grep 掃描誤判為「無 role 檢查」；逐檔核實後確認皆有 `session.user.role !== "Owner"` 擋，維持現狀。

| 行號 | 端點 | 驗證位置 |
|---|---|---|
| 20699 | `POST /api/v1/admin/themes/links-rebuild` | delegate 至 admin-themes-links-rebuild.ts，該檔內已 `session.user.role !== "Owner"` 擋，掃描誤判為 login-only，核實後維持現狀 |
| 20713 | `POST /api/v1/admin/themes/re-encode-mojibake` | delegate 至 admin-themes-re-encode-mojibake.ts，該檔內已 Owner-only 擋，核實後維持現狀 |
| 20724 | `POST /api/v1/admin/content-drafts/retry-review` | delegate 至 admin-content-drafts-retry-review.ts，該檔內已 Owner-only 擋，核實後維持現狀 |
| 20738 | `POST /api/v1/admin/content-drafts/cleanup-orphan` | delegate 至 admin-content-drafts-cleanup-orphan.ts，該檔內已 Owner-only 擋，核實後維持現狀 |
| 20755 | `POST /api/v1/admin/content-drafts/bulk-reject` | delegate 至 admin-content-drafts-bulk-reject.ts，該檔內已 Owner-only 擋，核實後維持現狀 |
| 20768 | `POST /api/v1/admin/themes/manual-update` | delegate 至 admin-themes-manual-update.ts，該檔內已 Owner-only 擋，核實後維持現狀 |

## 不適用（另一套驗證機制 / middleware 外，18 處，不動）

| 行號 | 端點 | 理由 |
|---|---|---|
| 770 | `GET /` | 根路由，middleware 外，無 session 概念，非權限矩陣範圍 |
| 777 | `GET /health` | 健康檢查，middleware 外，無 session 概念，非權限矩陣範圍 |
| 3974 | `POST /api/internal/openalice/jobs/claim` | isDeviceAuthRoute 允許清單，runner bearer device-auth，非 session role 範圍 |
| 3975 | `POST /api/internal/openalice/jobs/:jobId/heartbeat` | isDeviceAuthRoute 允許清單，同上 |
| 3976 | `POST /api/internal/openalice/jobs/:jobId/result` | isDeviceAuthRoute 允許清單，同上 |
| 3979 | `POST /api/v1/openalice/jobs/claim` | isDeviceAuthRoute 允許清單，同上 |
| 3980 | `POST /api/v1/openalice/jobs/:jobId/heartbeat` | isDeviceAuthRoute 允許清單(regex heartbeat|result)，同上 |
| 4089 | `POST /api/v1/webhooks/tradingview` | TradingView webhook，內部自有 TV_WEBHOOK_TOKEN + 常數時間比對驗證，非 session role 範圍 |
| 6188 | `POST /auth/login` | /api/v1/* middleware 外，登入本身，非權限矩陣範圍 |
| 6204 | `POST /auth/register-with-invite` | middleware 外，註冊流程，非權限矩陣範圍 |
| 6230 | `POST /auth/logout` | middleware 外，登出，非權限矩陣範圍 |
| 6264 | `GET /auth/me` | middleware 外，走 cookie 內建解析，非權限矩陣範圍 |
| 13884 | `GET /api/v1/paper/health` | isPublicDiagRoute 允許清單，完全公開(無需登入)，非本輪範圍 |
| 13997 | `GET /api/v1/paper/health/detail` | isPublicDiagRoute 允許清單，同上 |
| 14176 | `GET /api/v1/diagnostics/kbar` | isPublicDiagRoute 允許清單，完全公開(無需登入)，Pete 已審過零外洩，非本輪範圍 |
| 14342 | `GET /api/v1/diagnostics/kline-depth` | isPublicDiagRoute 允許清單，同上完全公開 |
| 21313 | `POST /api/v1/uta/gateway/register` | isDeviceAuthRoute 允許清單，走 bearer pairing-token 驗證（非 session role），另一套驗證機制，非本輪範圍 |
| 21363 | `POST /api/v1/uta/gateway/heartbeat` | isDeviceAuthRoute 允許清單，走 bearer gateway-token 驗證（非 session role），另一套驗證機制，非本輪範圍 |

## 維持登入即可（121 處，G-PUB 產品讀取 / G-SELF-personal 自我範圍資料，不動）

格式：`server.ts` 行號｜端點｜歸群｜理由

| 行號 | 端點 | 歸群 | 理由 |
|---|---|---|---|
| 785 | `GET /api/v1/session` | G-PUB | 回自己的 session，本來就該登入即可見 |
| 791 | `GET /api/v1/entitlements/me` | G-PUB | 回自己的 entitlements，同上 |
| 953 | `GET /api/v1/market-data/providers` | G-PUB | 市場資料來源狀態，純讀 |
| 963 | `GET /api/v1/market-data/policy` | G-PUB | 市場資料政策，純讀 |
| 970 | `GET /api/v1/market-data/symbols` | G-PUB | 商品清單，純讀 |
| 983 | `GET /api/v1/market-data/quotes` | G-PUB | 報價，純讀 |
| 997 | `GET /api/v1/market-data/resolve` | G-PUB | 報價 resolve，純讀 |
| 1010 | `GET /api/v1/market-data/effective-quotes` | G-PUB | 有效報價，純讀 |
| 1023 | `GET /api/v1/market-data/consumer-summary` | G-PUB | 純讀摘要 |
| 1037 | `GET /api/v1/market-data/selection-summary` | G-PUB | 純讀摘要 |
| 1050 | `GET /api/v1/market-data/decision-summary` | G-PUB | 純讀摘要 |
| 1063 | `GET /api/v1/market-data/history` | G-PUB | 歷史報價，純讀 |
| 1079 | `GET /api/v1/market-data/history/diagnostics` | G-PUB | 診斷資訊，純讀 |
| 1095 | `GET /api/v1/market-data/bars` | G-PUB | K 棒，純讀 |
| 1112 | `GET /api/v1/market-data/bars/diagnostics` | G-PUB | 診斷資訊，純讀 |
| 1155 | `GET /api/v1/market-data/overview` | G-PUB | 行情總覽，純讀 |
| 1295 | `GET /api/v1/risk/limits` | G-PORT | 風控上限讀取，G-PORT 讀=Viewer |
| 1315 | `GET /api/v1/risk/kill-switch` | G-PORT | kill switch 狀態讀取 |
| 1349 | `GET /api/v1/risk/effective-limits` | G-PORT | 讀取，Viewer |
| 1370 | `GET /api/v1/risk/strategy-limits` | G-PORT | 讀取，Viewer |
| 1420 | `GET /api/v1/risk/symbol-limits` | G-PORT | 讀取，Viewer |
| 1471 | `GET /api/v1/trading/accounts` | G-PORT | 讀取 |
| 1477 | `GET /api/v1/trading/balance` | G-PORT | 讀取 |
| 1484 | `GET /api/v1/trading/positions` | G-PORT | 讀取 |
| 1491 | `GET /api/v1/trading/orders` | G-PORT | 讀取 |
| 1524 | `POST /api/v1/trading/orders/preview` | G-PORT | 純預覽計算，不落 Order row，比照 promote-to-paper-preview 精神，Viewer 可 |
| 1551 | `GET /api/v1/trading/status` | G-PORT | 讀取 |
| 1558 | `GET /api/v1/trading/events` | G-PORT | 讀取 |
| 1573 | `GET /api/v1/trading/stream` | G-PORT | SSE 讀取串流 |
| 1604 | `GET /api/v1/company-graph/search` | G-PUB | 公司圖搜尋，純讀 |
| 1616 | `GET /api/v1/company-graph/stats` | G-PUB | 統計，純讀 |
| 1687 | `GET /api/v1/companies/lookup` | G-PUB | 單一公司查找，純讀 |
| 1742 | `GET /api/v1/companies/search` | G-PUB | 公司搜尋，純讀 |
| 1827 | `GET /api/v1/themes` | G-PUB | 主題清單，純讀 |
| 1936 | `GET /api/v1/themes/:id/graph` | G-PUB | 讀取 |
| 1953 | `GET /api/v1/theme-graph/stats` | G-PUB | 讀取 |
| 1970 | `GET /api/v1/theme-graph/search` | G-PUB | 讀取 |
| 1987 | `GET /api/v1/theme-graph/export` | G-PUB | 讀取(CSV/JSON 匯出同讀取內容) |
| 2011 | `GET /api/v1/theme-graph/rankings` | G-PUB | 讀取 |
| 2028 | `GET /api/v1/themes/:id` | G-PUB | 讀取 |
| 2053 | `GET /api/v1/companies` | G-PUB | 讀取 |
| 2069 | `GET /api/v1/companies/lite` | G-PUB | 讀取 |
| 2099 | `GET /api/v1/companies/:id/relations` | G-PUB | 讀取 |
| 2130 | `GET /api/v1/companies/:id/keywords` | G-PUB | 讀取 |
| 2161 | `GET /api/v1/companies/:id/graph` | G-PUB | 讀取 |
| 2185 | `GET /api/v1/companies/:id` | G-PUB | 讀取 |
| 2215 | `GET /api/v1/signals` | G-PUB | 訊號清單，讀取 |
| 2227 | `GET /api/v1/strategy/ideas` | G-PUB | 策略想法 feed，核心產品讀取 |
| 2265 | `POST /api/v1/strategy/ideas/:ideaId/promote-to-paper-preview` | G-PORT | 純預覽(previewOrder,commit:false)，不落單，比照其他 preview 端點 Viewer 可 |
| 2456 | `GET /api/v1/strategy/runs` | G-PUB | 讀取 |
| 2472 | `GET /api/v1/strategy/runs/:id` | G-PUB | 讀取 |
| 2845 | `GET /api/v1/signals/:id` | G-PUB | 讀取 |
| 2866 | `GET /api/v1/plans` | G-PORT | 交易計畫讀取，G-PORT 讀=Viewer |
| 2896 | `GET /api/v1/plans/brief` | G-PUB | 每日簡報聚合讀取 |
| 3025 | `GET /api/v1/plans/review` | G-PUB | 復盤聚合讀取 |
| 3149 | `GET /api/v1/plans/weekly` | G-PUB | 週計畫聚合讀取 |
| 3240 | `GET /api/v1/plans/:id` | G-PORT | 讀取 |
| 3268 | `GET /api/v1/reviews` | G-PUB | 讀取 |
| 3611 | `GET /api/v1/theme-summaries` | G-PUB | 已發布主題摘要，讀取 |
| 3623 | `GET /api/v1/company-notes` | G-PUB | 已發布公司筆記，讀取 |
| 3635 | `GET /api/v1/review-summaries` | G-PUB | 已發布復盤摘要，讀取 |
| 5929 | `GET /api/v1/kgi/quote/status` | G-PUB | 報價來源狀態，讀取 |
| 6016 | `GET /api/v1/kgi/quote/ticks` | G-PUB | 讀取 |
| 6071 | `GET /api/v1/kgi/quote/bidask` | G-PUB | 讀取 |
| 6098 | `GET /api/v1/kgi/quote/kbar/recover` | G-PUB | 讀取 |
| 6136 | `GET /api/v1/kgi/quote/kbar` | G-PUB | 讀取 |
| 6285 | `GET /api/v1/paper/flags` | G-PUB | 執行旗標診斷讀取 |
| 6372 | `GET /api/v1/paper/orders/:id` | G-PORT | 讀取，且已有 ownership check(userId 比對) |
| 6392 | `GET /api/v1/watchlist` | G-SELF-personal | 個人自選股清單，session.user.id 自我範圍，非交易能力，維持登入即可 |
| 6409 | `POST /api/v1/watchlist` | G-SELF-personal | 同上，寫入自己的清單 |
| 6429 | `POST /api/v1/watchlist/remove` | G-SELF-personal | 同上 |
| 6444 | `GET /api/v1/paper/orders` | G-PORT | 讀取 |
| 6483 | `GET /api/v1/paper/positions` | G-PORT | 讀取（兩個 handler 同名路徑，前者為 kgi sim 分支、後者為 paper 分支） |
| 6580 | `GET /api/v1/paper/positions` | G-PORT | 讀取（兩個 handler 同名路徑，前者為 kgi sim 分支、後者為 paper 分支） |
| 6626 | `POST /api/v1/paper/orders/preview` | G-PORT | 純預覽，不落單 |
| 6669 | `GET /api/v1/strategy/runs/:id/ideas` | G-PUB | 讀取 |
| 6696 | `GET /api/v1/ops/activity` | G-PUB | 雖底層調用 listAuditLogEntries，但為 Radar UI 設計的降敏摘要(僅 role/method/path 組字串，無 email/IP/payload)，屬產品活動摘要非原始審計，維持登入即可 |
| 6921 | `GET /api/v1/reviews/log` | G-PUB | 同 ops/activity，降敏摘要(reviewer/action/itemId)，非原始審計 |
| 7009 | `GET /api/v1/companies/:id/ohlcv` | G-PUB | K線讀取 |
| 7101 | `GET /api/v1/companies/:id/technical` | G-PUB | 技術指標讀取 |
| 7188 | `GET /api/v1/companies/ohlcv/bulk` | G-PUB | 批次K線讀取 |
| 7536 | `GET /api/v1/data-sources/finmind/status` | G-PUB | 資料源狀態，不含 token 本身 |
| 7908 | `GET /api/v1/companies/:id/kbar` | G-PUB | K棒讀取 |
| 8043 | `GET /api/v1/companies/:id/financials` | G-PUB | 財報讀取 |
| 8155 | `GET /api/v1/companies/:id/balance-sheet` | G-PUB | 資產負債表讀取 |
| 8205 | `GET /api/v1/companies/:id/cash-flow` | G-PUB | 現金流讀取 |
| 8262 | `GET /api/v1/companies/:id/revenue` | G-PUB | 營收讀取 |
| 8280 | `GET /api/v1/companies/:id/chips` | G-PUB | 籌碼面讀取 |
| 8336 | `GET /api/v1/companies/:id/shareholding` | G-PUB | 股權分散讀取 |
| 8372 | `GET /api/v1/companies/:id/dividend` | G-PUB | 股利讀取 |
| 8389 | `GET /api/v1/companies/:id/valuation` | G-PUB | 估值讀取 |
| 8407 | `GET /api/v1/companies/:id/market-value` | G-PUB | 市值讀取 |
| 8430 | `GET /api/v1/companies/:id/announcements` | G-PUB | 重大訊息讀取 |
| 8685 | `GET /api/v1/internal/legacy/companies/:id/announcements` | G-PUB | 同上舊版 |
| 9077 | `GET /api/v1/market-intel/news-top10` | G-PUB | 新聞，D3 明列 G-PUB |
| 9614 | `GET /api/v1/companies/:id/quote/realtime` | G-PUB | 即時報價讀取 |
| 13085 | `GET /api/v1/auth/session-probe` | G-PUB | 自己 session 探測 |
| 13118 | `GET /api/v1/diagnostics/finmind` | G-PUB | 診斷，token 永不回傳 |
| 13182 | `POST /api/v1/paper/preview` | G-PORT | 純預覽 |
| 13414 | `GET /api/v1/paper/db-probe` | G-PUB | DB 連線診斷 |
| 13592 | `GET /api/v1/paper/fills` | G-PORT | 自己的成交讀取(session.user.id 範圍) |
| 13711 | `GET /api/v1/paper/portfolio` | G-PORT | 自己的持倉讀取 |
| 13755 | `GET /api/v1/paper/funds` | G-PORT | 自己的資金讀取 |
| 14597 | `GET /api/v1/companies/:symbol/ohlcv` | G-PUB | FinMind K線讀取 |
| 14644 | `GET /api/v1/companies/:symbol/monthly-revenue` | G-PUB | 月營收讀取 |
| 14684 | `GET /api/v1/companies/:symbol/financials-v2` | G-PUB | 財報讀取 |
| 14742 | `GET /api/v1/companies/:symbol/institutional-flow` | G-PUB | 法人買賣超讀取 |
| 14777 | `GET /api/v1/companies/:symbol/margin` | G-PUB | 融資融券讀取 |
| 14811 | `GET /api/v1/companies/:symbol/dividend` | G-PUB | 股利讀取 |
| 15193 | `GET /api/v1/alerts` | G-PUB | 警示清單讀取 |
| 15213 | `POST /api/v1/alerts/:id/ack` | G-PUB | 確認自己的警示，低風險寫入 |
| 15232 | `GET /api/v1/alerts/sse` | G-PUB | 警示串流讀取 |
| 15315 | `GET /api/v1/iuf-events` | G-PUB | 事件 feed 讀取 |
| 19016 | `GET /api/v1/paper/portfolio/history` | G-PORT | 自己的歷史委託讀取 |
| 19394 | `POST /api/v1/auth/change-password` | G-SELF-personal | 自助改自己密碼，任何登入角色都該能做 |
| 19541 | `GET /api/v1/recommendations/today` | G-PUB | 推薦 feed 讀取 |
| 19562 | `GET /api/v1/recommendations/:id` | G-PUB | 讀取 |
| 19585 | `POST /api/v1/recommendations/:id/feedback` | G-PUB | 低風險回饋寫入(讚/踩) |
| 19803 | `GET /api/v1/ai-recommendations/v3` | G-PUB | 讀取 |
| 21058 | `POST /api/v1/openalice/chat` | G-PUB | AI 助理聊天功能，已有 rate limit，屬產品功能非治理 |
| 21147 | `GET /api/v1/uta/adapters` | G-PUB | 券商 adapter 能力靜態資訊，無帳戶資料 |

## 驗收對照

- 清單覆蓋全部 196 個 login-only 候選端點（本檔全部 4 張表加總 = 196）。
- 每個補閘處在 `apps/api/src/auth/role-matrix.test.ts` 的 `GATE_CASES`（PR-B2 區塊）都有對應矩陣測試列：角色 rank < minRole 斷言 403；角色 rank >= minRole 斷言非 403（雙向）。
- `pnpm test` / `pnpm typecheck` / W6 no-real-order audit / secret regression 全綠（見 PR 說明）。
- diff 只動 role 檢查：`apps/api/src/server.ts`（51 處 `requireMinRole` 插入 + 1 行 import）、`apps/api/src/auth/role-matrix.test.ts`（新增測試）、`tests/ci.test.ts`（既有 UOF-D6-3 文字視窗因新增 4 行 role 閘而擴大，純測試調整不動斷言邏輯）。
- 未動：`broker/*`、`kgi-gateway`、W6、migrations、`apps/web`；豁免清單三端點（`briefs/:id`、`dashboard/snapshot`、`paper/e2e`）與「留 29」不重分類（本輪為 login-only 池，非 READ_DRAFT_ROLES 51 處，兩池不重疊）。
