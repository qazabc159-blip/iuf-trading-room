"use client";

import { useMemo, useState } from "react";
import { PageFrame, Panel } from "@/components/PageFrame";
import type { ReviewAction, ReviewItem, ReviewLogItem } from "@/lib/radar-uncovered";
import { mockReviewLog, mockReviewQueue } from "@/lib/radar-uncovered";

const TYPE_LABEL: Record<ReviewItem["type"], string> = {
  signal: "訊號",
  theme: "主題",
  note: "註記",
};

const ACTION_LABEL: Record<ReviewAction, string> = {
  ACCEPT: "接受",
  REJECT: "駁回",
};

export default function ReviewsPage() {
  const [queue, setQueue] = useState<ReviewItem[]>(mockReviewQueue);
  const [log, setLog] = useState<ReviewLogItem[]>(mockReviewLog);
  const [selectedId, setSelectedId] = useState(queue[0]?.id ?? "");
  const selected = useMemo(
    () => queue.find((item) => item.id === selectedId) ?? queue[0] ?? null,
    [queue, selectedId],
  );

  function act(action: ReviewAction) {
    if (!selected) return;
    const itemId = selected.id;
    setQueue((items) => items.filter((item) => item.id !== itemId));
    setLog((items) => [
      {
        id: `ACT-${Date.now()}`,
        ts: new Date().toLocaleTimeString("zh-TW", { hour12: false }),
        reviewer: "IUF-01",
        action,
        itemId,
      },
      ...items,
    ]);
    setSelectedId((current) => {
      const next = queue.find((item) => item.id !== itemId);
      return current === itemId ? next?.id ?? "" : current;
    });
  }

  return (
    <PageFrame
      code="REV"
      title="文章審核"
      sub="OpenAlice 佇列"
      note="[REV] OpenAlice 審核佇列 · 接受 / 駁回 · 操作員把關"
    >
      <div className="main-grid">
        <Panel code="REV-Q" title="待審佇列" right={`${queue.length} 筆待審`}>
          <div className="row table-head" style={{ gridTemplateColumns: "82px 68px 1fr 82px 72px", gap: 10 }}>
            <span>編號</span>
            <span>類型</span>
            <span>標題</span>
            <span>作者</span>
            <span>時間</span>
          </div>
          {queue.map((item) => (
            <button
              className="row"
              key={item.id}
              onClick={() => setSelectedId(item.id)}
              style={{
                gridTemplateColumns: "82px 68px 1fr 82px 72px",
                gap: 10,
                minHeight: 58,
                padding: "8px 0",
                textAlign: "left",
                background: item.id === selected?.id ? "var(--night-1)" : "transparent",
                borderLeft: item.id === selected?.id ? "2px solid var(--gold)" : "2px solid transparent",
                borderTop: 0,
                borderRight: 0,
                cursor: "pointer",
                color: "var(--night-ink)",
              }}
            >
              <span className="tg gold">{item.id}</span>
              <span className="tg session-pill">{TYPE_LABEL[item.type]}</span>
              <span className="tc">{item.title}</span>
              <span className="tg soft">{item.author}</span>
              <span className="tg muted">{item.createdAgo}</span>
            </button>
          ))}
        </Panel>

        <Panel code="REV-D" title="文章詳情" right={selected ? "審閱中" : "未選取"}>
          {!selected ? (
            <div className="terminal-note">選擇左側項目以審閱</div>
          ) : (
            <div style={{ padding: "16px 0 4px" }}>
              <div className="tg gold">{selected.id} · {TYPE_LABEL[selected.type]}</div>
              <h2 style={{ margin: "8px 0 12px", color: "var(--night-ink)", fontSize: 28 }}>{selected.title}</h2>
              <p className="tc" style={{ color: "var(--night-ink)", lineHeight: 1.8 }}>{selected.body}</p>
              <div style={{ display: "grid", gap: 8, marginTop: 18 }}>
                {selected.metadata.map((meta) => (
                  <div className="row" key={meta.label} style={{ gridTemplateColumns: "94px 1fr", gap: 12, padding: "7px 0" }}>
                    <span className="tg muted">{meta.label}</span>
                    <span className="tg">{meta.value}</span>
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
                <button className="mini-button" type="button" onClick={() => act("ACCEPT")}>接受</button>
                <button className="outline-button" type="button" onClick={() => act("REJECT")}>駁回</button>
              </div>
            </div>
          )}
        </Panel>

        <Panel code="REV-LOG" title="近 24 小時審核紀錄" right={`${log.length} 筆紀錄`}>
          {log.map((entry) => (
            <div className="row telex-row" key={entry.id}>
              <span className="tg soft">{entry.ts}</span>
              <span className={`tg ${entry.action === "ACCEPT" ? "up" : "down"}`}>{ACTION_LABEL[entry.action]}</span>
              <span className="tg">{entry.reviewer} · {entry.itemId}</span>
            </div>
          ))}
        </Panel>
      </div>
    </PageFrame>
  );
}
