"use client";
/**
 * PositionContainmentBadge — 持倉資料目前不可用（containment 模式）
 * Ported from sandbox v0.7.0-w3
 * W5b visual overhaul: v2 containment-badge-v2 classes, dot indicator
 * Wording locked: DO NOT change without Elva + 楊董 approval
 */

export function PositionContainmentBadge() {
  return (
    <div
      data-testid="position-containment-badge"
      className="containment-badge-v2"
    >
      <span className="cont-icon" />
      <span className="cont-text">
        持倉資料目前不可用（containment 模式）
      </span>
      <span className="cont-sub">
        請至 KGI 平台查詢
      </span>
    </div>
  );
}
