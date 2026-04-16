"use client";

import { useEffect, useState } from "react";

import type { CompanyDuplicateReport } from "@iuf-trading-room/contracts";

import { getCompanyDuplicates } from "@/lib/api";

const tierLabel: Record<string, string> = { Core: "核心", Direct: "直接", Indirect: "間接", Observation: "觀察" };

export function CompanyDuplicates() {
  const [report, setReport] = useState<CompanyDuplicateReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    getCompanyDuplicates({ limit: 100 })
      .then((r) => setReport(r.data))
      .catch((e) => setError(e instanceof Error ? e.message : "無法載入重複偵測"))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  return (
    <section style={{ display: "grid", gap: 14 }}>
      <div className="panel filter-bar">
        <div className="metric-chip" style={{ padding: "5px 10px", minWidth: "auto" }}>
          <span style={{ fontSize: "var(--fs-base)" }}>{report?.summary.groupCount ?? "—"}</span>
          <small>重複群組</small>
        </div>
        <div className="metric-chip" style={{ padding: "5px 10px", minWidth: "auto" }}>
          <span style={{ fontSize: "var(--fs-base)" }}>{report?.summary.companyCount ?? "—"}</span>
          <small>受影響公司</small>
        </div>
        {report ? (
          <span className="dim mono" style={{ fontSize: "var(--fs-xs)" }}>
            生成：{new Date(report.generatedAt).toLocaleString("zh-TW")}
          </span>
        ) : null}
        <button className="btn-sm" style={{ marginLeft: "auto" }} onClick={load} disabled={loading}>
          {loading ? "掃描中..." : "重新掃描"}
        </button>
      </div>

      {error ? <p className="error-text" style={{ fontSize: "var(--fs-sm)" }}>{error}</p> : null}

      <div className="panel">
        {loading && !report ? (
          <p className="muted loading-text">掃描公司資料庫中...</p>
        ) : !report || report.groups.length === 0 ? (
          <p className="dim">太好了，沒有偵測到重複的公司紀錄。</p>
        ) : (
          <div className="card-stack">
            {report.groups.map((g) => (
              <article key={g.groupKey} className="record-card">
                <div className="record-topline">
                  <div>
                    <strong className="mono" style={{ fontSize: "var(--fs-base)" }}>{g.ticker}</strong>
                    <span style={{ marginLeft: 8, fontSize: "var(--fs-sm)" }}>{g.normalizedName}</span>
                  </div>
                  <span className="badge-red" style={{ fontSize: "var(--fs-xs)" }}>
                    {g.duplicateCount} 筆重複
                  </span>
                </div>
                <p className="record-meta">判定原因：{g.reason}</p>
                <div className="card-stack" style={{ marginTop: 6 }}>
                  {g.companies.map((c) => {
                    const isRecommended = c.companyId === g.recommendedCompanyId;
                    return (
                      <div
                        key={c.companyId}
                        style={{
                          display: "grid",
                          gridTemplateColumns: "auto 1fr auto auto",
                          gap: 10,
                          alignItems: "center",
                          padding: "6px 10px",
                          background: isRecommended ? "rgba(74,222,128,0.08)" : "var(--panel-hi)",
                          border: isRecommended ? "1px solid rgba(74,222,128,0.3)" : "1px solid var(--line)",
                          borderRadius: "var(--radius-sm)",
                          fontSize: "var(--fs-sm)"
                        }}
                      >
                        <span className="mono" style={{ fontWeight: 600, minWidth: 70 }}>{c.ticker}</span>
                        <span>
                          {c.name}
                          <span className="dim" style={{ marginLeft: 6, fontSize: "var(--fs-xs)" }}>
                            {c.market} / {c.country}
                          </span>
                        </span>
                        <span className="badge" style={{ fontSize: "var(--fs-xs)" }}>{tierLabel[c.beneficiaryTier] ?? c.beneficiaryTier}</span>
                        <span className="dim mono" style={{ fontSize: "var(--fs-xs)", whiteSpace: "nowrap" }}>
                          主題 {c.themeCount} · 關係 {c.relationCount} · 詞 {c.keywordCount}
                          {isRecommended ? <span style={{ color: "var(--bull)", marginLeft: 6 }}>★ 建議保留</span> : null}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
