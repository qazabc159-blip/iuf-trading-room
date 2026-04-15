"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

import type { ReviewEntry, ReviewEntryCreateInput } from "@iuf-trading-room/contracts";

import { createReview, getReviews } from "@/lib/api";

const initialForm: ReviewEntryCreateInput = {
  tradePlanId: "", outcome: "", attribution: "", lesson: "", setupTags: [], executionQuality: 3
};

export function ReviewBoard() {
  const searchParams = useSearchParams();
  const prefillPlanId = searchParams.get("newForPlan") ?? "";
  const prefillPlanLabel = searchParams.get("planLabel") ?? "";
  const filterPlanId = searchParams.get("tradePlanId") ?? "";

  const [reviews, setReviews] = useState<ReviewEntry[]>([]);
  const [form, setForm] = useState<ReviewEntryCreateInput>({ ...initialForm, tradePlanId: prefillPlanId });
  const [tagInput, setTagInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(!!prefillPlanId);

  useEffect(() => {
    getReviews(filterPlanId ? { tradePlanId: filterPlanId } : undefined)
      .then((r) => setReviews(r.data))
      .catch((e) => setError(e instanceof Error ? e.message : "無法載入檢討"))
      .finally(() => setLoading(false));
  }, [filterPlanId]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault(); setSaving(true); setError(null);
    try {
      const r = await createReview(form);
      setReviews((c) => [r.data, ...c]);
      setForm(initialForm); setTagInput(""); setShowForm(false);
    } catch (err) { setError(err instanceof Error ? err.message : "建立檢討失敗"); }
    finally { setSaving(false); }
  };

  const addTag = () => {
    const t = tagInput.trim();
    if (t && !form.setupTags.includes(t)) { setForm((c) => ({ ...c, setupTags: [...c.setupTags, t] })); setTagInput(""); }
  };

  const qualityColor = (q: number) => q >= 4 ? "badge-green" : q <= 2 ? "badge-red" : "badge-yellow";

  return (
    <section style={{ display: "grid", gap: 14 }}>
      {/* 工具列 */}
      <div className="panel" style={{ padding: "8px 14px" }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <div className="metric-chip" style={{ padding: "5px 10px", minWidth: "auto" }}>
            <span style={{ fontSize: "0.9rem" }}>{reviews.length}</span>
            <small style={{ fontSize: "0.6rem" }}>檢討</small>
          </div>
          {filterPlanId ? <span className="badge-blue" style={{ fontSize: "0.65rem" }}>篩選計畫 {filterPlanId.slice(0, 8)}</span> : null}
          <button className="action-button" style={{ fontSize: "0.75rem", padding: "5px 12px", marginLeft: "auto" }} onClick={() => setShowForm(!showForm)}>
            {showForm ? "關閉表單" : "+ 新增檢討"}
          </button>
        </div>
      </div>

      {error ? <p className="error-text" style={{ fontSize: "0.78rem" }}>{error}</p> : null}

      {/* 建立表單 */}
      {showForm ? (
        <form className="panel" onSubmit={handleSubmit}>
          <p className="eyebrow">{prefillPlanLabel ? `${prefillPlanLabel} 的檢討` : "新增檢討"}</p>
          <label className="field"><span>交易計畫 ID</span>
            <input value={form.tradePlanId} onChange={(e) => setForm((c) => ({ ...c, tradePlanId: e.target.value }))} placeholder="貼上計畫 UUID" />
            {prefillPlanId ? <small className="dim">已從計畫帶入：{prefillPlanId.slice(0, 12)}...</small> : null}
          </label>
          <label className="field"><span>結果</span>
            <textarea value={form.outcome} onChange={(e) => setForm((c) => ({ ...c, outcome: e.target.value }))} placeholder="發生了什麼：賺、賠、打平" />
          </label>
          <label className="field"><span>歸因</span>
            <textarea value={form.attribution} onChange={(e) => setForm((c) => ({ ...c, attribution: e.target.value }))} placeholder="論點對嗎？時機？執行？" />
          </label>
          <label className="field"><span>教訓</span>
            <textarea value={form.lesson} onChange={(e) => setForm((c) => ({ ...c, lesson: e.target.value }))} placeholder="下次要怎麼做不同" />
          </label>
          <label className="field"><span>執行品質 (1-5)</span>
            <input type="number" min={1} max={5} value={form.executionQuality} onChange={(e) => setForm((c) => ({ ...c, executionQuality: Number(e.target.value) }))} />
          </label>
          <div className="field"><span>Setup 標籤</span>
            <div style={{ display: "flex", gap: 6 }}>
              <input value={tagInput} onChange={(e) => setTagInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTag(); } }} placeholder="輸入標籤後按 Enter" style={{ flex: 1 }} />
              <button type="button" className="hero-link" style={{ padding: "5px 10px", fontSize: "0.72rem" }} onClick={addTag}>加入</button>
            </div>
            {form.setupTags.length > 0 ? (
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 6 }}>
                {form.setupTags.map((t) => (
                  <span key={t} className="badge" onClick={() => setForm((c) => ({ ...c, setupTags: c.setupTags.filter((x) => x !== t) }))} style={{ cursor: "pointer", fontSize: "0.68rem" }}>{t} ×</span>
                ))}
              </div>
            ) : null}
          </div>
          <button className="action-button" type="submit" disabled={saving}>{saving ? "建立中..." : "建立檢討"}</button>
        </form>
      ) : null}

      {/* 檢討列表 */}
      <div className="panel">
        {loading ? <p className="muted">載入檢討...</p> : reviews.length === 0 ? <p className="dim">尚無檢討紀錄。</p> : (
          <div className="card-stack">
            {reviews.map((r) => (
              <article key={r.id} className="record-card">
                <div className="record-topline">
                  <strong style={{ fontSize: "0.82rem" }}>檢討 {r.id.slice(0, 8)}</strong>
                  <span className={qualityColor(r.executionQuality)} style={{ fontSize: "0.65rem" }}>品質 {r.executionQuality}/5</span>
                </div>
                <p className="record-meta">計畫 {r.tradePlanId.slice(0, 8)} · {new Date(r.createdAt).toLocaleDateString("zh-TW")}</p>
                <p style={{ fontSize: "0.78rem" }}><strong>結果：</strong>{r.outcome}</p>
                {r.attribution ? <p style={{ fontSize: "0.78rem" }}><strong>歸因：</strong>{r.attribution}</p> : null}
                {r.lesson ? <p style={{ fontSize: "0.78rem" }}><strong>教訓：</strong>{r.lesson}</p> : null}
                {r.setupTags.length > 0 ? (
                  <div style={{ display: "flex", gap: 3, flexWrap: "wrap", marginTop: 4 }}>
                    {r.setupTags.map((t) => <span key={t} className="badge" style={{ fontSize: "0.62rem", padding: "2px 6px" }}>{t}</span>)}
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
