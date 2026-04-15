"use client";

import { useEffect, useState } from "react";

import {
  getOpenAliceJobs,
  type OpenAliceJobEntry,
  reviewOpenAliceJob
} from "@/lib/api";

const allStatuses = [
  "queued",
  "running",
  "draft_ready",
  "validation_failed",
  "failed",
  "published",
  "rejected"
] as const;

const reviewableStatuses = new Set(["draft_ready", "validation_failed"]);

const statusColor: Record<string, string> = {
  queued: "badge",
  running: "badge-blue",
  draft_ready: "badge-yellow",
  validation_failed: "badge-red",
  failed: "badge-red",
  published: "badge-green",
  rejected: "badge-red"
};

const statusLabel: Record<string, string> = {
  queued: "等待中",
  running: "執行中",
  draft_ready: "待審核",
  validation_failed: "驗證失敗",
  failed: "失敗",
  published: "已發布",
  rejected: "已退回"
};

const taskTypeLabel: Record<string, string> = {
  daily_brief: "每日簡報",
  theme_summary: "主題摘要",
  company_note: "公司筆記",
  signal_cluster: "訊號群組",
  trade_plan_draft: "交易計畫草稿",
  review_summary: "檢討摘要"
};

export function DraftReviewQueue() {
  const [jobs, setJobs] = useState<OpenAliceJobEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});

  const loadJobs = async () => {
    try {
      const response = await getOpenAliceJobs();
      setJobs(response.data);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "無法載入工作列表");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadJobs();
  }, []);

  const filtered = filterStatus ? jobs.filter((j) => j.status === filterStatus) : jobs;
  const reviewable = jobs.filter((j) => reviewableStatuses.has(j.status));

  const handleReview = async (jobId: string, status: "published" | "rejected") => {
    setActionLoading(jobId);
    setError(null);
    try {
      const note = reviewNotes[jobId]?.trim() || undefined;
      await reviewOpenAliceJob(jobId, status, note);
      setJobs((current) =>
        current.map((j) => (j.id === jobId ? { ...j, status } : j))
      );
      setReviewNotes((current) => {
        const next = { ...current };
        delete next[jobId];
        return next;
      });
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : String(actionError));
    } finally {
      setActionLoading(null);
    }
  };

  const toggleExpand = (id: string) => {
    setExpanded((current) => (current === id ? null : id));
  };

  return (
    <section style={{ display: "grid", gap: 14 }}>
      {/* 摘要列 */}
      <div className="panel" style={{ padding: "10px 16px" }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
            <option value="">全部狀態（{jobs.length}）</option>
            {allStatuses.map((s) => {
              const count = jobs.filter((j) => j.status === s).length;
              return (
                <option key={s} value={s}>
                  {statusLabel[s] ?? s}（{count}）
                </option>
              );
            })}
          </select>

          <div className="metric-chip" style={{ padding: "5px 10px", minWidth: "auto" }}>
            <span style={{ fontSize: "0.9rem" }}>{reviewable.length}</span>
            <small style={{ fontSize: "0.62rem" }}>待審核</small>
          </div>

          <div className="metric-chip" style={{ padding: "5px 10px", minWidth: "auto" }}>
            <span style={{ fontSize: "0.9rem" }}>{filtered.length}</span>
            <small style={{ fontSize: "0.62rem" }}>顯示中</small>
          </div>

          <button
            className="hero-link"
            style={{ padding: "5px 12px", fontSize: "0.75rem", marginLeft: "auto" }}
            onClick={() => { setLoading(true); void loadJobs(); }}
          >
            重新整理
          </button>
        </div>
      </div>

      {error ? (
        <div className="panel" style={{ padding: "10px 16px" }}>
          <p className="error-text" style={{ margin: 0 }}>{error}</p>
        </div>
      ) : null}

      {loading ? (
        <div className="panel" style={{ padding: 16 }}>
          <p className="muted">載入代理工作...</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="panel" style={{ padding: 16 }}>
          <p className="muted">
            {jobs.length === 0
              ? "尚無 OpenAlice 工作。透過 API 提交工作或等待 Worker 產出。"
              : "目前篩選條件下沒有符合的工作。"}
          </p>
        </div>
      ) : (
        <div className="panel">
          <div className="card-stack">
            {filtered.map((job) => {
              const isExpanded = expanded === job.id;
              const isReviewable = reviewableStatuses.has(job.status);
              const note = reviewNotes[job.id] ?? "";

              return (
                <article
                  key={job.id}
                  className="record-card"
                  style={{ borderLeft: isReviewable ? "3px solid var(--warn)" : undefined }}
                >
                  <div
                    className="record-topline"
                    style={{ cursor: "pointer" }}
                    onClick={() => toggleExpand(job.id)}
                  >
                    <div>
                      <strong style={{ fontSize: "0.82rem" }}>{taskTypeLabel[job.taskType] ?? job.taskType}</strong>
                      <span className="dim" style={{ fontSize: "0.7rem", marginLeft: 8 }}>
                        {job.id.slice(0, 8)}
                      </span>
                    </div>
                    <span className={statusColor[job.status] ?? "badge"}>
                      {statusLabel[job.status] ?? job.status}
                    </span>
                  </div>

                  <p className="record-meta">
                    建立：{new Date(job.createdAt).toLocaleString("zh-TW")}
                    {job.completedAt ? ` / 完成：${new Date(job.completedAt).toLocaleString("zh-TW")}` : null}
                    {job.deviceId ? ` / 裝置：${job.deviceId}` : null}
                    {job.attemptCount != null ? ` / 嘗試：${job.attemptCount}/${job.maxAttempts ?? "?"}` : null}
                  </p>

                  {!isExpanded ? (
                    <p className="dim" style={{ fontSize: "0.75rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "100%" }}>
                      {job.instructions.slice(0, 120)}{job.instructions.length > 120 ? "..." : ""}
                    </p>
                  ) : null}

                  {job.error ? (
                    <p className="error-text" style={{ fontSize: "0.78rem" }}>錯誤：{job.error}</p>
                  ) : null}

                  {isExpanded ? (
                    <div style={{ marginTop: 10 }}>
                      <div className="record-card" style={{ background: "var(--panel-hi)" }}>
                        <strong style={{ fontSize: "0.75rem", color: "var(--muted)" }}>指令</strong>
                        <p style={{ whiteSpace: "pre-wrap", fontSize: "0.8rem", marginTop: 4 }}>{job.instructions}</p>
                      </div>

                      {job.contextRefs.length > 0 ? (
                        <div className="record-card" style={{ background: "var(--panel-hi)", marginTop: 6 }}>
                          <strong style={{ fontSize: "0.75rem", color: "var(--muted)" }}>上下文參考</strong>
                          <ul style={{ margin: "4px 0 0", paddingLeft: 16, fontSize: "0.8rem" }}>
                            {job.contextRefs.map((ref, i) => (
                              <li key={i}>
                                <strong>{ref.type}</strong>
                                {ref.id ? `：${ref.id}` : ""}
                                {ref.path ? ` (${ref.path})` : ""}
                                {ref.url ? (
                                  <> <a href={ref.url} target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>連結</a></>
                                ) : null}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}

                      {job.result ? (
                        <div className="record-card" style={{ background: "var(--panel-hi)", marginTop: 6 }}>
                          <strong style={{ fontSize: "0.75rem", color: "var(--muted)" }}>結果（{job.result.schemaName}）</strong>

                          {job.result.rawText ? (
                            <pre style={{ whiteSpace: "pre-wrap", fontSize: "0.78rem", marginTop: 4, maxHeight: 260, overflow: "auto", background: "var(--bg)", padding: 10, borderRadius: 8 }}>
                              {job.result.rawText}
                            </pre>
                          ) : null}

                          {job.result.structured ? (
                            <pre style={{ whiteSpace: "pre-wrap", fontSize: "0.78rem", marginTop: 4, maxHeight: 260, overflow: "auto", background: "var(--bg)", padding: 10, borderRadius: 8 }}>
                              {JSON.stringify(job.result.structured, null, 2)}
                            </pre>
                          ) : null}

                          {job.result.warnings && job.result.warnings.length > 0 ? (
                            <div style={{ marginTop: 6 }}>
                              <strong style={{ fontSize: "0.72rem", color: "var(--warn)" }}>警告：</strong>
                              <ul style={{ margin: "2px 0 0", paddingLeft: 16, fontSize: "0.78rem", color: "var(--warn)" }}>
                                {job.result.warnings.map((w, i) => <li key={i}>{w}</li>)}
                              </ul>
                            </div>
                          ) : null}

                          {job.result.artifacts && job.result.artifacts.length > 0 ? (
                            <div style={{ marginTop: 6 }}>
                              <strong style={{ fontSize: "0.72rem", color: "var(--muted)" }}>產出物：</strong>
                              <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 2 }}>
                                {job.result.artifacts.map((a, i) => (
                                  <span key={i} className="badge" style={{ fontSize: "0.68rem" }}>
                                    {a.label}{a.mimeType ? ` (${a.mimeType})` : ""}
                                  </span>
                                ))}
                              </div>
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  {/* 審核操作 + 備註 */}
                  {isReviewable ? (
                    <div style={{ marginTop: 8 }}>
                      <textarea
                        value={note}
                        onChange={(e) => setReviewNotes((prev) => ({ ...prev, [job.id]: e.target.value }))}
                        placeholder="審核備註（選填）— 核准或退回的原因"
                        style={{ width: "100%", minHeight: 48, fontSize: "0.78rem", marginBottom: 6, resize: "vertical" }}
                      />
                      <div className="action-row">
                        <button
                          className="hero-link primary"
                          style={{ fontSize: "0.75rem", padding: "5px 12px" }}
                          disabled={actionLoading === job.id}
                          onClick={() => void handleReview(job.id, "published")}
                        >
                          {actionLoading === job.id ? "..." : "核准並發布"}
                        </button>
                        <button
                          className="hero-link"
                          style={{ fontSize: "0.75rem", padding: "5px 12px", borderColor: "rgba(255,93,93,0.3)", color: "var(--bear)" }}
                          disabled={actionLoading === job.id}
                          onClick={() => void handleReview(job.id, "rejected")}
                        >
                          {actionLoading === job.id ? "..." : "退回"}
                        </button>
                        {!isExpanded ? (
                          <button
                            className="hero-link"
                            style={{ fontSize: "0.75rem", padding: "5px 12px" }}
                            onClick={() => toggleExpand(job.id)}
                          >
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
