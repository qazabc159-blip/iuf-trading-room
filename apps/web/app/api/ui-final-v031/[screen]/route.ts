import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import {
  buildFinalV031LivePayload,
  finalV031HydrationScript,
  type FinalV031Screen,
} from "@/lib/final-v031-live";
import { parsePaperPrefillSearchParams } from "@/lib/portfolio-handoff";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, max-age=0, must-revalidate",
  "CDN-Cache-Control": "no-store",
  "Vercel-CDN-Cache-Control": "no-store"
};

const SCREENS = {
  "market-intel": {
    dir: "market_intel",
    css: ["tokens.css", "app.css"]
  },
  "strategy-ideas": {
    dir: "strategy_ideas",
    css: ["tokens.css", "app.css"]
  },
  "paper-trading-room": {
    dir: "paper_trading_room",
    css: ["tokens.css", "app.css", "trading.css"]
  }
} as const;

type ScreenKey = keyof typeof SCREENS;

function isScreenKey(value: string): value is ScreenKey {
  return Object.prototype.hasOwnProperty.call(SCREENS, value);
}

function contentShellOverrides(screen: ScreenKey) {
  const common = `
<style data-iuf-final-v031="content-shell-overrides">
  html,
  body {
    min-height: 100%;
    overflow: auto;
    background: #080b10;
  }

  body.iuf-v031-embedded {
    margin: 0;
    background: #080b10;
  }
`;

  if (screen === "paper-trading-room") {
    return `${common}
  html,
  body,
  body.iuf-v031-embedded {
    width: 100vw !important;
    max-width: 100vw !important;
    height: 100dvh !important;
    min-height: 100dvh !important;
    overflow: hidden !important;
    scrollbar-width: none !important;
    overscroll-behavior: none !important;
  }

  *::-webkit-scrollbar {
    width: 0 !important;
    height: 0 !important;
  }

  .tbar {
    display: none !important;
  }

  .psafe {
    position: sticky;
    top: 0;
    z-index: 30;
    height: 32px;
    min-height: 32px;
    max-height: 32px;
    overflow: hidden;
    flex-wrap: nowrap !important;
    white-space: nowrap !important;
    padding: 6px 12px !important;
  }

  .psafe > span:last-child {
    min-width: 0 !important;
    overflow: hidden !important;
    text-overflow: ellipsis !important;
  }

  /* Broker strip is a fixed 30px row in embedded mode; .troom subtracts it so the
     desk keeps its exact viewport fit (psafe 32 + brokerstrip 30 = 62). */
  .brokerstrip {
    position: sticky;
    top: 32px;
    z-index: 29;
    height: 30px;
    min-height: 30px;
    max-height: 30px;
    overflow: hidden;
    flex-wrap: nowrap !important;
    white-space: nowrap !important;
    padding: 4px 12px !important;
  }

  .troom {
    box-sizing: border-box !important;
    width: 100vw !important;
    max-width: 100vw !important;
    height: calc(100dvh - 62px) !important;
    min-height: 0 !important;
    margin: 0 !important;
    padding: 6px !important;
    overflow: hidden !important;
    gap: 6px !important;
    grid-template-columns: clamp(220px, 13.5vw, 252px) minmax(0, 1fr) clamp(344px, 20.5vw, 392px) !important;
    align-items: stretch !important;
  }

  .cpane {
    min-width: 0 !important;
    min-height: 0 !important;
    overflow: hidden !important;
    display: grid !important;
    grid-template-rows: auto minmax(0, 1fr) 86px 132px !important;
    gap: 8px !important;
  }

  .chart-panel.is-real-chart {
    min-height: 0 !important;
    height: 100% !important;
    display: flex !important;
    flex-direction: column !important;
  }

  .real-kline-frame-shell {
    flex: 1 1 auto !important;
    min-height: 0 !important;
    height: 100% !important;
    max-height: 100% !important;
    position: relative !important;
    contain: size layout paint !important;
  }

  .rpane,
  .tform,
  .real-kline-frame-shell {
    overflow: hidden !important;
    scrollbar-width: none !important;
  }

  .lpane,
  .rpane {
    height: 100% !important;
    max-height: 100% !important;
    align-self: stretch !important;
    min-height: 0 !important;
    scrollbar-width: none !important;
  }

  .lpane::-webkit-scrollbar,
  .rpane::-webkit-scrollbar,
  .wlist::-webkit-scrollbar,
  .ltab::-webkit-scrollbar,
  .ltab.on::-webkit-scrollbar {
    width: 0 !important;
    height: 0 !important;
  }

  .rpane,
  .rpane * {
    min-width: 0 !important;
  }

  .rpane .th {
    flex: 0 0 auto !important;
    padding: 8px 12px !important;
  }

  .rpane .th h3 {
    font-size: 13px !important;
  }

  .tform {
    flex: 1 1 auto !important;
    min-height: 0 !important;
    height: 100% !important;
    padding: 9px 12px 8px !important;
    gap: 7px !important;
    overflow-y: hidden !important;
    overflow-x: hidden !important;
    justify-content: stretch !important;
  }

  .tform .field {
    gap: 3px !important;
  }

  .tform .field .l {
    line-height: 1.25 !important;
  }

  .tform .field input,
  .tform .field select {
    min-height: 32px !important;
    padding: 7px 9px !important;
    font-size: 12.5px !important;
  }

  .tform .field .step {
    display: grid !important;
    grid-template-columns: 31px minmax(0, 1fr) 31px !important;
    gap: 5px !important;
  }

  .tform .field .step .stepbtn {
    width: 31px !important;
    height: 32px !important;
  }

  .tform .field .units {
    display: grid !important;
    grid-template-columns: 1fr 1fr !important;
    width: 100% !important;
  }

  .preview {
    grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
    gap: 6px 9px !important;
    padding: 8px 10px !important;
  }

  .preview .v {
    font-size: 13px !important;
  }

  .gate {
    padding: 8px 10px !important;
    gap: 4px !important;
  }

  .gate .li {
    padding: 3px 0 !important;
    line-height: 1.3 !important;
  }

  .tactions {
    padding: 0 !important;
    gap: 6px !important;
  }

  .tactions .submit {
    min-height: 40px !important;
    padding: 9px 10px !important;
    white-space: normal !important;
    line-height: 1.35 !important;
  }

  .tactions .submit span:first-child {
    min-width: 0 !important;
    overflow-wrap: anywhere !important;
  }

  .tactions .liveex {
    padding: 7px 9px !important;
    flex-wrap: wrap !important;
    gap: 6px 8px !important;
    line-height: 1.25 !important;
  }

  .tfoot {
    font-size: 10.5px !important;
    line-height: 1.42 !important;
    padding: 0 1px !important;
    max-height: 58px !important;
    overflow: hidden !important;
  }

  .real-kline-frame-shell iframe {
    position: absolute !important;
    inset: 0 !important;
    display: block !important;
    width: 100% !important;
    height: 100% !important;
    max-width: 100% !important;
    border: 0 !important;
    overflow: hidden !important;
  }

  .ledger .ltab.on {
    overflow: hidden !important;
    scrollbar-width: none !important;
  }

  @media (max-height: 900px) {
    .psafe {
      height: 28px !important;
      min-height: 28px !important;
      max-height: 28px !important;
      padding-top: 4px !important;
      padding-bottom: 4px !important;
    }

    .brokerstrip {
      top: 28px;
      height: 28px !important;
      min-height: 28px !important;
      max-height: 28px !important;
      padding-top: 3px !important;
      padding-bottom: 3px !important;
    }

    .troom {
      height: calc(100dvh - 56px) !important;
    }

    .symhead {
      padding: 10px 14px !important;
      gap: 12px !important;
    }

    .symhead .sym {
      font-size: 24px !important;
    }

    .symhead .price .v {
      font-size: 30px !important;
    }

    .cpane {
      grid-template-rows: auto minmax(0, 1fr) 70px 104px !important;
      gap: 6px !important;
    }

    .tape {
      height: 70px !important;
    }

    .tape > div {
      padding: 6px 8px !important;
    }

    .ledger {
      height: 104px !important;
    }

    .lhead .tb {
      padding: 9px 10px !important;
      font-size: 11px !important;
    }

    .ltab.on {
      height: 66px !important;
    }

    .tform {
      gap: 5px !important;
      padding: 8px 10px 7px !important;
    }

    .tform .field .l,
    .preview .l,
    .gate .h {
      font-size: 9.5px !important;
    }

    .preview {
      padding: 7px 9px !important;
    }

    .gate .list {
      max-height: 38px !important;
      overflow: hidden !important;
    }

    .tfoot {
      max-height: 42px !important;
    }
  }

  .rec-prefill-box {
    margin: 0 0 12px;
    border: 1px solid rgba(200, 148, 63, 0.34);
    border-radius: 6px;
    background: linear-gradient(180deg, rgba(200, 148, 63, 0.11), rgba(8, 11, 16, 0.72));
    padding: 10px 11px;
    color: var(--fg-1);
    box-shadow: 0 0 0 1px rgba(3, 5, 8, 0.48) inset;
  }

  .rec-prefill-box .k {
    color: var(--brand);
    font: 800 10px/1 var(--mono);
    letter-spacing: 0;
  }

  .rec-prefill-box .v {
    margin-top: 6px;
    color: var(--fg-0);
    font: 800 13px/1.35 var(--sans-tc);
  }

  .rec-prefill-box .m {
    display: flex;
    flex-wrap: wrap;
    gap: 7px;
    margin-top: 8px;
    color: var(--fg-3);
    font: 700 11px/1.35 var(--sans-tc);
  }

  .rec-prefill-box .m span {
    border: 1px solid rgba(220, 228, 240, 0.09);
    border-radius: 4px;
    padding: 4px 6px;
    background: rgba(8, 11, 16, 0.46);
  }

  @media (max-width: 767px) {
    .troom {
      display: flex !important;
      flex-direction: column !important;
      gap: 12px !important;
      min-height: auto !important;
      padding: 12px !important;
    }

    .lpane,
    .rpane {
      position: relative !important;
      top: auto !important;
      width: 100% !important;
      max-width: 100% !important;
      height: auto !important;
      overflow: visible !important;
    }

    .cpane {
      width: 100% !important;
      min-width: 0 !important;
    }

    .symhead .price {
      margin-left: 0 !important;
      align-items: flex-start !important;
    }

    .symhead .stats {
      width: 100% !important;
      grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
      gap: 10px !important;
      margin-left: 0 !important;
      padding-left: 0 !important;
      border-left: 0 !important;
    }

    .chart-wrap {
      height: 220px !important;
    }

    .tape,
    .tform .field.row2,
    .preview {
      grid-template-columns: 1fr !important;
    }

    /* 盤口密度（PR-B, 2026-07-10）行動裝置修正: 桌面版 .tape .stk 用
       flex:1 1 auto + min-height:0 吃父層剩餘高度，但手機把 .troom 換成
       flex column 後 .tape>div 的父層高度鏈斷了（.cpane 內部仍是桌面那組
       grid-template-rows 固定列高，.tape>div 實測只分到 ~22px），
       flex-grow 沒東西可分、min-height:0 又准許縮到 0 → #depth 整個
       塌成 0 高度、Playwright toBeVisible 判 hidden（真的手機倒退，非本來
       就這樣）。手機改用固定 min-height 頂住，不依賴 flex-grow。*/
    .tape .stk {
      flex: 0 0 auto !important;
      min-height: 70px !important;
      max-height: 200px !important;
    }

    /* 手機下單流觸控目標（動員令附加，2026-07-09）: 送出鈕在桌面緊湊嵌入模式
       固定 min-height:40px（非本 media query），390px 下低於 44px 觸控基準
       線，Playwright 390px 真機驗測到；只在行動裝置寬度加高，不動桌面值。 */
    .tactions .submit {
      min-height: 44px !important;
    }

    /* 觸控目標鐵律 P2（2026-07-10）: 券商列 .bbtn（桌面緊湊模式 padding:4px 12px
       實測約 29px）與加減鈕 .stepbtn（桌面固定 31x32px，見上方非 media 區塊）
       同樣低於 44px 觸控基準線 — 7/9 PR-4 驗證時記錄（jim_mobile_order_flow_
       20260709.spec.ts）。只在此 max-width:767px 區塊內補高，不動桌面密度。*/
    .brokerstrip {
      height: auto !important;
      min-height: 44px !important;
      max-height: none !important;
      overflow: visible !important;
      flex-wrap: wrap !important;
    }

    .brokerstrip .bbtn {
      min-height: 44px !important;
      padding: 10px 12px !important;
    }

    .tform .field .step {
      grid-template-columns: 44px minmax(0, 1fr) 44px !important;
    }

    .tform .field .step .stepbtn {
      width: 44px !important;
      height: 44px !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
    }

    /* 委託回報面板（PR-A, 2026-07-10）: 7 欄表格在 390px 下用橫捲，不做卡片化 —
       scoped 到這個新 tab 本身的 data-lt selector，不動既有 .ltab.on 的桌面
       overflow:hidden 規則（那條規則管全部既有分頁，改了會牽動委託/成交等頁）。*/
    .ltab[data-lt="uta-orders"] {
      overflow-x: auto !important;
    }

    .ltab[data-lt="uta-orders"] table {
      min-width: 560px !important;
    }
  }
</style>`;
  }

  return `${common}
  .app {
    display: block !important;
    grid-template-columns: 1fr !important;
    max-width: none !important;
    min-height: auto !important;
    margin: 0 !important;
  }

  .side {
    display: none !important;
  }

  .main {
    padding: 22px 30px 60px !important;
  }

  @media (max-width: 900px) {
    .main {
      padding: 18px 16px 44px !important;
    }
  }
</style>`;
}

function stripVendorChrome(screen: ScreenKey, html: string) {
  let next = html;

  if (screen === "market-intel" || screen === "strategy-ideas") {
    next = next.replace(/\s*<aside class="side">[\s\S]*?<\/aside>\s*/i, "");
  }

  if (screen === "paper-trading-room") {
    next = next.replace(
      /\s*<!-- ============ TOP BAR ============ -->[\s\S]*?(?=<!-- ============ SAFETY BAR ============ -->)/i,
      ""
    );
  }

  return next.replace(/<body(?![^>]*\bclass=)/i, '<body class="iuf-v031-embedded"');
}

async function renderFinalHtml(screen: ScreenKey) {
  const config = SCREENS[screen];
  const baseDir = path.join(process.cwd(), "public", "ui-final-v031", config.dir);
  const [html, ...cssBlocks] = await Promise.all([
    readFile(path.join(baseDir, "index.html"), "utf8"),
    ...config.css.map((fileName) => readFile(path.join(baseDir, fileName), "utf8"))
  ]);

  const styleTags = cssBlocks
    .map((css, index) => `<style data-iuf-final-v031="${config.css[index]}">\n${css}\n</style>`)
    .join("\n");
  const embeddedMarker = '<script data-iuf-final-v031="embedded-marker">window.__IUF_FINAL_V031_EMBEDDED__=true;</script>';

  return html
    .replace(/<link\s+rel="stylesheet"\s+href="(?:tokens|app|trading)\.css"\s*\/?>/g, "")
    .replace("</head>", `${embeddedMarker}\n${styleTags}\n${contentShellOverrides(screen)}\n</head>`);
}

async function injectLiveData(screen: ScreenKey, html: string, request: Request) {
  const payload = await buildFinalV031LivePayload(screen as FinalV031Screen, {
    paperPrefill: screen === "paper-trading-room" ? parsePaperPrefillSearchParams(new URL(request.url).searchParams) : null,
    fastPaperShell: screen === "paper-trading-room",
  });
  const script = finalV031HydrationScript(payload);
  return html.replace("</body>", () => `${script}\n</body>`);
}

export async function GET(
  request: Request,
  context: { params: Promise<{ screen: string }> }
) {
  const { screen } = await context.params;
  if (!isScreenKey(screen)) {
    return NextResponse.json(
      { ok: false, error: "UNKNOWN_FINAL_V031_SCREEN" },
      { status: 404, headers: NO_STORE_HEADERS }
    );
  }

  try {
    const html = await injectLiveData(screen, stripVendorChrome(screen, await renderFinalHtml(screen)), request);
    return new NextResponse(html, {
      status: 200,
      headers: {
        ...NO_STORE_HEADERS,
        "Content-Type": "text/html; charset=utf-8"
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "RENDER_FAILED";
    console.error(`[ui-final-v031] render error for screen=${screen}:`, error);
    // Return HTML error page so the iframe renders a visible message instead of blank/JSON
    const safeScreen = screen.replace(/[^a-z0-9-]/g, "");
    const safeMessage = message.replace(/[<>&"]/g, (ch: string) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[ch] ?? ch));
    const errorHtml = `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><title>載入失敗</title><style>body{margin:0;background:#080b10;color:#91a0b5;font:14px/1.6 monospace;display:flex;align-items:center;justify-content:center;min-height:100vh}.box{max-width:480px;padding:32px;border:1px solid rgba(220,228,240,0.12);border-radius:6px;background:rgba(255,255,255,0.03)}.code{font-size:11px;color:#e2b85c;letter-spacing:.06em;margin-bottom:12px}.msg{color:#c6d0de;font-size:15px;font-weight:600;margin-bottom:8px}.detail{font-size:12px;color:#566276}</style></head><body><div class="box"><div class="code">IUF / ${safeScreen.toUpperCase()} / 載入失敗</div><div class="msg">頁面暫時無法載入</div><div class="detail">${safeMessage}<br><br>請重新整理，或稍後再試。</div></div></body></html>`;
    return new NextResponse(errorHtml, {
      status: 500,
      headers: { ...NO_STORE_HEADERS, "Content-Type": "text/html; charset=utf-8" }
    });
  }
}
