"use client";

import { useMemo, useState } from "react";
import type { AnnouncementRow } from "@/lib/company-adapter";

function categoryClass(category: AnnouncementRow["category"]) {
  if (category === "重大訊息") return "badge-red";
  if (category === "法說") return "badge-blue";
  if (category === "ESG") return "badge-green";
  return "badge-yellow";
}

export function AnnouncementsPanel({ rows }: { rows: AnnouncementRow[] }) {
  const [days, setDays] = useState(30);
  const [openId, setOpenId] = useState<string | null>(rows[0]?.id ?? null);
  const visibleRows = useMemo(() => rows.slice(0, days === 7 ? 2 : days === 30 ? 4 : rows.length), [days, rows]);

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <span className="tg panel-code">ANN</span>
          <span className="tg muted"> - </span>
          <span className="tg gold">公告與新聞</span>
          <div className="panel-sub">public filing / OpenAlice summary placeholder</div>
        </div>
        <div className="company-tabs-inline">
          {[7, 30, 90].map((item) => (
            <button className={days === item ? "mini-button" : "outline-button"} key={item} onClick={() => setDays(item)} type="button">{item}D</button>
          ))}
        </div>
      </div>

      <div className="announcement-list">
        {visibleRows.map((row) => {
          const open = openId === row.id;
          return (
            <button className="announcement-row" key={row.id} onClick={() => setOpenId(open ? null : row.id)} type="button">
              <span className="tg soft">{row.date}</span>
              <span className={`badge ${categoryClass(row.category)}`}>{row.category}</span>
              <span className="tc">{row.title}</span>
              <span className="tg muted">{open ? "收合" : "展開"}</span>
              {open && <span className="announcement-body tc">{row.body}</span>}
            </button>
          );
        })}
      </div>
    </section>
  );
}

