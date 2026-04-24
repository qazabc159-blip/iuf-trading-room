"use client";

import { useEffect, useMemo, useState } from "react";

import {
  approveContentDraft,
  getContentDrafts,
  getCompanyNotes,
  getThemeSummaries,
  rejectContentDraft,
  type ContentDraftEntry,
  type ContentDraftStatus
} from "@/lib/api";

const statusLabel: Record<ContentDraftStatus, string> = {
  awaiting_review: "待審核",
  approved: "已核准",
  rejected: "已退回"
};

const statusBadge: Record<ContentDraftStatus, string> = {
  awaiting_review: "badge-yellow",
  approved: "badge-green",
  rejected: "badge-red"
};

const targetLabel: Record<string, string> = {
  theme_summaries: "主題摘要",
  company_notes: "公司筆記"
};

function extractDraftText(entry: ContentDraftEntry): string {
  const p = entry.payload;
  if (!p || typeof p !== "object") return JSON.stringify(p ?? null, null, 2);
  const obj = p as Record<string, unknown>;
  if (typeof obj.summary === "string") return obj.summary;
  if (typeof obj.note === "string") return obj.note;
  return JSON.stringify(obj, null, 2);
}

type FormalRow =
  | { kind: "theme_summary"; id: string; text: string; generatedAt: string }
  | { kind: "company_note"; id: string; text: string; generatedAt: string }
  | { kind: "none" };

async function fetchLatestFormal(entry: ContentDraftEntry): Promise<FormalRow> {
  if (!entry.targetEntityId) return { kind: "none" };

  if (entry.targetTable === "theme_summaries") {
    try {
      const res = await getThemeSummaries({ themeId: entry.targetEntityId, limit: 1 });
      const row = res.data[0];
      if (!row) return { kind: "none" };
      return { kind: "theme_summary", id: row.id, text: row.summary, generatedAt: row.generatedAt };
    } catch {
      return { kind: "none" };
    }
  }

  if (entry.targetTable === "company_notes") {
    try {
      const res = await getCompanyNotes({ companyId: entry.targetEntityId, limit: 1 });
      const row = res.data[0];
      if (!row) return { kind: "none" };
      return { kind: "company_note", id: row.id, text: row.note, generatedAt: row.generatedAt };
    } catch {
      return { kind: "none" };
    }
  }

  return { kind: "none" };
}

export function ContentDraftsQueue() {
  const [drafts, setDrafts] = useState<ContentDraftEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<ContentDraftStatus | "">("awaiting_review");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [formalCache, setFormalCache] = useState<Record<string, FormalRow>>({});
  const [rejectReason, setRejectReason] = useState<Record<string, string>>({});
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const loadDrafts = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getContentDrafts(filterStatus ? { status: filterStatus, limit: 100 } : { limit: 100 });
      setDrafts(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "無法載入草稿");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadDrafts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterStatus]);

  const awaiting = useMemo(() => drafts.filter((d) => d.status === "awaiting_review"), [drafts]);

  const toggleExpand = async (entry: ContentDraftEntry) => {
    const next = expanded === entry.id ? null : entry.id;
    setExpanded(next);
    if (next && !formalCache[entry.id]) {
      const formal = await fetchLatestFormal(entry);
      setFormalCache((curr) => ({ ...curr, [entry.id]: formal }));
    }
  };

  const onApprove = async (entry: ContentDraftEntry) => {
    setActionLoading(entry.id);
    setError(null);
    try {
      const res = await approveContentDraft(entry.id);
      setDrafts((curr) => curr.map((d) => (d.id === entry.id ? res.data : d)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "核准失敗");
    } finally {
      setActionLoading(null);
    }
  };

  const onReject = async (entry: ContentDraftEntry) => {
    const reason = (rejectReason[entry.id] ?? "").trim();
    if (!reason) {
      setError(`退回需要填寫原因（草稿 ${entry.id.slice(0, 8)}）`);
      return;
    }
    setActionLoading(entry.id);
    setError(null);
    try {
      const res = await rejectContentDraft(entry.id, reason);
      setDrafts((curr) => curr.map((d) => (d.id === entry.id ? res.data : d)));
      setRejectReason((curr) => {
        const next = { ...curr };
        delete next[entry.id];
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "退回失敗");
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <section style={{ display: "grid", gap: 14 }}>
      <div className="panel filter-bar">
        <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value as ContentDraftStatus | "")}>
          <option value="awaiting_review">待審核</option>
          <option value="approved">已核准</option>
          <option value="rejected">已退回</option>
          <option value="">全部</option>
        </select>
        <div className="metric-chip" style={{ padding: "5px 10px", minWidth: "auto" }}>
          <span style={{ fontSize: "var(--fs-base)" }}>{awaiting.length}</span>
          <small>待審核</small>
        </div>
        <div className="metric-chip" style={{ padding: "5px 10px", minWidth: "auto" }}>
          <span style={{ fontSize: "var(--fs-base)" }}>{drafts.length}</span>
          <small>顯示中</small>
        </div>
        <button className="btn-sm" style={{ marginLeft: "auto" }} onClick={() => void loadDrafts()}>
          重新整理
        </button>
      </div>

      {error ? (
        <div className="panel" style={{ padding: "10px 16px" }}>
          <p className="error-text" style={{ margin: 0 }}>{error}</p>
        </div>
      ) : null}

      {loading ? (
        <div className="panel" style={{ padding: 16 }}>
          <p className="muted loading-text">載入草稿...</p>
        </div>
      ) : drafts.length === 0 ? (
        <div className="panel" style={{ padding: 16 }}>
          <p className="muted">
            {filterStatus === "awaiting_review"
              ? "目前沒有待審核的草稿。OpenAlice runner 提交 draft_ready 後會出現在這。"
              : "此狀態下沒有草稿。"}
          </p>
        </div>
      ) : (
        <div className="panel">
          <div className="card-stack">
            {drafts.map((entry) => {
              const isExpanded = expanded === entry.id;
              const isAwaiting = entry.status === "awaiting_review";
              const draftText = extractDraftText(entry);
              const formal = formalCache[entry.id];
              const rejectText = rejectReason[entry.id] ?? "";

              return (
                <article
                  key={entry.id}
                  className="record-card"
                  style={{ borderLeft: isAwaiting ? "3px solid var(--warn)" : undefined }}
                >
                  <div
                    className="record-topline"
                    style={{ cursor: "pointer" }}
                    onClick={() => void toggleExpand(entry)}
                  >
                    <div>
                      <strong style={{ fontSize: "var(--fs-base)" }}>
                        {targetLabel[entry.targetTable] ?? entry.targetTable}
                      </strong>
                      <span className="dim" style={{ fontSize: "var(--fs-xs)", marginLeft: 8 }}>
                        {entry.id.slice(0, 8)}
                      </span>
                      {entry.targetEntityId ? (
                        <span className="dim mono" style={{ fontSize: "var(--fs-xs)", marginLeft: 6 }}>
                          · {entry.targetEntityId.slice(0, 8)}
                        </span>
                      ) : null}
                    </div>
                    <span className={statusBadge[entry.status] ?? "badge"}>
                      {statusLabel[entry.status] ?? entry.status}
                    </span>
                  </div>

                  <p className="record-meta">
                    建立：{new Date(entry.createdAt).toLocaleString("zh-TW")}
                    {entry.reviewedAt ? ` / 審核：${new Date(entry.reviewedAt).toLocaleString("zh-TW")}` : null}
                    {entry.sourceJobId ? ` / 來源 job：${entry.sourceJobId.slice(0, 8)}` : null}
                    {` / 版本：${entry.producerVersion}`}
                  </p>

                  {!isExpanded ? (
                    <p
                      className="dim"
                      style={{ fontSize: "var(--fs-sm)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "100%" }}
                    >
                      {draftText.replace(/\s+/g, " ").slice(0, 120)}
                      {draftText.length > 120 ? "..." : ""}
                    </p>
                  ) : null}

                  {isExpanded ? (
                    <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
                      <div className="record-card" style={{ background: "var(--panel-hi)" }}>
                        <strong style={{ fontSize: "var(--fs-sm)", color: "var(--muted)" }}>草稿內容</strong>
                        <pre
                          style={{
                            whiteSpace: "pre-wrap",
                            fontSize: "var(--fs-sm)",
                            marginTop: 4,
                            maxHeight: 320,
                            overflow: "auto",
                            background: "var(--bg)",
                            padding: 10,
                            borderRadius: 8
                          }}
                        >
                          {draftText}
                        </pre>
                      </div>

                      <div className="record-card" style={{ background: "var(--panel-hi)" }}>
                        <strong style={{ fontSize: "var(--fs-sm)", color: "var(--muted)" }}>目前正式資料（最新一筆）</strong>
                        {!formal ? (
                          <p className="muted" style={{ fontSize: "var(--fs-sm)", marginTop: 4 }}>載入中…</p>
                        ) : formal.kind === "none" ? (
                          <p className="dim" style={{ fontSize: "var(--fs-sm)", marginTop: 4 }}>
                            尚無正式資料列（核准後將為此 entity 寫入第一筆）
                          </p>
                        ) : (
                          <>
                            <p className="dim mono" style={{ fontSize: "var(--fs-xs)", marginTop: 4 }}>
                              id {formal.id.slice(0, 8)} · 產生於 {new Date(formal.generatedAt).toLocaleString("zh-TW")}
                            </p>
                            <pre
                              style={{
                                whiteSpace: "pre-wrap",
                                fontSize: "var(--fs-sm)",
                                marginTop: 4,
                                maxHeight: 220,
                                overflow: "auto",
                                background: "var(--bg)",
                                padding: 10,
                                borderRadius: 8
                              }}
                            >
                              {formal.text}
                            </pre>
                          </>
                        )}
                      </div>

                      <details>
                        <summary className="dim" style={{ cursor: "pointer", fontSize: "var(--fs-xs)" }}>
                          raw payload JSON
                        </summary>
                        <pre
                          style={{
                            whiteSpace: "pre-wrap",
                            fontSize: "var(--fs-xs)",
                            marginTop: 4,
                            maxHeight: 220,
                            overflow: "auto",
                            background: "var(--bg)",
                            padding: 10,
                            borderRadius: 8
                          }}
                        >
                          {JSON.stringify(entry.payload, null, 2)}
                        </pre>
                      </details>

                      {entry.rejectReason ? (
                        <p className="error-text" style={{ fontSize: "var(--fs-sm)" }}>
                          退回原因：{entry.rejectReason}
                        </p>
                      ) : null}
                    </div>
                  ) : null}

                  {isAwaiting ? (
                    <div style={{ marginTop: 8 }}>
                      <textarea
                        value={rejectText}
                        onChange={(e) =>
                          setRejectReason((prev) => ({ ...prev, [entry.id]: e.target.value }))
                        }
                        placeholder="退回時需填寫原因（核准不需）"
                        style={{
                          width: "100%",
                          minHeight: 48,
                          fontSize: "var(--fs-sm)",
                          marginBottom: 6,
                          resize: "vertical"
                        }}
                      />
                      <div className="action-row">
                        <button
                          className="btn-sm"
                          style={{ background: "var(--accent)", color: "var(--bg)", borderColor: "var(--accent)" }}
                          disabled={actionLoading === entry.id}
                          onClick={() => void onApprove(entry)}
                        >
                          {actionLoading === entry.id ? "..." : "核准並發布"}
                        </button>
                        <button
                          className="btn-sm"
                          style={{ borderColor: "rgba(255,93,93,0.3)", color: "var(--bear)" }}
                          disabled={actionLoading === entry.id}
                          onClick={() => void onReject(entry)}
                        >
                          {actionLoading === entry.id ? "..." : "退回"}
                        </button>
                        {!isExpanded ? (
                          <button className="btn-sm" onClick={() => void toggleExpand(entry)}>
                            檢視詳情
                          </button>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
