"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { PageFrame, Panel } from "@/components/PageFrame";
import type { ContentDraftStatus, ContentDraftType } from "@/lib/radar-uncovered";
import { mockDrafts } from "@/lib/radar-uncovered";

const STATUSES: ContentDraftStatus[] = ["DRAFT", "REVIEW", "PUBLISHED"];
const STATUS_LABEL: Record<ContentDraftStatus, string> = {
  DRAFT: "草稿",
  REVIEW: "審核中",
  PUBLISHED: "已發布",
  REJECTED: "已駁回",
};
const TYPE_LABEL: Record<ContentDraftType, string> = {
  theme: "主題",
  signal: "訊號",
  note: "註記",
};

export default function DraftsPage() {
  const [active, setActive] = useState<ContentDraftStatus[]>([]);
  const filtered = useMemo(
    () => active.length ? mockDrafts.filter((draft) => active.includes(draft.status)) : mockDrafts,
    [active],
  );

  function toggle(status: ContentDraftStatus) {
    setActive((items) => {
      const next = items.includes(status) ? items.filter((item) => item !== status) : [...items, status];
      const params = new URLSearchParams();
      if (next.length) params.set("status", next.join(","));
      window.history.replaceState(null, "", params.toString() ? `/drafts?${params}` : "/drafts");
      return next;
    });
  }

  return (
    <PageFrame
      code="DRF"
      title="草稿"
      sub="內容草稿列表"
      note="[DRF] 內容草稿 · 發布前暫存與審核"
    >
      <Panel code="DRF-FLT" title="篩選條件" right={active.length ? active.map((item) => STATUS_LABEL[item]).join(" / ") : "全部"}>
        <div style={{ display: "flex", gap: 10, padding: "12px 0" }}>
          {STATUSES.map((status) => (
            <button
              className={active.includes(status) ? "mini-button" : "outline-button"}
              key={status}
              onClick={() => toggle(status)}
              type="button"
            >
              {STATUS_LABEL[status]}
            </button>
          ))}
        </div>
      </Panel>

      <Panel code="DRF-LIST" title="草稿列表" right={`${filtered.length} 筆`}>
        <div className="row table-head" style={{ gridTemplateColumns: "92px 72px 1fr 104px 94px 132px", gap: 12 }}>
          <span>編號</span>
          <span>類型</span>
          <span>標題</span>
          <span>作者</span>
          <span>狀態</span>
          <span>更新時間</span>
        </div>
        {filtered.map((draft) => (
          <Link
            className="row"
            href={`/admin/content-drafts/${draft.id}`}
            key={draft.id}
            style={{ gridTemplateColumns: "92px 72px 1fr 104px 94px 132px", gap: 12, minHeight: 54, color: "inherit", textDecoration: "none" }}
          >
            <span className="tg gold">{draft.id}</span>
            <span className="tg session-pill">{TYPE_LABEL[draft.type]}</span>
            <span className="tc">{draft.title}</span>
            <span className="tg soft">{draft.author}</span>
            <span className={`tg ${draft.status === "PUBLISHED" ? "gold" : draft.status === "REVIEW" ? "up" : "muted"}`}>{STATUS_LABEL[draft.status]}</span>
            <span className="tg muted">{new Date(draft.updatedAt).toLocaleString("zh-TW", { hour12: false })}</span>
          </Link>
        ))}
      </Panel>
    </PageFrame>
  );
}
