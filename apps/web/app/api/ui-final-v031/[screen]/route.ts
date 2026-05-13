import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

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
    .replace("</head>", `${styleTags}\n</head>`);
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

  const html = await renderFinalHtml(screen);
  return new NextResponse(html, {
    status: 200,
    headers: {
      ...NO_STORE_HEADERS,
      "Content-Type": "text/html; charset=utf-8"
    }
  });
}
