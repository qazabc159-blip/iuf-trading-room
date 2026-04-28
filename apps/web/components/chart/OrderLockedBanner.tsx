"use client";
/**
 * OrderLockedBanner — [LOCKED] 下單功能未啟用 · Read-only 模式
 * Ported from sandbox v0.7.0-w3
 * W5b visual overhaul: v2 locked-banner-v2 CSS classes, clearer visual treatment
 * Wording locked: DO NOT change without Elva + 楊董 approval
 */

export function OrderLockedBanner() {
  return (
    <div
      data-testid="order-locked-banner"
      className="locked-banner-v2"
    >
      <span className="lock-tag">[LOCKED]</span>
      <span className="lock-msg">
        下單功能未啟用 · Read-only 模式
      </span>
    </div>
  );
}
