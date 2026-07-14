import { FinalOnlyFrame } from "@/components/FinalOnlyFrame";

// 交易台「原封搬原稿」路由（2026-07-14）。
// 靜態頁本體在 apps/web/public/desk-exact/index.html（byte-exact 原稿＋比例
// 控制 override），資料與 paper 送單由頁內 inline script 走既有代理。
//
// 2026-07-14 楊董三連退修正：全屏 fixed wrapper 砍掉側欄導航＋1280 密度設計
// 拉滿大螢幕比例失衡 → 改回 FinalOnlyFrame（app 殼內嵌，側欄/頂欄回歸，與
// /market-intel 同款），index.html override 改 max-width 置中控比例。
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function DeskExactPage() {
  return <FinalOnlyFrame title="交易台" src={`/desk-exact/index.html?rev=${Date.now().toString(36)}`} />;
}
