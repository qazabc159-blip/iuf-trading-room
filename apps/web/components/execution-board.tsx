"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

import type { Company, TradePlan, TradePlanCreateInput, TradePlanStatus } from "@iuf-trading-room/contracts";

import { createPlan, getCompanies, getPlans } from "@/lib/api";

const statuses: TradePlanStatus[] = ["draft", "ready", "active", "reduced", "closed", "canceled"];
const statusLabel: Record<string, string> = {
  draft: "草稿", ready: "就緒", active: "執行中", reduced: "減碼", closed: "平倉", canceled: "取消"
};

const initialForm: TradePlanCreateInput = {
  companyId: "", status: "draft", entryPlan: "", invalidationPlan: "", targetPlan: "", riskReward: "", notes: ""
};

export function ExecutionBoard() {
  const searchParams = useSearchParams();
  const prefillCompanyId = searchParams.get("newForCompany") ?? "";
  const prefillCompanyName = searchParams.get("companyName") ?? "";
  const filterCompanyId = searchParams.get("companyId") ?? "";

  const [plans, setPlans] = useState<TradePlan[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [form, setForm] = useState<TradePlanCreateInput>({ ...initialForm, companyId: prefillCompanyId });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [filterStatus, setFilterStatus] = useState<string>("");
  const [companySearch, setCompanySearch] = useState(prefillCompanyName);
  const [showPicker, setShowPicker] = useState(false);
  const [showForm, setShowForm] = useState(!!prefillCompanyId);

  useEffect(() => {
    const params: { companyId?: string; status?: string } = {};
    if (filterCompanyId) params.companyId = filterCompanyId;
    if (filterStatus) params.status = filterStatus;
    setLoading(true);
    Promise.all([getPlans(Object.keys(params).length > 0 ? params : undefined), getCompanies()])
      .then(([pr, cr]) => { setPlans(pr.data); setCompanies(cr.data); })
      .catch((e) => setError(e instanceof Error ? e.message : "無法載入計畫"))
      .finally(() => setLoading(false));
  }, [filterStatus, filterCompanyId]);

  const companyMap = new Map(companies.map((c) => [c.id, c]));
  const getLabel = (id: string) => { const c = companyMap.get(id); return c ? `${c.ticker} ${c.name}` : id.slice(0, 8) + "..."; };

  const filteredCompanies = companySearch
    ? companies.filter((c) => c.name.toLowerCase().includes(companySearch.toLowerCase()) || c.ticker.toLowerCase().includes(companySearch.toLowerCase())).slice(0, 10)
    : [];

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault(); setSaving(true); setError(null);
    try {
      const r = await createPlan(form);
      setPlans((c) => [r.data, ...c]);
      setForm(initialForm); setCompanySearch(""); setShowForm(false);
    } catch (err) { setError(err instanceof Error ? err.message : "建立計畫失敗"); }
    finally { setSaving(false); }
  };

  const statusColor = (s: string) => {
    if (s === "active" || s === "ready") return "badge-green";
    if (s === "closed" || s === "canceled") return "badge-red";
    if (s === "reduced") return "badge-yellow";
    return "badge";
  };

  return (
    <section style={{ display: "grid", gap: 14 }}>
      {/* 工具列 */}
      <div className="panel filter-bar">
        <select value={filterStatus} onChange={(e) => { setFilterStatus(e.target.value); setLoading(true); }}>
          <option value="">全部狀態</option>
          {statuses.map((s) => <option key={s} value={s}>{statusLabel[s]}</option>)}
        </select>
        <div className="metric-chip" style={{ padding: "5px 10px", minWidth: "auto" }}>
          <span style={{ fontSize: "var(--fs-base)" }}>{plans.length}</span>
          <small>計畫</small>
        </div>
        <div className="metric-chip" style={{ padding: "5px 10px", minWidth: "auto" }}>
          <span style={{ fontSize: "var(--fs-base)" }}>{plans.filter((p) => p.status === "active").length}</span>
          <small>執行中</small>
        </div>
        <button className="btn-sm" style={{ marginLeft: "auto" }} onClick={() => setShowForm(!showForm)}>
          {showForm ? "關閉表單" : "+ 新增計畫"}
        </button>
      </div>

      {error ? <p className="error-text" style={{ fontSize: "var(--fs-sm)" }}>{error}</p> : null}

      {/* 建立表單 */}
      {showForm ? (
        <form className="panel" onSubmit={handleSubmit}>
          <p className="eyebrow">{prefillCompanyName ? `為 ${prefillCompanyName} 建立計畫` : "新增交易計畫"}</p>
          <label className="field"><span>公司</span>
            <input value={companySearch} onChange={(e) => { setCompanySearch(e.target.value); setShowPicker(true); }} onFocus={() => setShowPicker(true)} placeholder="搜尋公司名稱或代號..." />
            {showPicker && filteredCompanies.length > 0 ? (
              <div style={{ border: "1px solid var(--line)", borderRadius: "var(--radius-sm)", background: "var(--panel-hi)", maxHeight: 180, overflowY: "auto", marginTop: 4 }}>
                {filteredCompanies.map((c) => (
                  <div key={c.id} onClick={() => { setForm((f) => ({ ...f, companyId: c.id })); setCompanySearch(`${c.ticker} ${c.name}`); setShowPicker(false); }}
                    style={{ padding: "6px 10px", cursor: "pointer", borderBottom: "1px solid var(--line)", fontSize: "var(--fs-sm)" }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "var(--panel)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                    <strong className="mono">{c.ticker}</strong> {c.name} <span className="dim" style={{ fontSize: "var(--fs-xs)" }}>{c.chainPosition}</span>
                  </div>
                ))}
              </div>
            ) : null}
            {form.companyId ? <small className="dim">已選：{getLabel(form.companyId)}</small> : null}
          </label>
          <label className="field"><span>進場計畫</span><textarea value={form.entryPlan} onChange={(e) => setForm((c) => ({ ...c, entryPlan: e.target.value }))} placeholder="進場區間、時機、條件" /></label>
          <label className="field"><span>失效條件</span><textarea value={form.invalidationPlan} onChange={(e) => setForm((c) => ({ ...c, invalidationPlan: e.target.value }))} placeholder="什麼條件推翻論點" /></label>
          <label className="field"><span>目標</span><textarea value={form.targetPlan} onChange={(e) => setForm((c) => ({ ...c, targetPlan: e.target.value }))} placeholder="目標價位與出場條件" /></label>
          <label className="field"><span>風險報酬比</span><input value={form.riskReward} onChange={(e) => setForm((c) => ({ ...c, riskReward: e.target.value }))} placeholder="例如 1:3" /></label>
          <label className="field"><span>備註</span><textarea value={form.notes} onChange={(e) => setForm((c) => ({ ...c, notes: e.target.value }))} placeholder="額外脈絡" /></label>
          <button className="action-button" type="submit" disabled={saving}>{saving ? "建立中..." : "建立計畫"}</button>
        </form>
      ) : null}

      {/* 計畫列表 */}
      <div className="panel">
        {loading ? <p className="muted loading-text">載入計畫...</p> : plans.length === 0 ? <p className="dim">尚無計畫。</p> : (
          <div className="card-stack">
            {plans.map((p) => (
              <article key={p.id} className="record-card">
                <div className="record-topline">
                  <strong style={{ fontSize: "var(--fs-base)" }}>{getLabel(p.companyId)}</strong>
                  <span className={statusColor(p.status)} style={{ fontSize: "var(--fs-xs)" }}>{statusLabel[p.status] ?? p.status}</span>
                </div>
                <p style={{ fontSize: "var(--fs-sm)" }}><strong>進場：</strong>{p.entryPlan}</p>
                <p style={{ fontSize: "var(--fs-sm)" }}><strong>失效：</strong>{p.invalidationPlan}</p>
                <p style={{ fontSize: "var(--fs-sm)" }}><strong>目標：</strong>{p.targetPlan}</p>
                {p.riskReward ? <p className="dim mono" style={{ fontSize: "var(--fs-sm)" }}>R/R: {p.riskReward}</p> : null}
                <div className="action-row" style={{ marginTop: 6 }}>
                  <a href={`/reviews?newForPlan=${p.id}&planLabel=${encodeURIComponent(getLabel(p.companyId))}`} className="hero-link primary" style={{ fontSize: "var(--fs-xs)", padding: "3px 8px" }}>+ 建立檢討</a>
                  <a href={`/reviews?tradePlanId=${p.id}`} className="hero-link" style={{ fontSize: "var(--fs-xs)", padding: "3px 8px" }}>查看檢討</a>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
