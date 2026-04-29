"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { PageFrame, Panel } from "@/components/PageFrame";
import type { ContentDraftStatus, ContentDraftType } from "@/lib/radar-uncovered";
import { mockDrafts } from "@/lib/radar-uncovered";

const STATUSES: ContentDraftStatus[] = ["DRAFT", "REVIEW", "REJECTED"];
const TYPES: ContentDraftType[] = ["theme", "signal", "note"];
const STATUS_LABEL: Record<ContentDraftStatus | "ALL", string> = {
  ALL: "全部",
  DRAFT: "草稿",
  REVIEW: "審核中",
  PUBLISHED: "已發布",
  REJECTED: "已駁回",
};
const TYPE_LABEL: Record<ContentDraftType | "ALL", string> = {
  ALL: "全部類型",
  theme: "主題",
  signal: "訊號",
  note: "註記",
};

export default function ContentDraftsAdminPage() {
  const [status, setStatus] = useState<ContentDraftStatus | "ALL">("ALL");
  const [type, setType] = useState<ContentDraftType | "ALL">("ALL");
  const [author, setAuthor] = useState("ALL");
  const authors = useMemo(() => ["ALL", ...Array.from(new Set(mockDrafts.map((draft) => draft.author)))], []);
  const drafts = useMemo(
    () => mockDrafts.filter((draft) =>
      (status === "ALL" || draft.status === status) &&
      (type === "ALL" || draft.type === type) &&
      (author === "ALL" || draft.author === author),
    ),
    [author, status, type],
  );

  const role = "Owner";
  if (!["Owner", "Admin"].includes(role)) {
    return (
      <PageFrame code="ADM-DRF" title="內容草稿" sub="OpenAlice 草稿審核台" exec>
        <div className="terminal-note">權限不足 · 僅限 Owner / Admin</div>
      </PageFrame>
    );
  }

  return (
    <PageFrame code="ADM-DRF" title="內容草稿" sub="OpenAlice 草稿審核台" exec note="[ADM-DRF] 全站內容草稿佇列 · 管理員把關">
      <Panel code="ADM-FLT" title="篩選條件" right={`${drafts.length} 筆符合`}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, padding: "12px 0" }}>
          <select value={status} onChange={(event) => setStatus(event.target.value as ContentDraftStatus | "ALL")} style={selectStyle}>
            {(["ALL", ...STATUSES] as const).map((item) => <option key={item} value={item}>{STATUS_LABEL[item]}</option>)}
          </select>
          <select value={type} onChange={(event) => setType(event.target.value as ContentDraftType | "ALL")} style={selectStyle}>
            {(["ALL", ...TYPES] as const).map((item) => <option key={item} value={item}>{TYPE_LABEL[item]}</option>)}
          </select>
          <select value={author} onChange={(event) => setAuthor(event.target.value)} style={selectStyle}>
            {authors.map((item) => <option key={item} value={item}>{item === "ALL" ? "全部作者" : item}</option>)}
          </select>
        </div>
      </Panel>

      <Panel code="ADM-Q" title="全部草稿" right={`${drafts.length} 筆`}>
        <div className="row table-head" style={{ gridTemplateColumns: "96px 78px 1fr 104px 90px 86px 118px", gap: 12 }}>
          <span>編號</span>
          <span>類型</span>
          <span>標題</span>
          <span>作者</span>
          <span>狀態</span>
          <span>版本</span>
          <span>操作</span>
        </div>
        {drafts.map((draft) => (
          <div className="row" key={draft.id} style={{ gridTemplateColumns: "96px 78px 1fr 104px 90px 86px 118px", gap: 12, minHeight: 54 }}>
            <span className="tg gold">{draft.id}</span>
            <span className="tg session-pill">{TYPE_LABEL[draft.type]}</span>
            <span className="tc">{draft.title}</span>
            <span className="tg soft">{draft.author}</span>
            <span className={`tg ${draft.status === "REJECTED" ? "down" : draft.status === "REVIEW" ? "up" : "muted"}`}>{STATUS_LABEL[draft.status]}</span>
            <span className="tg">v{draft.version}</span>
            <Link className="mini-button" href={`/admin/content-drafts/${draft.id}`}>開啟</Link>
          </div>
        ))}
      </Panel>
    </PageFrame>
  );
}

const selectStyle = {
  minHeight: 32,
  border: "1px solid var(--night-rule-strong)",
  background: "var(--night)",
  color: "var(--night-ink)",
  fontFamily: "var(--mono)",
  fontSize: 12,
  padding: "0 10px",
} satisfies React.CSSProperties;
