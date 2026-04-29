"use client";

import { useMemo, useState } from "react";
import { PageFrame, Panel } from "@/components/PageFrame";
import type { ContentDraftStatus, ContentDraftType } from "@/lib/radar-uncovered";
import { mockDraftAudit, mockDrafts } from "@/lib/radar-uncovered";

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

export function ContentDraftDetailClient({ id }: { id: string }) {
  const draft = useMemo(() => mockDrafts.find((item) => item.id === id), [id]);
  const [status, setStatus] = useState<ContentDraftStatus>(draft?.status ?? "DRAFT");
  const [assignee, setAssignee] = useState("ELVA");
  const [audit, setAudit] = useState(mockDraftAudit);

  if (!draft) {
    return (
      <PageFrame code="ADM-DRF-D" title="內容草稿" sub={id} exec>
        <div className="terminal-note">找不到草稿 · {id}</div>
      </PageFrame>
    );
  }

  function action(next: "APPROVE" | "REJECT" | "REASSIGN") {
    if (next === "APPROVE") setStatus("PUBLISHED");
    if (next === "REJECT") setStatus("REJECTED");
    setAudit((items) => [
      {
        id: `AUD-${Date.now()}`,
        ts: new Date().toLocaleTimeString("zh-TW", { hour12: false }),
        actor: "IUF-01",
        action: next === "APPROVE" ? "批准" : next === "REJECT" ? "駁回" : "改派",
        note: next === "REASSIGN" ? `改派給 ${assignee}` : `狀態改為 ${next === "APPROVE" ? "已發布" : "已駁回"}`,
      },
      ...items,
    ]);
  }

  return (
    <PageFrame
      code="ADM-DRF-D"
      title={draft.title}
      sub={draft.id}
      exec
      note={`[ADM-DRF-D] · 狀態=${STATUS_LABEL[status]} · 作者=${draft.author}`}
    >
      <div className="main-grid">
        <Panel code="DRF-BODY" title="草稿內容">
          <div className="tg gold" style={{ paddingTop: 14 }}>{TYPE_LABEL[draft.type]} · v{draft.version}</div>
          <p className="tc" style={{ color: "var(--night-ink)", lineHeight: 1.9 }}>{draft.body}</p>
        </Panel>

        <Panel code="DRF-META" title="資料資訊">
          {[
            ["作者", draft.author],
            ["建立時間", draft.updatedAt],
            ["更新時間", draft.updatedAt],
            ["版本", `v${draft.version}`],
            ["來源", draft.source],
            ["狀態", STATUS_LABEL[status]],
          ].map(([key, value]) => (
            <div className="row" key={key} style={{ gridTemplateColumns: "96px 1fr", gap: 12, padding: "9px 0" }}>
              <span className="tg gold">{key}</span>
              <span className="tg">{value}</span>
            </div>
          ))}
        </Panel>

        <div>
          <Panel code="DRF-ACT" title="審核動作">
            <div style={{ display: "grid", gap: 10, padding: "14px 0" }}>
              <button className="mini-button" type="button" onClick={() => action("APPROVE")}>批准發布</button>
              <button className="outline-button" type="button" onClick={() => action("REJECT")}>駁回</button>
              <select value={assignee} onChange={(event) => setAssignee(event.target.value)} style={selectStyle}>
                <option>ELVA</option>
                <option>JASON</option>
                <option>IUF-01</option>
              </select>
              <button className="outline-button" type="button" onClick={() => action("REASSIGN")}>改派負責人</button>
            </div>
          </Panel>

          <Panel code="DRF-AUD" title="稽核紀錄" right={`${audit.length} 筆`}>
            {audit.map((entry) => (
              <div className="row telex-row" key={entry.id}>
                <span className="tg soft">{entry.ts}</span>
                <span className="tg gold">{entry.action}</span>
                <span className="tg">{entry.actor} · {entry.note}</span>
              </div>
            ))}
          </Panel>
        </div>
      </div>
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
