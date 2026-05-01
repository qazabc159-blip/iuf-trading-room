"use client";

import { useEffect, useState } from "react";

import {
  getCompanyAnnouncements,
  type CompanyAnnouncement,
} from "@/lib/api";

type AnnouncementsState =
  | { status: "loading" }
  | { status: "blocked"; reason: string }
  | { status: "empty"; fetchedAt: string }
  | { status: "live"; items: CompanyAnnouncement[]; fetchedAt: string };

function formatTime(value: string) {
  return new Date(value).toLocaleString("zh-TW", { hour12: false });
}

function badgeClass(category: string) {
  if (/dividend|cash dividend|stock dividend|股利|除權|除息/i.test(category)) return "badge-yellow";
  if (/financial|revenue|eps|earnings|財報|營收|獲利|盈餘/i.test(category)) return "badge-green";
  if (/material|announcement|重大|公告|董事會/i.test(category)) return "badge-blue";
  return "badge";
}

function AnnouncementRow({ item }: { item: CompanyAnnouncement }) {
  const [expanded, setExpanded] = useState(false);
  const hasBody = Boolean(item.body?.trim());
  const rowContent = (
    <>
      <span className="tg soft">{item.date || "--"}</span>
      <span className={`badge ${badgeClass(item.category)}`}>{item.category || "重大訊息"}</span>
      <span className="market-intel-title">{item.title || "未命名公告"}</span>
      <span className="tg soft">{hasBody ? (expanded ? "收合" : "詳情") : "公告"}</span>
    </>
  );

  return (
    <div className="market-intel-row">
      {hasBody ? (
        <button
          type="button"
          className="market-intel-button"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
        >
          {rowContent}
        </button>
      ) : (
        <div className="market-intel-button market-intel-static">
          {rowContent}
        </div>
      )}
      {expanded && hasBody && (
        <div className="market-intel-body">
          {item.body}
        </div>
      )}
    </div>
  );
}

export function AnnouncementsPanel({ companyId }: { companyId: string }) {
  const [state, setState] = useState<AnnouncementsState>({ status: "loading" });

  useEffect(() => {
    let active = true;

    getCompanyAnnouncements(companyId, { days: 30 })
      .then((response) => {
        if (!active) return;
        const fetchedAt = new Date().toISOString();
        const items = response.data ?? [];
        setState(items.length > 0
          ? { status: "live", items, fetchedAt }
          : { status: "empty", fetchedAt });
      })
      .catch((error) => {
        if (!active) return;
        setState({
          status: "blocked",
          reason: error instanceof Error ? error.message : "重大訊息讀取失敗",
        });
      });

    return () => {
      active = false;
    };
  }, [companyId]);

  return (
    <section className="panel hud-frame">
      <h3 className="ascii-head">
        <span className="ascii-head-bracket">[05]</span> 重大訊息
        <span className="dim" style={{ fontSize: 10, marginLeft: 8 }}>
          臺股公告 / 新聞線索
        </span>
      </h3>

      {state.status === "loading" && (
        <div className="state-panel">
          <span className="badge badge-blue">讀取中</span>
          <span className="tg soft">正在讀取臺灣證交所重大訊息。</span>
        </div>
      )}

      {state.status === "blocked" && (
        <div className="state-panel">
          <span className="badge badge-red">暫停</span>
          <span className="tg soft">重大訊息資料暫時無法讀取。</span>
          <span className="state-reason">{state.reason}</span>
        </div>
      )}

      {state.status === "empty" && (
        <div className="state-panel">
          <span className="badge badge-yellow">無資料</span>
          <span className="tg soft">臺灣證交所重大訊息。</span>
          <span className="state-reason">
            近 30 天沒有重大訊息。更新 {formatTime(state.fetchedAt)}。
          </span>
        </div>
      )}

      {state.status === "live" && (
        <div className="market-intel-list">
          <div className="source-line">
            <span className="badge badge-green">正常</span>
            <span className="tg soft">臺灣證交所重大訊息</span>
            <span className="tg soft">更新 {formatTime(state.fetchedAt)}</span>
          </div>
          {state.items.map((item) => (
            <AnnouncementRow key={item.id} item={item} />
          ))}
        </div>
      )}
    </section>
  );
}
