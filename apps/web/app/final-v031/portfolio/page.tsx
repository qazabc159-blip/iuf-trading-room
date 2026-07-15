import { FinalOnlyFrame } from "@/components/FinalOnlyFrame";
import { buildHandoffFrameTitle, type PortfolioSearchParams } from "@/lib/portfolio-handoff";
import { buildDeskExactSrc } from "@/lib/desk-exact-handoff";

// 2026-07-15：這是導覽列「交易室」實際渲染的檔案（middleware.ts 把每個已登入
// 的 `/portfolio` 請求無聲 rewrite 到這裡，見 `apps/web/app/portfolio/page.tsx`
// 開頭註解）。改指向 /desk-exact 定版引擎（apps/web/public/desk-exact/index.html，
// 原封搬原稿＋真 K 線/MA20/MACD＋5 委託分頁＋#1252 下單面板矩陣＋真 paper
// 送單，7/15 盤中 201 落委託表已由 Bruce 驗證），取代舊
// /api/ui-final-v031/paper-trading-room iframe（`buildPaperRoomSrc`）。
//
// 回退：git revert 本次改動即可，舊 buildPaperRoomSrc()／
// /api/ui-final-v031/paper-trading-room 後端 route 完全未刪除、未動。
//
// desk-exact 引擎只認 symbol/side 兩個 query（見 lib/desk-exact-handoff.ts
// 註解，是 owner-locked verbatim artifact，不在這裡擴充它認得的參數）；既有
// 較豐富的 handoff 參數（ticker/from_rec/entry/stop/tp 等，portfolio-handoff.ts）
// 在這裡窄化為 symbol/side 兩個轉發給引擎，其餘參數只影響 frame title 的來源
// 摘要文字，不影響引擎行為。
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function FinalV031PortfolioPage({
  searchParams,
}: {
  searchParams?: Promise<PortfolioSearchParams>;
}) {
  const params = searchParams ? await searchParams : undefined;
  const symbol = params?.ticker ?? params?.symbol;
  const side = params?.side;
  return (
    <FinalOnlyFrame title={buildHandoffFrameTitle(params)} src={buildDeskExactSrc({ symbol, side })} />
  );
}
