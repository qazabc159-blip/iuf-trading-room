# P1-6 主題板保守版修復 — before/after 證據

Source: `reports/product_critique_20260710/PRODUCT_CRITIQUE_v1.md` P1-6。
`before/` = prod https://app.eycvector.com/themes（本輪未部署前的現況，即目前 deploy 的舊碼）。
`after/` = 本機 `next start`（`fix/themes-honest-state-jim-20260712` 分支，`NEXT_PUBLIC_API_BASE_URL=https://api.eycvector.com` 打真 prod API）+ 真 SEED_OWNER session。
兩者讀的是同一份 prod 主題資料（20 個主題，全數 Discovery/研究中，進攻＝防守＝活躍＝P1＝0）。

桌面 1280px + 手機 390px（`mobile-iphone-13` Playwright project）各一張。

## 本輪四項修復對照

1. **「P1 主題」人話化**：hero KPI 標籤改「優先追蹤主題」（此輪因分類全零而整格收斂進 3 的說明句，故 after 圖看不到這個 label 本身，但原始碼與新測試已鎖住不再出現 `"P1 主題"` 字樣）。
2. **全零分類統計列收斂**：before 圖可見「進攻主題 0／防守主題 0／P1 主題 0」（hero-kpi）＋「活躍主題 0」（parity-kpi-bar）共 4 個 0；after 圖這 4 格全部消失，改成一句「主題分類建置中 目前 20 個主題皆在研究階段，暫無進攻／防守／活躍分類可顯示。」
3. **主題卡空態描述**：程式碼改為「有真描述才顯示，落到通用占位句就不加」（`themeCardDescription`）；目前 prod 這 20 個主題實際上都已有可用的 thesis/curated 內容，所以視覺上兩張圖看不出差異（沒有真正空卡可比對）——這是誠實結果，不是沒做，邏輯已由 `themes-honest-state.test.ts` 鎖住。
4. **頁首定位說明**：page note 從「主題板 / 正式主題資料；只顯示已連結公司池與可追蹤狀態。」擴充為說明這頁跟公司板／AI 推薦的關係（見 after 圖頂部小字）。

## 未處理（保留給楊董裁決）

- 結構性選項（沒有活躍主題前把主題板收進公司板 tab，或從一級導覽降級）——本輪保守版不做，見 PR body。
- 每張主題卡左上角的 `P{n}` 迷你徽章（如 `P3`）未一併人話化——只處理了明確被點名的 hero KPI「P1 主題」聚合標籤，卡片徽章維持原樣，避免範圍擴大成主觀判斷。
