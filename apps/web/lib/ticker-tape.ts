/**
 * ticker-tape.ts — pure data-transform helpers for the site-wide ticker tape banner.
 *
 * Consumes the SAME existing endpoint the homepage / `/m` mobile brief already
 * call (`GET /api/v1/market-data/overview` via `getMarketDataOverview()`), so
 * the ticker adds at most one extra HTTP request per page load — no new
 * backend, no per-item quote fan-out (the KGI subscription-cap trap documented
 * in `themes/[short]/member-quote-cap.ts`).
 *
 * No React / DOM imports — testable in isolation with Vitest.
 */

import type { MarketDataOverview } from "./api";
import { isKgiTradingHours } from "./kgi-trading-hours";
import type { DataState } from "./data-state-copy";

export type TickerIndexItem = {
  key: string;
  label: string;
  last: number | null;
  change: number | null;
  changePct: number | null;
};

export type TickerStockItem = {
  symbol: string;
  name: string;
  last: number | null;
  changePct: number | null;
};

export type TickerDisplay = {
  dataState: DataState;
  reason: string | null;
  /** ISO timestamp the displayed index snapshot is dated as-of (close state labeling). */
  asOf: string | null;
  index: TickerIndexItem | null;
  stocks: TickerStockItem[];
};

const MAX_STOCK_ITEMS = 15;

const EMPTY_DISPLAY: TickerDisplay = {
  dataState: "empty",
  reason: "尚無盤面資料",
  asOf: null,
  index: null,
  stocks: [],
};

/**
 * Builds the ticker's display model from a `market-data/overview` envelope.
 *
 * Freshness derivation follows the same pattern as `MarketStateBanner`:
 * the backend's `marketContext.state` tells us whether data exists at all,
 * but "live" vs "closed" for wording purposes is derived from the local
 * Taipei trading-hours clock (`isKgiTradingHours`) — same known limitation
 * as MarketStateBanner: it does not know about ad-hoc holiday closures
 * (e.g. typhoon days), only weekday + time-of-day.
 */
export function deriveTickerDisplay(
  overview: MarketDataOverview | null | undefined,
  now: Date = new Date(),
): TickerDisplay {
  if (!overview || !overview.marketContext) return EMPTY_DISPLAY;

  const { marketContext } = overview;

  const index: TickerIndexItem | null = marketContext.index
    ? {
        key: marketContext.index.symbol ?? "TAIEX",
        label: marketContext.index.name || "加權指數",
        last: marketContext.index.last,
        change: marketContext.index.change,
        changePct: marketContext.index.changePct,
      }
    : null;

  const stocks: TickerStockItem[] = (marketContext.heatmap ?? [])
    .filter((tile) => Boolean(tile.symbol))
    .slice(0, MAX_STOCK_ITEMS)
    .map((tile) => ({
      symbol: tile.symbol,
      name: tile.name || tile.symbol,
      last: tile.last,
      changePct: tile.changePct,
    }));

  const asOf = marketContext.index?.timestamp ?? null;
  const reason = marketContext.index?.reason ?? null;

  if (marketContext.state === "EMPTY") {
    return { dataState: "empty", reason: reason ?? "目前沒有盤面資料", asOf, index, stocks };
  }
  if (marketContext.state === "BLOCKED") {
    return { dataState: "empty", reason: reason ?? "行情來源暫時無法讀取", asOf, index, stocks };
  }
  if (marketContext.state === "STALE") {
    return { dataState: "delayed", reason: reason ?? "資料同步延遲", asOf, index, stocks };
  }

  // Backend reports LIVE (data present) — decide "即時" vs "收盤" from the
  // local trading-hours clock, same convention as MarketStateBanner.
  if (isKgiTradingHours(now)) {
    return { dataState: "live", reason: null, asOf, index, stocks };
  }
  return { dataState: "close", reason: null, asOf, index, stocks };
}

export function formatTickerNumber(value: number | null | undefined, digits = 2): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "--";
  return value.toLocaleString("zh-TW", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function formatTickerPct(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "--";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

export type TickerDirection = "up" | "down" | "flat";

export function tickerDirection(value: number | null | undefined): TickerDirection {
  if (typeof value !== "number" || !Number.isFinite(value) || value === 0) return "flat";
  return value > 0 ? "up" : "down";
}

/**
 * Prefix-skip routes:
 *  - `/login`, `/register`, `/forgot-password`, `/reset-password`, `/m` —
 *    own minimal `.login-route` chrome / unauthenticated (2026-07-17: the
 *    two password-recovery routes were added after 楊董 caught the ticker's
 *    "行情資料暫時無法讀取" empty-state banner leaking onto `/forgot-password`
 *    in prod — they ship the same authv3 console chrome as `/login`/`/register`
 *    but were missing from this list, so the ticker's own pathname gate never
 *    skipped them even though CSS already hides sidebar/header-dock there via
 *    `body:has(.login-route)`).
 *  - `/final-v031` — every nested route under it (`/final-v031/portfolio`,
 *    `/final-v031/portfolio/kline-frame`, `/final-v031/market-intel`,
 *    `/final-v031/ideas`) renders `<FinalOnlyFrame/>` (see below); all are
 *    legitimate distinct wrapper pages, so a prefix match is correct here
 *    (unlike `/portfolio`, which has a real non-wrapper sibling route —
 *    see EXACT_SKIP_ROUTES).
 */
const SKIP_ROUTE_PREFIXES = ["/login", "/register", "/forgot-password", "/reset-password", "/m", "/final-v031"];

/**
 * Exact-match-only skip routes (do NOT prefix-match — each has at least one
 * real sibling/child route that should still show the ticker):
 *  - `/` — homepage already ships its own real-data ticker tape (`.tac-ticker`
 *    in `app/page.tsx`, fed by `buildTapeQuotes()`) predating this slice.
 *    Skip here to avoid two stacked, redundant tickers.
 *  - `/portfolio`, `/market-intel`, `/desk-exact` — render `<FinalOnlyFrame/>`
 *    (the legacy full-bleed iframe wrapper, `components/FinalOnlyFrame.tsx`).
 *    Its `.iuf-final-content-frame` forces `height:100dvh` for every screen
 *    type, and the `paper-trading-room` variant additionally goes
 *    `position:fixed` at a near-max z-index — in both cases the ticker would
 *    render into the DOM but be visually unreachable (covered or pushed
 *    off-screen), while its poll timer kept firing requests for a banner
 *    nobody can see. `/desk-exact` has the same `height:100dvh` frame but was
 *    never added here when it shipped (2026-07-14) — the missing 32px
 *    (`--ticker-tape-height`) pushed the order ticket's bottom rows (risk
 *    preview / submit button) below the fold, forcing a scroll to reach them
 *    (楊董 2026-07-15 report). Pete review, 2026-07-10 (PR #1208 NEEDS_FIX
 *    round) for the original two. Must be EXACT match: `/portfolio/snapshots`
 *    is a real distinct route (redirects to `/admin/portfolio/snapshots`, not
 *    a FinalOnlyFrame consumer) — a prefix match on `/portfolio` would
 *    wrongly swallow it too. Every current FinalOnlyFrame consumer verified
 *    via `grep -rl FinalOnlyFrame apps/web/app`: `/portfolio`, `/market-intel`,
 *    `/desk-exact`, the four `/final-v031/*` routes, and `/home-exact` (a kept
 *    preview route, not primary nav — likely has the same latent bug but is
 *    out of scope for this fix; flagged as a follow-up, not fixed here).
 */
const EXACT_SKIP_ROUTES = ["/", "/portfolio", "/market-intel", "/desk-exact"];

export function shouldRenderTickerTape(pathname: string | null | undefined): boolean {
  if (!pathname) return true;
  if (EXACT_SKIP_ROUTES.includes(pathname)) return false;
  return !SKIP_ROUTE_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}
