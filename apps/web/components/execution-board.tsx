"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

import type { Company, TradePlan, TradePlanCreateInput, TradePlanStatus } from "@iuf-trading-room/contracts";

import { createPlan, getCompanies, getPlans } from "@/lib/api";

const statuses: TradePlanStatus[] = ["draft", "ready", "active", "reduced", "closed", "canceled"];

const initialForm: TradePlanCreateInput = {
  companyId: "",
  status: "draft",
  entryPlan: "",
  invalidationPlan: "",
  targetPlan: "",
  riskReward: "",
  notes: ""
};

export function ExecutionBoard() {
  const searchParams = useSearchParams();
  const prefillCompanyId = searchParams.get("newForCompany") ?? "";
  const prefillCompanyName = searchParams.get("companyName") ?? "";
  const filterCompanyId = searchParams.get("companyId") ?? "";

  const [plans, setPlans] = useState<TradePlan[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [form, setForm] = useState<TradePlanCreateInput>({
    ...initialForm,
    companyId: prefillCompanyId
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [filterStatus, setFilterStatus] = useState<string>("");
  const [companySearch, setCompanySearch] = useState(prefillCompanyName);
  const [showCompanyPicker, setShowCompanyPicker] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const params: { companyId?: string; status?: string } = {};
        if (filterCompanyId) params.companyId = filterCompanyId;
        if (filterStatus) params.status = filterStatus;
        const [plansRes, companiesRes] = await Promise.all([
          getPlans(Object.keys(params).length > 0 ? params : undefined),
          getCompanies()
        ]);
        setPlans(plansRes.data);
        setCompanies(companiesRes.data);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Unable to load plans.");
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, [filterStatus, filterCompanyId]);

  const companyMap = new Map(companies.map((c) => [c.id, c]));

  const getCompanyLabel = (companyId: string) => {
    const c = companyMap.get(companyId);
    return c ? `${c.ticker} ${c.name}` : companyId.slice(0, 8) + "...";
  };

  // Company picker filtered list
  const filteredCompanies = companySearch
    ? companies
        .filter(
          (c) =>
            c.name.toLowerCase().includes(companySearch.toLowerCase()) ||
            c.ticker.toLowerCase().includes(companySearch.toLowerCase())
        )
        .slice(0, 10)
    : [];

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError(null);

    try {
      const response = await createPlan(form);
      setPlans((current) => [response.data, ...current]);
      setForm(initialForm);
      setCompanySearch("");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to create plan.");
    } finally {
      setSaving(false);
    }
  };

  const statusColor = (status: string) => {
    if (status === "active") return "badge-green";
    if (status === "closed" || status === "canceled") return "badge-red";
    if (status === "ready") return "badge-blue";
    return "badge";
  };

  return (
    <section className="board-grid">
      <div className="panel panel-large">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Live Board</p>
            <h3>Trade Plans</h3>
          </div>
          <div className="metric-chip">
            <span>{plans.length}</span>
            <small>Total</small>
          </div>
          <div className="metric-chip">
            <span>{plans.filter((p) => p.status === "active").length}</span>
            <small>Active</small>
          </div>
        </div>

        <div className="filter-row">
          <select
            value={filterStatus}
            onChange={(event) => {
              setFilterStatus(event.target.value);
              setLoading(true);
            }}
          >
            <option value="">All statuses</option>
            {statuses.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        {loading ? <p className="muted">Loading plans...</p> : null}
        {error ? <p className="error-text">{error}</p> : null}

        <div className="card-stack">
          {plans.map((plan) => (
            <article key={plan.id} className="record-card">
              <div className="record-topline">
                <strong>{getCompanyLabel(plan.companyId)}</strong>
                <span className={statusColor(plan.status)}>{plan.status}</span>
              </div>
              <p>
                <strong>Entry:</strong> {plan.entryPlan}
              </p>
              <p>
                <strong>Invalidation:</strong> {plan.invalidationPlan}
              </p>
              <p>
                <strong>Target:</strong> {plan.targetPlan}
              </p>
              {plan.riskReward ? <p className="muted">R/R: {plan.riskReward}</p> : null}
              <div className="action-row" style={{ marginTop: 10 }}>
                <a
                  href={`/reviews?newForPlan=${plan.id}&planLabel=${encodeURIComponent(getCompanyLabel(plan.companyId))}`}
                  className="hero-link primary"
                  style={{ fontSize: "0.8rem", padding: "6px 12px" }}
                >
                  + Create Review
                </a>
                <a
                  href={`/reviews?tradePlanId=${plan.id}`}
                  className="hero-link"
                  style={{ fontSize: "0.8rem", padding: "6px 12px" }}
                >
                  View Reviews
                </a>
              </div>
            </article>
          ))}
        </div>
      </div>

      <form className="panel" onSubmit={handleSubmit}>
        <div className="panel-header">
          <div>
            <p className="eyebrow">Create Plan</p>
            <h3>
              {prefillCompanyName
                ? `Plan for ${prefillCompanyName}`
                : "New trade plan"}
            </h3>
          </div>
        </div>

        {/* Company picker with search */}
        <label className="field">
          <span>Company</span>
          <input
            value={companySearch}
            onChange={(e) => {
              setCompanySearch(e.target.value);
              setShowCompanyPicker(true);
            }}
            onFocus={() => setShowCompanyPicker(true)}
            placeholder="Search company name or ticker..."
          />
          {showCompanyPicker && filteredCompanies.length > 0 ? (
            <div
              style={{
                border: "1px solid var(--line)",
                borderRadius: 12,
                background: "var(--panel-strong)",
                maxHeight: 200,
                overflowY: "auto",
                marginTop: 4
              }}
            >
              {filteredCompanies.map((c) => (
                <div
                  key={c.id}
                  onClick={() => {
                    setForm((f) => ({ ...f, companyId: c.id }));
                    setCompanySearch(`${c.ticker} ${c.name}`);
                    setShowCompanyPicker(false);
                  }}
                  style={{
                    padding: "8px 12px",
                    cursor: "pointer",
                    borderBottom: "1px solid var(--line)",
                    fontSize: "0.85rem"
                  }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.background = "rgba(180,77,26,0.06)")
                  }
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  <strong>{c.ticker}</strong> {c.name}{" "}
                  <span className="muted" style={{ fontSize: "0.78rem" }}>
                    {c.chainPosition}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
          {form.companyId ? (
            <small className="muted">Selected: {getCompanyLabel(form.companyId)}</small>
          ) : null}
        </label>

        <label className="field">
          <span>Entry plan</span>
          <textarea
            value={form.entryPlan}
            onChange={(e) => setForm((c) => ({ ...c, entryPlan: e.target.value }))}
            placeholder="Entry zone, timing, and conditions."
          />
        </label>

        <label className="field">
          <span>Invalidation</span>
          <textarea
            value={form.invalidationPlan}
            onChange={(e) => setForm((c) => ({ ...c, invalidationPlan: e.target.value }))}
            placeholder="What would prove the thesis wrong."
          />
        </label>

        <label className="field">
          <span>Target</span>
          <textarea
            value={form.targetPlan}
            onChange={(e) => setForm((c) => ({ ...c, targetPlan: e.target.value }))}
            placeholder="Price targets and exit conditions."
          />
        </label>

        <label className="field">
          <span>Risk / Reward</span>
          <input
            value={form.riskReward}
            onChange={(e) => setForm((c) => ({ ...c, riskReward: e.target.value }))}
            placeholder="e.g. 1:3"
          />
        </label>

        <label className="field">
          <span>Notes</span>
          <textarea
            value={form.notes}
            onChange={(e) => setForm((c) => ({ ...c, notes: e.target.value }))}
            placeholder="Additional context."
          />
        </label>

        <button className="action-button" type="submit" disabled={saving}>
          {saving ? "Creating..." : "Create plan"}
        </button>
      </form>
    </section>
  );
}
