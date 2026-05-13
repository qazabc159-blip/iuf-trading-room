import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const REVALIDATE_KEY = "v031-20260513";
const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, max-age=0, must-revalidate",
  "CDN-Cache-Control": "no-store",
  "Vercel-CDN-Cache-Control": "no-store"
};

const PATHS = [
  "/market-intel",
  "/ideas",
  "/portfolio",
  "/final-v031/market-intel",
  "/final-v031/ideas",
  "/final-v031/portfolio",
  "/ui-final-v031/market_intel/index.html",
  "/ui-final-v031/strategy_ideas/index.html",
  "/ui-final-v031/paper_trading_room/index.html"
];

export async function POST(request: Request) {
  const url = new URL(request.url);
  if (url.searchParams.get("key") !== REVALIDATE_KEY) {
    return NextResponse.json(
      { ok: false, error: "BAD_REVALIDATE_KEY" },
      { status: 403, headers: NO_STORE_HEADERS }
    );
  }

  for (const targetPath of PATHS) {
    revalidatePath(targetPath);
  }

  return NextResponse.json(
    { ok: true, paths: PATHS, revalidatedAt: new Date().toISOString() },
    { headers: NO_STORE_HEADERS }
  );
}
