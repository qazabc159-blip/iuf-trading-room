"use client";

import { useState } from "react";
import type { SourceStatus } from "@/lib/company-adapter";

function stateClass(state: SourceStatus["state"]) {
  if (state === "live") return "badge-green";
  if (state === "stale") return "badge-yellow";
  return "badge-red";
}

function stateLabel(state: SourceStatus["state"]) {
  if (state === "live") return "LIVE";
  if (state === "stale") return "EMPTY / STALE";
  return "暫停";
}

function formatTaipeiTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const taipei = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  const month = String(taipei.getUTCMonth() + 1).padStart(2, "0");
  const day = String(taipei.getUTCDate()).padStart(2, "0");
  const hour = String(taipei.getUTCHours()).padStart(2, "0");
  const minute = String(taipei.getUTCMinutes()).padStart(2, "0");
  return `${month}/${day} ${hour}:${minute}`;
}

export function SourceStatusCard({ sources }: { sources: SourceStatus[] }) {
  const [openId, setOpenId] = useState<string | null>(sources[0]?.id ?? null);

  return (
    <section className="panel hud-frame source-status-panel">
      <h3 className="ascii-head">
        <span className="ascii-head-bracket">資料源</span> 狀態總覽
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
                  更新 {formatTaipeiTime(source.lastSeen)}：{source.detail}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
}
