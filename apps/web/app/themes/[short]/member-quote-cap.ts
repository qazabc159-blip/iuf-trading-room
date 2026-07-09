// 主題成員報價 fan-out 上限（decision-flow C-2 / Pete review #1189 必修）。
//
// 主題成員可達百餘檔；若每列各自 useEffect 無上限發 GET /companies/:id/quote/realtime，
// 掛載瞬間就是 N 個併發請求，會撞 KGI 新星 40-slot 訂閱硬上限
// （apps/api/src/kgi-subscription-manager.ts MAX_SLOTS=40）並用 LRU 把其他頁面正在看的
// 報價換掉，還會對 MIS 直打 N 次。比照既有防禦先例
// apps/web/components/watchlist/WatchlistTable.tsx 的 cap=10（此處取 15，同一數量級）。
export const MEMBER_QUOTE_FETCH_CAP = 15;

export function shouldFetchMemberQuote(index: number, cap: number = MEMBER_QUOTE_FETCH_CAP): boolean {
  return index < cap;
}
