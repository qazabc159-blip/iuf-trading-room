"use client";

/**
 * TickerTape — site-wide exchange-style scrolling banner (Epic S5 slice,
 * `reports/epic_trading_desk_20260702/EPIC_TRADING_DESK_EXCHANGE_GRADE.md`).
 *
 * Consumes the SAME existing `GET /api/v1/market-data/overview` endpoint the
 * homepage and `/m` mobile brief already call — zero new backend, one extra
 * request per page load, no per-item quote fan-out.
 *
 * Honesty rules (product-grade UI, no fake numbers):
 *  - freshness badge reuses the site's four-state vocabulary
 *    (`live` / `close` / `delayed` / `empty`, see lib/data-state-copy.ts)
 *  - off-hours / holiday closes show "MM/DD 收盤" using the data's own
 *    timestamp, never "即時"
 *  - missing quotes render "--", never a fabricated number
 *
 * Skipped on `/login`, `/register`, `/forgot-password`, `/reset-password`,
 * `/m` (own minimal chrome, see lib/ticker-tape.ts `shouldRenderTickerTape`).
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";

import { getMarketDataOverview } from "@/lib/api";
import {
  deriveTickerDisplay,
  formatTickerNumber,
  formatTickerPct,
  shouldRenderTickerTape,
  tickerDirection,
  type TickerDisplay,
} from "@/lib/ticker-tape";
import { DataStateBadge } from "./DataStateBadge";
import styles from "./TickerTape.module.css";

const POLL_MS = 60_000;
const PX_PER_SECOND = 55;
const MIN_DURATION_S = 18;

export function TickerTape() {
  const pathname = usePathname();
  const shouldRender = shouldRenderTickerTape(pathname);

  const [display, setDisplay] = useState<TickerDisplay | null>(null);
  const [duration, setDuration] = useState(MIN_DURATION_S);
  const trackRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!shouldRender) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function load() {
      try {
        const response = await getMarketDataOverview({ includeStale: true, topLimit: 15 });
        if (cancelled) return;
        setDisplay(deriveTickerDisplay(response.data));
      } catch {
        if (cancelled) return;
        // Keep last known-good display on transient failure (stale-while-error);
        // only fall back to an honest empty state if we never had data.
        setDisplay((current) =>
          current ?? {
            dataState: "empty",
            reason: "行情資料暫時無法讀取",
            asOf: null,
            index: null,
            stocks: [],
          },
        );
      }
      if (!cancelled && document.visibilityState === "visible") {
        timer = setTimeout(load, POLL_MS);
      }
    }

    function onVisibilityChange() {
      if (document.visibilityState === "visible" && timer === null) void load();
    }

    void load();
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [shouldRender]);

  // Keep marquee speed constant regardless of item count (measure once
  // content is laid out; content is duplicated for the seamless loop so the
  // real single-set width is half the measured scrollWidth).
  useEffect(() => {
    if (!trackRef.current) return;
    const width = trackRef.current.scrollWidth / 2;
    if (width > 0) setDuration(Math.max(MIN_DURATION_S, width / PX_PER_SECOND));
  }, [display]);

  if (!shouldRender) return null;

  // Reserve height immediately (before the first fetch resolves) to avoid CLS.
  if (!display) {
    return <div className={styles.tape} data-state="loading" aria-hidden="true" />;
  }

  const hasContent = Boolean(display.index) || display.stocks.length > 0;

  return (
    <div
      className={styles.tape}
      data-state={display.dataState}
      aria-label="大盤與權值股即時報價跑馬燈"
    >
      <div className={styles.badgeWrap}>
        <DataStateBadge state={display.dataState} asOf={display.asOf} reason={display.reason} compact />
      </div>
      {!hasContent ? (
        <div className={styles.empty}>{display.reason ?? "尚無盤面資料"}</div>
      ) : (
        <div className={styles.track}>
          <div
            ref={trackRef}
            className={styles.trackInner}
            data-testid="ticker-track-inner"
            style={{ animationDuration: `${duration}s` }}
          >
            {renderItems(display)}
          </div>
          <div className={styles.trackInner} style={{ animationDuration: `${duration}s` }} aria-hidden="true">
            {renderItems(display)}
          </div>
        </div>
      )}
    </div>
  );
}

function renderItems(display: TickerDisplay): ReactNode[] {
  const items: ReactNode[] = [];

  if (display.index) {
    const dir = tickerDirection(display.index.changePct);
    items.push(
      <span key="index" className={`${styles.item} ${styles[dir]}`}>
        <b>{display.index.label}</b>
        <span className={styles.num}>{formatTickerNumber(display.index.last)}</span>
        <span className={styles.pct}>{formatTickerPct(display.index.changePct)}</span>
      </span>,
    );
  }

  for (const stock of display.stocks) {
    const dir = tickerDirection(stock.changePct);
    items.push(
      <span key={stock.symbol} className={`${styles.item} ${styles[dir]}`}>
        <b>{stock.symbol}</b>
        <span className={styles.name}>{stock.name}</span>
        <span className={styles.num}>{formatTickerNumber(stock.last, 1)}</span>
        <span className={styles.pct}>{formatTickerPct(stock.changePct)}</span>
      </span>,
    );
  }

  return items;
}
