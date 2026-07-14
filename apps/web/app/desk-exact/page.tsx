// 交易台「原封搬原稿」預覽路由（2026-07-14）。獨立隔離，不動現有交易室 route。
// 靜態頁本體在 apps/web/public/desk-exact/index.html（逐字搬自
// reports/homepage_v51_20260713/trading_desk_artifact_source.html 的 <style>
// 與桌機 1280×760 / 手機 390×760 兩套版面），資料由頁內 inline script 呼叫既有
// /api/ui-final-v031/backend 代理注入，版面/CSS 完全未動。下單票／送出鍵刻意
// 維持唯讀（disabled + 誠實文案），本頁未接真送單——見交付報告的紅線處置段。
// Elva 拿這支路由跟原稿疊圖驗美術＋核對真資料，通過後才會裁決是否切換正式交易室
// route（本輪刻意不做）。
//
// 全屏做法照搬 /home-exact 前例：不重用 components/FinalOnlyFrame.tsx（其
// default/paper-trading-room 分支都會留下側欄或不同的 padding 假設），改在本頁
// 自己 render 一個專用全屏 iframe wrapper，scope key 換成本頁專屬 class
// （.iuf-desk-exact-fullscreen-frame），確保這組 body:has() CSS 只在
// /desk-exact 生效，不波及 market-intel/portfolio/ideas/home-exact 等其他路由。
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function DeskExactPreviewPage() {
  return (
    <main className="iuf-desk-exact-fullscreen-frame" aria-label="交易台原稿預覽">
      <style>{`
        .iuf-desk-exact-fullscreen-frame {
          position: fixed;
          inset: 0;
          z-index: 2147483000;
          width: 100vw;
          height: 100dvh;
          background: #080b10;
          isolation: isolate;
        }

        .iuf-desk-exact-fullscreen-frame iframe {
          display: block;
          width: 100%;
          height: 100%;
          border: 0;
          background: #080b10;
        }

        body:has(.iuf-desk-exact-fullscreen-frame) {
          overflow: hidden !important;
        }

        body:has(.iuf-desk-exact-fullscreen-frame) .app-main-shell {
          padding: 0 !important;
        }

        body:has(.iuf-desk-exact-fullscreen-frame) .app-sidebar,
        body:has(.iuf-desk-exact-fullscreen-frame) .header-dock,
        body:has(.iuf-desk-exact-fullscreen-frame) .header-dock-scrim,
        body:has(.iuf-desk-exact-fullscreen-frame) .header-dock-drawer,
        body:has(.iuf-desk-exact-fullscreen-frame) .command-palette,
        body:has(.iuf-desk-exact-fullscreen-frame) .source-badge {
          display: none !important;
        }
      `}</style>
      <iframe
        title="交易台原稿預覽"
        src={`/desk-exact/index.html?rev=${Date.now().toString(36)}`}
        loading="eager"
        referrerPolicy="same-origin"
      />
    </main>
  );
}
