"use client";

import { useEffect, useState } from "react";

import type { TradePlan, TradePlanCreateInput, TradePlanStatus } from "@iuf-trading-room/contracts";

import { createPlan, getPlans } from "@/lib/api";

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
  const [plans, setPlans] = useState<TradePlan[]>([]);
  const [form, setForm] = useState<TradePlanCreateInput>(initialForm);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [filterStatus, setFilterStatus] = useState<string>("");

  useEffect(() => {
    const load = async () => {
      try {
        const response = await getPlans(filterStatus ? { status: filterStatus } : undefined);
        setPlans(response.data);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Unable to load plans.");
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, [filterStatus]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError(null);

    try {
      const response = await createPlan(form);
      setPlans((current) => [response.data, ...current]);
      setForm(initialForm);
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
                <strong>Plan {plan.id.slice(0, 8)}</strong>
                <span className={statusColor(plan.status)}>{plan.status}</span>
              </div>
              <p className="record-meta">Company: {plan.companyId.slice(0, 8)}...</p>
              <p><strong>Entry:</strong> {plan.entryPlan}</p>
              <p><strong>Invalidation:</strong> {plan.invalidationPlan}</p>
              <p><strong>Target:</strong> {plan.targetPlan}</p>
              {plan.riskReward ? <p className="muted">R/R: {plan.riskReward}</p> : null}
            </article>
          ))}
        </div>
      </div>

      <form className="panel" onSubmit={handleSubmit}>
        <div className="panel-header">
          <div>
            <p className="eyebrow">Create Plan</p>
            <h3>New trade plan</h3>
          </div>
        </div>

        <label className="field">
          <span>Company ID</span>
          <input
            value={form.companyId}
            onChange={(event) => setForm((current) => ({ ...current, companyId: event.target.value }))}
            placeholder="Paste company UUID"
          />
        </label>

        <label className="field">
          <span>Entry plan</span>
          <textarea
            value={form.entryPlan}
            onChange={(event) => setForm((current) => ({ ...current, entryPlan: event.target.value }))}
            placeholder="Entry zone, timing, and conditions."
          />
        </label>

        <label className="field">
          <span>Invalidation</span>
          <textarea
            value={form.invalidationPlan}
            onChange={(event) =>
              setForm((current) => ({ ...current, invalidationPlan: event.target.value }))
            }
            placeholder="What would prove the thesis wrong."
          />
        </label>

        <label className="field">
          <span>Target</span>
          <textarea
            value={form.targetPlan}
            onChange={(event) => setForm((current) => ({ ...current, targetPlan: event.target.value }))}
            placeholder="Price targets and exit conditions."
          />
        </label>

        <label className="field">
          <span>Risk / Reward</span>
          <input
            value={form.riskReward}
            onChange={(event) => setForm((current) => ({ ...current, riskReward: event.target.value }))}
            placeholder="e.g. 1:3"
          />
        </label>

        <label className="field">
          <span>Notes</span>
          <textarea
            value={form.notes}
            onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
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
