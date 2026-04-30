"use client";

// AnnouncementsPanel.tsx — Client Component
// Fetches /api/v1/companies/:id/announcements?days=30
// Renders material disclosures list with collapsible body text.
// Falls back gracefully on 404/500.

import { useEffect, useState } from "react";

interface Announcement {
  id: string;
  date: string;       // 'YYYY-MM-DD'
  title: string;
  category: string;   // e.g. 重大訊息 / 財報 / 股利 / 人事
  body?: string;
}

type AnnouncementsState =
  | { status: "loading" }
  | { status: "not_integrated" }
  | { status: "error"; message: string }
  | { status: "empty" }
  | { status: "ok"; items: Announcement[] };

const API_BASE =
  typeof window !== "undefined"
    ? (process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001")
    : "http://localhost:3001";

async function fetchAnnouncements(companyId: string): Promise<AnnouncementsState> {
  try {
    const res = await fetch(
      `${API_BASE}/api/v1/companies/${companyId}/announcements?days=30`,
      { credentials: "include" }
    );
    if (res.status === 404) return { status: "not_integrated" };
    if (!res.ok) return { status: "error", message: `HTTP ${res.status}` };
    const json = await res.json() as { data: Announcement[] };
    if (!json.data || json.data.length === 0) return { status: "empty" };
    return { status: "ok", items: json.data };
  } catch (e) {
    return { status: "error", message: e instanceof Error ? e.message : "fetch error" };
  }
}

const categoryBadge: Record<string, string> = {
  重大訊息: "badge-yellow",
  財報:     "badge-green",
  股利:     "badge",
  人事:     "badge",
};

function AnnouncementRow({ item }: { item: Announcement }) {
  const [expanded, setExpanded] = useState(false);
  const badgeCls = categoryBadge[item.category] ?? "badge";

  return (
    <div style={{ borderBottom: "1px solid var(--night-rule, #222)" }}>
      <button
        onClick={() => setExpanded((v) => !v)}
        style={{
          display: "grid",
          gridTemplateColumns: "80px auto 1fr 16px",
          gap: 10,
          alignItems: "center",
          width: "100%",
          padding: "8px 0",
          background: "none",
          border: "none",
          color: "inherit",
          textAlign: "left",
          cursor: item.body ? "pointer" : "default",
        }}
      >
        <span className="tg" style={{ fontSize: 11, color: "var(--night-mid, #888)" }}>{item.date}</span>
        <span className={badgeCls} style={{ fontSize: 10, padding: "2px 6px" }}>{item.category}</span>
        <span style={{ fontFamily: "var(--mono, monospace)", fontSize: 12 }}>{item.title}</span>
        {item.body && (
          <span className="dim" style={{ fontSize: 10 }}>{expanded ? "▲" : "▼"}</span>
        )}
      </button>
      {expanded && item.body && (
        <div style={{
          padding: "8px 0 12px",
          fontFamily: "var(--mono, monospace)",
          fontSize: 11,
          lineHeight: 1.7,
          color: "var(--night-ink, #d8d4c8)",
          whiteSpace: "pre-wrap",
        }}>
          {item.body}
        </div>
      )}
    </div>
  );
}

export function AnnouncementsPanel({ companyId }: { companyId: string }) {
  const [state, setState] = useState<AnnouncementsState>({ status: "loading" });

  useEffect(() => {
    fetchAnnouncements(companyId).then(setState);
  }, [companyId]);

  return (
    <section className="panel hud-frame">
      <h3 className="ascii-head">
        <span className="ascii-head-bracket">[05]</span> 公告 / 重大訊息
      </h3>

      {state.status === "loading" && (
        <div className="dim" style={{ padding: "16px 0", fontFamily: "var(--mono)", fontSize: 11 }}>LOADING…</div>
      )}

      {(state.status === "not_integrated" || state.status === "error") && (
        <div style={{ padding: "16px 0" }}>
          <span className="badge-yellow" style={{ fontSize: 11 }}>公告整合中</span>
          <div className="dim" style={{ marginTop: 8, fontFamily: "var(--mono)", fontSize: 11 }}>
            {state.status === "error" ? state.message : "等待 /api/v1/companies/:id/announcements 接通"}
          </div>
        </div>
      )}

      {state.status === "empty" && (
        <div className="dim" style={{ padding: "16px 0", fontFamily: "var(--mono)", fontSize: 11 }}>
          近 30 日無公告紀錄
        </div>
      )}

      {state.status === "ok" && (
        <div style={{ marginTop: 8 }}>
          {state.items.map((item) => (
            <AnnouncementRow key={item.id} item={item} />
          ))}
        </div>
      )}
    </section>
  );
}
