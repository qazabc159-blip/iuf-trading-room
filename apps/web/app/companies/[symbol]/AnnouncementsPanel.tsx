"use client";

import { useEffect, useState } from "react";
import {
  getCompanyAnnouncements,
  type CompanyAnnouncement,
} from "@/lib/api";
import { friendlyDataError } from "@/lib/friendly-error";

const ANN_CSS = `
/* ── _co-ann-* — announcements timeline upgrade ── */
._co-ann-timeline {
  display: grid;
  gap: 0;
  padding: 0 0 8px;
}
._co-ann-row {
  display: grid;
  grid-template-columns: 16px minmax(0, 1fr);
  gap: 0 12px;
  position: relative;
  cursor: pointer;
}
._co-ann-row::before {
  content: '';
  position: absolute;
  left: 6px;
  top: 22px;
  bottom: -4px;
  width: 1px;
  background: rgba(220,228,240,0.09);
}
._co-ann-row:last-child::before { display: none; }

._co-ann-dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  margin-top: 14px;
  border: 2px solid rgba(200,148,63,0.6);
  background: rgba(200,148,63,0.18);
  flex-shrink: 0;
}
._co-ann-dot.--material {
  border-color: rgba(226,184,92,0.9);
  background: rgba(226,184,92,0.22);
  box-shadow: 0 0 7px rgba(226,184,92,0.38);
}
._co-ann-dot.--financial {
  border-color: rgba(78,205,130,0.7);
  background: rgba(78,205,130,0.14);
}

._co-ann-content {
  padding: 10px 0 12px;
  border-bottom: 1px solid rgba(220,228,240,0.07);
  min-width: 0;
}
._co-ann-row:last-child ._co-ann-content { border-bottom: none; }

._co-ann-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 4px;
}
._co-ann-date {
  font-family: var(--mono);
  font-size: 10px;
  color: var(--night-soft, #566276);
}
._co-ann-badge {
  display: inline-flex;
  align-items: center;
  padding: 1px 7px;
  font-family: var(--mono);
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.06em;
}
._co-ann-badge.--material {
  border: 1px solid rgba(226,184,92,0.42);
  background: rgba(226,184,92,0.10);
  color: var(--gold-bright, #e2b85c);
}
._co-ann-badge.--financial {
  border: 1px solid rgba(78,205,130,0.35);
  background: rgba(78,205,130,0.08);
  color: var(--tw-dn-bright, #4adb88);
}
._co-ann-badge.--general {
  border: 1px solid rgba(100,120,160,0.3);
  background: rgba(100,120,160,0.07);
  color: var(--night-mid, #91a0b5);
}
._co-ann-title {
  font-family: var(--sans-tc);
  font-size: 12.5px;
  color: var(--night-ink, #e7ecf3);
  line-height: 1.55;
  margin-bottom: 0;
}
._co-ann-body {
  font-family: var(--sans-tc);
  font-size: 11px;
  color: var(--night-mid, #91a0b5);
  line-height: 1.65;
  margin-top: 7px;
  padding: 8px 10px;
  border-left: 2px solid rgba(226,184,92,0.32);
  background: rgba(226,184,92,0.04);
}
._co-ann-body p {
  margin: 0 0 8px;
}
._co-ann-detail-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  margin: 8px 0 0;
}
._co-ann-detail-grid div {
  min-width: 0;
  padding: 7px 8px;
  border: 1px solid rgba(220,228,240,0.09);
  background: rgba(8,12,18,0.32);
}
._co-ann-detail-grid dt {
  margin: 0 0 4px;
  font-family: var(--mono);
  font-size: 9px;
  color: var(--night-soft, #566276);
}
._co-ann-detail-grid dd {
  margin: 0;
  color: var(--night-ink, #e7ecf3);
  overflow-wrap: anywhere;
}
._co-ann-link {
  display: inline-flex;
  align-items: center;
  margin-top: 9px;
  padding: 6px 10px;
  border: 1px solid rgba(100,170,255,0.42);
  color: #8fc3ff;
  text-decoration: none;
  font-family: var(--mono);
  font-size: 10px;
  font-weight: 800;
}
._co-ann-expand {
  font-family: var(--mono);
  font-size: 9.5px;
  color: var(--night-soft, #566276);
  margin-top: 3px;
}
@media (max-width: 720px) {
  ._co-ann-detail-grid { grid-template-columns: 1fr; }
}
`;

type AnnouncementsState =
  | { status: "loading" }
  | { status: "blocked"; reason: string }
  | { status: "empty"; fetchedAt: string }
  | { status: "live"; items: CompanyAnnouncement[]; fetchedAt: string };

function formatTime(value: string) {
  return new Date(value).toLocaleString("zh-TW", { hour12: false });
}

function annKind(category: string): "material" | "financial" | "general" {
  if (/material|announcement|重大|公告|董事會/i.test(category)) return "material";
  if (/dividend|cash dividend|stock dividend|股利|除權|除息|financial|revenue|eps|earnings|財報|營收|獲利|盈餘/i.test(category)) return "financial";
  return "general";
}

function annKindLabel(category: string): string {
  const kind = annKind(category);
  if (kind === "material") return "重大訊息";
  if (kind === "financial") return "財報/股利";
  return category || "公告";
}

function annSourceLabel(source?: string | null): string {
  const text = String(source || "").toLowerCase();
  if (text.includes("twse_iih")) return "TWSE 公司資訊揭露";
  if (text.includes("tw_announcements") || text.includes("twse_announcements")) return "TWSE 公告快取";
  if (text.includes("finmind")) return "FinMind 新聞";
  return source || "正式公告來源";
}

function AnnouncementRow({ item }: { item: CompanyAnnouncement }) {
  const [expanded, setExpanded] = useState(false);
  const body = item.body?.trim() ?? "";
  const hasDetail = Boolean(body || item.url || item.source);
  const kind = annKind(item.category ?? "");

  return (
    <div className="_co-ann-row" onClick={() => hasDetail && setExpanded(v => !v)}>
      <span className={`_co-ann-dot --${kind}`} />
      <div className="_co-ann-content">
        <div className="_co-ann-meta">
          <span className="_co-ann-date">{item.date || "--"}</span>
          <span className={`_co-ann-badge --${kind}`}>{annKindLabel(item.category ?? "")}</span>
        </div>
        <div className="_co-ann-title">{item.title || "未命名公告"}</div>
        {hasDetail && (
          <div className="_co-ann-expand">{expanded ? "▲ 收合" : "▼ 展開詳情"}</div>
        )}
        {expanded && hasDetail && (
          <div className="_co-ann-body">
            <p>{body || "官方來源未提供完整內文；請開啟正式公告頁查看全文。"}</p>
            <dl className="_co-ann-detail-grid">
              <div>
                <dt>日期</dt>
                <dd>{item.date || "--"}</dd>
              </div>
              <div>
                <dt>來源</dt>
                <dd>{annSourceLabel(item.source)}</dd>
              </div>
              <div>
                <dt>公司</dt>
                <dd>{item.ticker || ""} {item.companyName || ""}</dd>
              </div>
            </dl>
            {item.url ? (
              <a className="_co-ann-link" href={item.url} target="_blank" rel="noreferrer">
                開啟正式公告
              </a>
            ) : null}
          </div>
        )}
      </div>
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
        setState({ status: "blocked", reason: friendlyDataError(error, "重大訊息資料暫時無法讀取。") });
      });
    return () => { active = false; };
  }, [companyId]);

  return (
    <section className="panel hud-frame company-intel-panel company-announcements-console">
      <style>{ANN_CSS}</style>
      <h3 className="ascii-head">
        <span className="ascii-head-bracket">[05]</span> 重大訊息
        <span className="dim" style={{ fontSize: 10, marginLeft: 8 }}>公告時間線</span>
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
          <span className="state-reason">{state.reason}</span>
        </div>
      )}
      {state.status === "empty" && (
        <div className="state-panel">
          <span className="badge badge-yellow">無資料</span>
          <span className="state-reason">近 30 天沒有重大訊息。更新 {formatTime(state.fetchedAt)}。</span>
        </div>
      )}
      {state.status === "live" && (
        <>
          <div className="source-line" style={{ marginBottom: 12 }}>
            <span className="badge badge-green">正常</span>
            <span className="tg soft">臺灣證交所 · {state.items.length} 則 · {formatTime(state.fetchedAt)}</span>
          </div>
          <div className="_co-ann-timeline">
            {state.items.map((item) => <AnnouncementRow key={item.id} item={item} />)}
          </div>
        </>
      )}
    </section>
  );
}
