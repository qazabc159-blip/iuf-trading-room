"use client";

// AI 每日簡報「展開全文」toggle（2026-07-14 楊董密度標準：預設節錄 1-2 句，
// 真截斷非 CSS clamp，見 page.tsx 的 firstSentences()）。內容/翻譯/遮蔽全部由
// server 端 page.tsx 算好傳入，這裡只負責 preview/full 兩態切換，不重算任何
// 業務邏輯。

import { useState } from "react";

export type BriefSegmentView = {
  heading: string;
  preview: string;
  full: string;
};

export function HomeBriefColumn({
  pillLabel,
  dateLabel,
  segments,
  emptyReason,
}: {
  pillLabel: string;
  dateLabel: string;
  segments: BriefSegmentView[];
  emptyReason: string | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasMore = segments.some((seg) => seg.full !== seg.preview);

  return (
    <>
      <div className="brief-meta">
        <span className="pill">{pillLabel}</span>
        <span className="dt">{dateLabel}</span>
        {segments.length > 0 && hasMore && (
          <button type="button" className="brief-toggle-btn" onClick={() => setExpanded((value) => !value)}>
            {expanded ? "收合 ▴" : "展開全文 ▸"}
          </button>
        )}
      </div>
      {segments.length > 0 ? (
        segments.map((seg, index) => (
          <div className="seg" key={`${seg.heading}:${index}`}>
            <div className="sh">{seg.heading}</div>
            <div className="sx">{expanded ? seg.full : seg.preview}</div>
          </div>
        ))
      ) : (
        <div className="tac-empty-line">{emptyReason ?? "今天尚未產生每日簡報。"}</div>
      )}
    </>
  );
}
