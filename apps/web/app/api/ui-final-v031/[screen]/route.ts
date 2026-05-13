import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import {
  buildFinalV031LivePayload,
  finalV031HydrationScript,
  type FinalV031Screen,
} from "@/lib/final-v031-live";

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
  .tbar {
    display: none !important;
  }

  .psafe {
    position: sticky;
    top: 0;
    z-index: 30;
  }

  .troom {
    max-width: none !important;
    margin: 0 !important;
    padding: 14px 16px 36px !important;
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

  return html
    .replace(/<link\s+rel="stylesheet"\s+href="(?:tokens|app|trading)\.css"\s*\/?>/g, "")
    .replace("</head>", `${styleTags}\n${contentShellOverrides(screen)}\n</head>`);
}

async function injectLiveData(screen: ScreenKey, html: string) {
  const payload = await buildFinalV031LivePayload(screen as FinalV031Screen);
  const script = finalV031HydrationScript(payload);
  return html.replace("</body>", () => `${script}\n</body>`);
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ screen: string }> }
) {
  const { screen } = await context.params;
  if (!isScreenKey(screen)) {
    return NextResponse.json(
      { ok: false, error: "UNKNOWN_FINAL_V031_SCREEN" },
      { status: 404, headers: NO_STORE_HEADERS }
    );
  }

  const html = await injectLiveData(screen, stripVendorChrome(screen, await renderFinalHtml(screen)));
  return new NextResponse(html, {
    status: 200,
    headers: {
      ...NO_STORE_HEADERS,
      "Content-Type": "text/html; charset=utf-8"
    }
  });
}
