"use client";

import { useState } from "react";
import type { SourceStatus } from "@/lib/company-adapter";

function stateClass(state: SourceStatus["state"]) {
  if (state === "live") return "badge-green";
  if (state === "stale") return "badge-yellow";
  return "badge-red";
}

function stateLabel(state: SourceStatus["state"]) {
  if (state === "live") return "正常";
  if (state === "stale") return "過期";
  return "暫停";
}

function formatTaipeiTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString("zh-TW", {
    hour12: false,
    timeZone: "Asia/Taipei",
  });
}

export function SourceStatusCard({ sources }: { sources: SourceStatus[] }) {
  const [openId, setOpenId] = useState<string | null>(sources[0]?.id ?? null);

  return (
    <section className="panel hud-frame">
      <h3 className="ascii-head">
        <span className="ascii-head-bracket">[07]</span> 資料來源
        <span className="dim" style={{ fontSize: 10, marginLeft: 8 }}>{sources.length} 項</span>
      </h3>
      <div className="source-status-card">
        {sources.map((source) => {
          const open = openId === source.id;
          return (
            <button className="source-status-row" key={source.id} onClick={() => setOpenId(open ? null : source.id)} type="button">
              <span className={`source-led ${source.state}`} aria-hidden />
              <span>
                <b className="tg">{source.label}</b>
                <small className="tg soft">{source.summary}</small>
              </span>
              <span className={`badge ${stateClass(source.state)}`}>{stateLabel(source.state)}</span>
              {open && (
                <span className="source-status-detail tg soft">
                  更新 {formatTaipeiTime(source.lastSeen)} / 佇列 {source.queueDepth} / {source.detail}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
}
