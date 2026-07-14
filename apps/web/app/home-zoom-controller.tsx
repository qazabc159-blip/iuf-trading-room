"use client";

import { useLayoutEffect, useRef } from "react";

/** 原稿設計寬（見 .tac-ledger／heroband 454px／tape 236px 等逐值 px 比例的基準）。 */
const DESIGN_WIDTH = 1280;

/**
 * HomeZoomController — 首頁全寬 zoom 縮放校正器（2026-07-15）。
 *
 * `.tac-ledger` 在桌機（>1000px）固定 1280px 寬，用 CSS `zoom` 依實際可用
 * 寬度等比縮放到填滿 `.home-ledger-shell`（側欄右緣到視窗右緣零留白）。
 * CSS 本身無法算出「父層寬度 / 1280」，這裡用 ResizeObserver 量測
 * `.home-ledger-shell` 的 clientWidth，寫回 `--home-zoom` CSS 變數
 * （`.tac-ledger` 的 `zoom: var(--home-zoom, 1.3)` 會讀到這個值）。
 *
 * SSR 首屏在這支 controller 掛載/量測完成前，走 1.3 的合理預設值，避免
 * 無樣式閃爍；掛載後立刻校正一次，之後視窗 resize 由 ResizeObserver
 * 自動重算（不需手動綁 window resize）。
 */
export function HomeZoomController() {
  const anchorRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const shell = anchorRef.current?.closest<HTMLElement>(".home-ledger-shell");
    if (!shell) return;

    const apply = () => {
      shell.style.setProperty("--home-zoom", String(shell.clientWidth / DESIGN_WIDTH));
    };
    apply();

    const observer = new ResizeObserver(apply);
    observer.observe(shell);
    return () => observer.disconnect();
  }, []);

  return <div ref={anchorRef} aria-hidden="true" style={{ display: "none" }} />;
}
