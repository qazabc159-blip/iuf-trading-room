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
  if (/股利|配息|配股/.test(category)) return "badge-yellow";
  if (/財報|營收|EPS|損益|資產/.test(category)) return "badge-green";
  if (/人事|董事|監察|總經理|董事長/.test(category)) return "badge-blue";
  return "badge";
}

function AnnouncementRow({ item }: { item: CompanyAnnouncement }) {
  const [expanded, setExpanded] = useState(false);
  const hasBody = Boolean(item.body?.trim());
  const rowContent = (
    <>
      <span className="tg soft">{item.date || "--"}</span>
      <span className={`badge ${badgeClass(item.category)}`}>{item.category || "NEWS"}</span>
      <span className="market-intel-title">{item.title || "Untitled announcement"}</span>
      <span className="tg soft">{hasBody ? (expanded ? "LESS" : "MORE") : "TWSE"}</span>
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
          reason: error instanceof Error ? error.message : "announcements request failed",
        });
      });

    return () => {
      active = false;
    };
  }, [companyId]);

  return (
    <section className="panel hud-frame">
      <h3 className="ascii-head">
        <span className="ascii-head-bracket">[05]</span> MARKET INTEL
        <span className="dim" style={{ fontSize: 10, marginLeft: 8 }}>
          TWSE material announcements
        </span>
      </h3>

      {state.status === "loading" && (
        <div className="state-panel">
          <span className="badge badge-blue">LOADING</span>
          <span className="tg soft">Fetching TWSE OpenAPI announcements.</span>
        </div>
      )}

      {state.status === "blocked" && (
        <div className="state-panel">
          <span className="badge badge-red">BLOCKED</span>
          <span className="tg soft">Owner: Jason/Elva. Source: TWSE OpenAPI t187ap46_L.</span>
          <span className="state-reason">{state.reason}</span>
        </div>
      )}

      {state.status === "empty" && (
        <div className="state-panel">
          <span className="badge badge-yellow">EMPTY</span>
          <span className="tg soft">Source: TWSE OpenAPI t187ap46_L.</span>
          <span className="state-reason">
            No material announcements returned for the last 30 days. Updated {formatTime(state.fetchedAt)}.
          </span>
        </div>
      )}

      {state.status === "live" && (
        <div className="market-intel-list">
          <div className="source-line">
            <span className="badge badge-green">LIVE</span>
            <span className="tg soft">Source: TWSE OpenAPI t187ap46_L</span>
            <span className="tg soft">Updated {formatTime(state.fetchedAt)}</span>
          </div>
          {state.items.map((item) => (
            <AnnouncementRow key={item.id} item={item} />
          ))}
        </div>
      )}
    </section>
  );
}
