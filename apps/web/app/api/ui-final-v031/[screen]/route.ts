import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import {
  buildFinalV031LivePayload,
  finalV031HydrationScript,
  type PaperPrefillHandoff,
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

function safeQueryText(value: string | null, maxLength = 80) {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return trimmed.replace(/[<>]/g, "").slice(0, maxLength);
}

function safeTicker(value: string | null) {
  const ticker = value?.trim().toUpperCase();
  if (!ticker || !/^[A-Z0-9._-]{1,16}$/.test(ticker)) return null;
  return ticker;
}

function parsePaperPrefill(request: Request): PaperPrefillHandoff | null {
  const params = new URL(request.url).searchParams;
  const symbol = safeTicker(params.get("ticker") ?? params.get("symbol"));
  const recommendationId = safeQueryText(params.get("from_rec"), 96);
  const entry = safeQueryText(params.get("entry"), 40);
  const stop = safeQueryText(params.get("stop"), 40);
  const target = safeQueryText(params.get("tp"), 40);
  const enabled = params.get("prefill") === "true" || Boolean(symbol || recommendationId || entry || stop || target);

  if (!enabled) return null;

  return {
    enabled: true,
    symbol,
    recommendationId,
    entry,
    stop,
    target,
    source: recommendationId ? "ai_recommendations" : "url",
  };
}

async function injectLiveData(screen: ScreenKey, html: string, request: Request) {
  const payload = await buildFinalV031LivePayload(screen as FinalV031Screen, {
    paperPrefill: screen === "paper-trading-room" ? parsePaperPrefill(request) : null,
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
    return NextResponse.json(
      { ok: false, error: "RENDER_FAILED", detail: message, screen },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}
