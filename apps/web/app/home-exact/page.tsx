import { FinalOnlyFrame } from "@/components/FinalOnlyFrame";

// 首頁「原封搬原稿」預覽路由（2026-07-14）。獨立隔離，不動現有 "/" 首頁。
// 靜態頁本體在 apps/web/public/home-exact/index.html（逐字搬自 artifact 原稿的
// <style> 與桌機/手機兩套版面），資料由頁內 inline script 呼叫既有
// /api/ui-final-v031/backend 代理與 /api/home-exact/recommendations 端點注入，
// 版面/CSS 完全未動。Elva 拿這支路由跟原稿疊圖驗美術＋核對真資料，通過後才會把
// index.html 內容切進正式 "/"。
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function HomeExactPreviewPage() {
  return <FinalOnlyFrame title="首頁原稿預覽" src={`/home-exact/index.html?rev=${Date.now().toString(36)}`} />;
}
