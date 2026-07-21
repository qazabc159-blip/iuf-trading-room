import { FinalOnlyFrame } from "@/components/FinalOnlyFrame";

// ⚠️ 2026-07-21：這個檔案在正常瀏覽下永遠不會被渲染。middleware.ts 的
// `FINAL_V031_ROUTE_REWRITES` 對每個已登入請求把 `/market-intel` 路徑無聲
// rewrite 成 `/final-v031/market-intel`（2026-05-13「bypass cached v0.3.1 UI
// routes」引入的暫時繞過，一直留到現在，同款 shadow 也套用在 /portfolio，見
// 該檔開頭註解）。導覽列「市場情報」實際渲染的是
// app/final-v031/market-intel/page.tsx（房子樣式 RSC 版，2026-07-21 上線），
// 不是這支檔案——真正要改市場情報頁內容請改那支檔案。這裡保留舊
// FinalOnlyFrame iframe 版不動，只補這則說明避免下次誤改。
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function MarketIntelPage() {
  return <FinalOnlyFrame title="Market Intel" src={`/api/ui-final-v031/market-intel?rev=${Date.now().toString(36)}`} />;
}
