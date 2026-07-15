import { FinalOnlyFrame } from "@/components/FinalOnlyFrame";
import { buildHandoffFrameTitle, buildPaperRoomSrc, type PortfolioSearchParams } from "@/lib/portfolio-handoff";

// ⚠️ 2026-07-15 發現：這個檔案在正常瀏覽下永遠不會被渲染。
// `middleware.ts` 的 `FINAL_V031_ROUTE_REWRITES` 對每個已登入請求把
// `/portfolio` 路徑無聲 rewrite 成 `/final-v031/portfolio`（2026-05-13
// #「bypass cached v0.3.1 UI routes」引入的暫時繞過，一直留到現在）。導覽列
// 「交易室」實際渲染的是 app/final-v031/portfolio/page.tsx，不是這支檔案——
// 真正要切換正式交易室內容請改那支檔案（見 feat/desk-official-route-jim-
// 20260715：這裡先被誤改成指向 /desk-exact，本機驗證用 curl 直打 SSR HTML
// 才發現 src 沒變，抓出這個 middleware shadow，故改回原樣不留誤導性 diff）。
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function PortfolioPage({
  searchParams,
}: {
  searchParams?: Promise<PortfolioSearchParams>;
}) {
  const params = searchParams ? await searchParams : undefined;
  return <FinalOnlyFrame title={buildHandoffFrameTitle(params)} src={buildPaperRoomSrc(params)} />;
}
