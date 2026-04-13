"use client";

import { useEffect, useState } from "react";

import type { Signal, SignalCategory, SignalCreateInput, SignalDirection } from "@iuf-trading-room/contracts";

import { createSignal, getSignals } from "@/lib/api";

const categories: SignalCategory[] = ["macro", "industry", "company", "price", "portfolio"];
const directions: SignalDirection[] = ["bullish", "bearish", "neutral"];

const initialForm: SignalCreateInput = {
  category: "macro",
  direction: "bullish",
  title: "",
  summary: "",
  confidence: 3,
  themeIds: [],
  companyIds: []
};

export function SignalBoard() {
  const [signals, setSignals] = useState<Signal[]>([]);
  const [form, setForm] = useState<SignalCreateInput>(initialForm);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [filterCategory, setFilterCategory] = useState<string>("");

  useEffect(() => {
    const load = async () => {
      try {
        const response = await getSignals(filterCategory ? { category: filterCategory } : undefined);
        setSignals(response.data);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Unable to load signals.");
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, [filterCategory]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError(null);

    try {
      const response = await createSignal(form);
      setSignals((current) => [response.data, ...current]);
      setForm(initialForm);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to create signal.");
    } finally {
      setSaving(false);
    }
  };

  const directionColor = (direction: string) => {
    if (direction === "bullish") return "badge-green";
    if (direction === "bearish") return "badge-red";
    return "badge";
  };

  return (
    <section className="board-grid">
      <div className="panel panel-large">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Live Board</p>
            <h3>Signals</h3>
          </div>
          <div className="metric-chip">
            <span>{signals.length}</span>
            <small>Total</small>
          </div>
        </div>

        <div className="filter-row">
          <select
            value={filterCategory}
            onChange={(event) => {
              setFilterCategory(event.target.value);
              setLoading(true);
            }}
          >
            <option value="">All categories</option>
            {categories.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>
        </div>

        {loading ? <p className="muted">Loading signals...</p> : null}
        {error ? <p className="error-text">{error}</p> : null}

        <div className="card-stack">
          {signals.map((signal) => (
            <article key={signal.id} className="record-card">
              <div className="record-topline">
                <strong>{signal.title}</strong>
                <span className={directionColor(signal.direction)}>{signal.direction}</span>
              </div>
              <p className="record-meta">
                {signal.category} · confidence {signal.confidence}/5
              </p>
              {signal.summary ? <p>{signal.summary}</p> : null}
            </article>
          ))}
        </div>
      </div>

      <form className="panel" onSubmit={handleSubmit}>
        <div className="panel-header">
          <div>
            <p className="eyebrow">Create Signal</p>
            <h3>New signal entry</h3>
          </div>
        </div>

        <label className="field">
          <span>Title</span>
          <input
            value={form.title}
            onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
            placeholder="TSMC raised capex guidance 15%"
          />
        </label>

        <div className="field-grid">
          <label className="field">
            <span>Category</span>
            <select
              value={form.category}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  category: event.target.value as SignalCategory
                }))
              }
            >
              {categories.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Direction</span>
            <select
              value={form.direction}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  direction: event.target.value as SignalDirection
                }))
              }
            >
              {directions.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="field">
          <span>Confidence (1-5)</span>
          <input
            type="number"
            min={1}
            max={5}
            value={form.confidence}
            onChange={(event) =>
              setForm((current) => ({ ...current, confidence: Number(event.target.value) }))
            }
          />
        </label>

        <label className="field">
          <span>Summary</span>
          <textarea
            value={form.summary}
            onChange={(event) => setForm((current) => ({ ...current, summary: event.target.value }))}
            placeholder="What this signal means for the thesis."
          />
        </label>

        <button className="action-button" type="submit" disabled={saving}>
          {saving ? "Creating..." : "Create signal"}
        </button>
      </form>
    </section>
  );
}
