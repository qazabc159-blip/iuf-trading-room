# Jim Evidence — Watchlist 10-cap Enforcement + Source Label Wording
**Date**: 2026-05-13
**PR**: #420 feat/web-watchlist-cap-label-wording-2026-05-13
**Commit**: ead4aae

## Task 1 — Watchlist 10-cap Enforcement

### Files changed
- `apps/web/components/watchlist/WatchlistSurface.tsx`
- `apps/web/components/watchlist/WatchlistTable.tsx`

### What was done
- Added `WATCHLIST_CAP = 10` constant in WatchlistSurface
- When `rows.length >= WATCHLIST_CAP`: displays warning banner with text
  「觀察清單已滿 (N/10)，移除一檔後再加，或聯絡管理員提升額度。」
- Added hint icon (ⓘ) in source strip with tooltip: 「即時觀察清單上限 10 檔，可隨時調整成員」
- WatchlistTable now accepts `cap` prop (default 10); slices display to cap rows
- Overflow message updated to: 「顯示前 N 檔，共 M 檔；移除後可新增更多。」

### Forbidden wording check
- 0 uses of: KGI quota / subscription quota / 訂閱配額 / 工程語意

## Task 2 — Label Wording Precision

### Files changed
- `apps/web/app/page.tsx` — RealtimeHeatmapPanel
- `apps/web/app/m/MobileKgiWatchlist.tsx`
- `apps/web/app/companies/[symbol]/CompanyHeroBar.tsx`
- `apps/web/app/companies/[symbol]/LiveTickStreamPanel.tsx`

### Changes made

**page.tsx (RealtimeHeatmapPanel)**
- Core heatmap offline label: was empty fallback → now "核心 · 約 1 分鐘前最後一筆" (if ts exists) or "核心 · 連線維護中"
- Full market heatmap: "全市場 · 今日收盤" or "全市場 · 昨日收盤" via closeLabel(ts) — already correct

**MobileKgiWatchlist.tsx**
- Header: "KGI / 即時報價" → "即時報價" (live) or "報價" (offline)
- Footer: "KGI gateway 54.249.139.28 · 15s poll · 不存 cookie" → "公開資料 · 約 5–15 秒延遲 · 不存 cookie"

**CompanyHeroBar.tsx**
- `rtSource`: "KGI 即時" → "即時報價"; EOD → "今日收盤"
- Meta line: shows "即時" when `isLive`, "今日收盤" when from EOD
- When not live and not stale: shows "加入觀察清單可看即時報價" hint in meta line

**LiveTickStreamPanel.tsx**
- Blocked panel label: "KGI gateway /api/v1/kgi/quote/ticks" → "即時成交明細暫時無法讀取"
- Loading text: "正在向 KGI gateway 取得逐筆資料…" → "正在取得即時成交明細…"
- Reason strings: All "KGI gateway/EC2 IP/whitelist env var" → product Chinese
  - SYMBOL_NOT_ALLOWED → "此代號目前不在即時訂閱範圍內"
  - GATEWAY_UNREACHABLE → "連線暫時中斷，請稍後再試"
  - QUOTE_DISABLED → "即時報價服務暫時停用"
  - GATEWAY_AUTH → "連線工作階段尚未建立"

## Verification

### Typecheck
```
npx tsc --noEmit -p apps/web/tsconfig.json
EXIT: 0 (no output)
```

### Forbidden wording scan (JSX render paths)
```
grep "KGI|kgi_tick|twse_openapi|subscription quota|訂閱配額" [changed files] | grep -v comment
```
Result: 0 hits in JSX render paths (remaining hits are comment lines only)

### Codex lane check
- `apps/web/app/api/ui-final-v031/` — NOT staged, NOT touched
- `apps/web/lib/final-v031-live.ts` — NOT staged, NOT touched
- `apps/web/app/layout.tsx` — NOT touched
- `apps/web/components/FinalOnlyFrame.tsx` — NOT touched

## Hard-line status
- 0 forbidden engineering wording in UI
- 0 Codex lane violations
- typecheck PASS
- 6 files changed, 50 insertions, 18 deletions
