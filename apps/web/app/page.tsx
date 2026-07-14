// 正式首頁「原封搬原稿」（2026-07-14 楊董定案：把原先的首頁換成討論好的排版美術）。
// 版面本體＝apps/web/public/home-exact/index.html：逐字搬自 artifact 原稿的 <style>
// 與桌機/手機兩套版面（byte-exact，全寬 override），資料由頁內 inline script 呼叫
// 既有 /api/ui-final-v031/backend 代理與 /api/home-exact/recommendations 注入真值，
// 缺料誠實 EMPTY。舊 LEDGER relayout 版（.tac-* 仿製，被打槍 6 輪）整檔退役，
// 歷史見 git log 本檔 2026-07-13 以前版本。
//
// 全屏 wrapper 與 /home-exact 預覽路由共用同一套做法：原稿自帶 masthead 當頂欄，
// app 側欄／HeaderDock 在本頁隱藏（scope key class 只在本頁與 /home-exact 掛上，
// 不波及其他路由）。導航 follow-up：masthead 連結接真路由（切版先行、導航精修後補）。
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function HomePage() {
  return (
    <main className="iuf-home-exact-fullscreen-frame" aria-label="IUF 戰情室首頁">
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
        title="IUF 戰情室首頁"
        src={`/home-exact/index.html?rev=${Date.now().toString(36)}`}
        loading="eager"
        referrerPolicy="same-origin"
      />
    </main>
  );
}
