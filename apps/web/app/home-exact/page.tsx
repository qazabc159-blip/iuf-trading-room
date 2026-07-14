// 首頁「原封搬原稿」預覽路由（2026-07-14）。獨立隔離，不動現有 "/" 首頁。
// 靜態頁本體在 apps/web/public/home-exact/index.html（逐字搬自 artifact 原稿的
// <style> 與桌機/手機兩套版面），資料由頁內 inline script 呼叫既有
// /api/ui-final-v031/backend 代理與 /api/home-exact/recommendations 端點注入，
// 版面/CSS 完全未動。Elva 拿這支路由跟原稿疊圖驗美術＋核對真資料，通過後才會把
// index.html 內容切進正式 "/"。
//
// 全屏修正（2026-07-14 疊圖回饋）：原稿是全屏設計、自帶 masthead 當導航，外面不該
// 再套 app 側欄／HeaderDock。刻意不重用 components/FinalOnlyFrame.tsx（它的
// default 分支把 iframe 留在 .app-main-shell 內、paper-trading-room 分支仍保留
// 252px 側欄——兩者都不是這裡要的），改在本頁自己 render 一個專用的全屏 iframe
// wrapper，靠一個只有這個頁面會掛上的 class
// （.iuf-home-exact-fullscreen-frame）當 body:has() 的 scope key，確保這組
// CSS 只在 /home-exact 生效，不會波及 market-intel/portfolio/ideas 等其他
// final-v031 路由。
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function HomeExactPreviewPage() {
  return (
    <main className="iuf-home-exact-fullscreen-frame" aria-label="首頁原稿預覽">
      <style>{`
        .iuf-home-exact-fullscreen-frame {
          position: fixed;
          inset: 0;
          z-index: 2147483000;
          width: 100vw;
          height: 100dvh;
          background: #04060a;
          isolation: isolate;
        }

        .iuf-home-exact-fullscreen-frame iframe {
          display: block;
          width: 100%;
          height: 100%;
          border: 0;
          background: #04060a;
        }

        body:has(.iuf-home-exact-fullscreen-frame) {
          overflow: hidden !important;
        }

        body:has(.iuf-home-exact-fullscreen-frame) .app-main-shell {
          padding: 0 !important;
        }

        body:has(.iuf-home-exact-fullscreen-frame) .app-sidebar,
        body:has(.iuf-home-exact-fullscreen-frame) .header-dock,
        body:has(.iuf-home-exact-fullscreen-frame) .header-dock-scrim,
        body:has(.iuf-home-exact-fullscreen-frame) .header-dock-drawer,
        body:has(.iuf-home-exact-fullscreen-frame) .command-palette,
        body:has(.iuf-home-exact-fullscreen-frame) .source-badge {
          display: none !important;
        }
      `}</style>
      <iframe
        title="首頁原稿預覽"
        src={`/home-exact/index.html?rev=${Date.now().toString(36)}`}
        loading="eager"
        referrerPolicy="same-origin"
      />
    </main>
  );
}
