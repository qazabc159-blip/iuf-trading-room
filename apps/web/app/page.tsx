import { FinalOnlyFrame } from "@/components/FinalOnlyFrame";

// 正式首頁「原封搬原稿」（2026-07-14）。
// 版面本體＝apps/web/public/home-exact/index.html（byte-exact 原稿＋比例控制
// override），資料由頁內 inline script 走既有代理注入真值，缺料誠實 EMPTY。
//
// 2026-07-14 楊董三連退修正：
// - 全屏 fixed wrapper 把 app 側欄/頂欄全藏＝砍掉導航（「側邊欄呢？怎麼選其他
//   頁？」）→ 改回 FinalOnlyFrame（app 殼內嵌，與 /market-intel 同款），側欄與
//   HeaderDock 回歸。
// - 比例失衡（1280 密度設計直接拉滿 1920）→ index.html override 改
//   max-width:1520px 置中＋背景延伸，比例貼回原稿密度。
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function HomePage() {
  return <FinalOnlyFrame title="IUF 戰情室首頁" src={`/home-exact/index.html?rev=${Date.now().toString(36)}`} />;
}
