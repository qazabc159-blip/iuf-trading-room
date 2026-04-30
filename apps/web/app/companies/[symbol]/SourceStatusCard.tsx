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
  if (state === "stale") return "STALE";
  return "ERROR";
}

export function SourceStatusCard({ sources }: { sources: SourceStatus[] }) {
  const [openId, setOpenId] = useState<string | null>(sources[0]?.id ?? null);

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <span className="tg panel-code">SRC-STAT</span>
          <span className="tg muted"> - </span>
          <span className="tg gold">資料源狀態</span>
          <div className="panel-sub">FinMind / KGI / TWSE / cache</div>
        </div>
        <div className="tg soft">{sources.length} sources</div>
      </div>
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
                  last {new Date(source.lastSeen).toLocaleTimeString("zh-TW", { hour12: false })} - queue {source.queueDepth} - {source.detail}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
}

