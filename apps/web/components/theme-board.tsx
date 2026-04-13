"use client";

import { useEffect, useMemo, useState } from "react";

import type { MarketState, Theme, ThemeCreateInput, ThemeLifecycle } from "@iuf-trading-room/contracts";

import { createTheme, getThemes } from "@/lib/api";

const marketStates: MarketState[] = [
  "Attack",
  "Selective Attack",
  "Balanced",
  "Defense",
  "Preservation"
];

const lifecycleStates: ThemeLifecycle[] = [
  "Discovery",
  "Validation",
  "Expansion",
  "Crowded",
  "Distribution"
];

const initialForm: ThemeCreateInput = {
  name: "",
  marketState: "Balanced",
  lifecycle: "Discovery",
  priority: 3,
  thesis: "",
  whyNow: "",
  bottleneck: ""
};

export function ThemeBoard() {
  const [themes, setThemes] = useState<Theme[]>([]);
  const [form, setForm] = useState<ThemeCreateInput>(initialForm);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const response = await getThemes();
        setThemes(response.data);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Unable to load themes.");
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, []);

  const highPriorityCount = useMemo(
    () => themes.filter((theme) => theme.priority >= 4).length,
    [themes]
  );

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError(null);

    try {
      const response = await createTheme(form);
      setThemes((current) => [response.data, ...current]);
      setForm(initialForm);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to create theme.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="board-grid">
      <div className="panel panel-large">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Live Board</p>
            <h3>Themes</h3>
          </div>
          <div className="metric-chip">
            <span>{themes.length}</span>
            <small>Total</small>
          </div>
          <div className="metric-chip">
            <span>{highPriorityCount}</span>
            <small>Priority 4+</small>
          </div>
        </div>

        {loading ? <p className="muted">Loading themes...</p> : null}
        {error ? <p className="error-text">{error}</p> : null}

        <div className="card-stack">
          {themes.map((theme) => (
            <article key={theme.id} className="record-card">
              <div className="record-topline">
                <strong>{theme.name}</strong>
                <span className="badge">{theme.marketState}</span>
              </div>
              <p className="record-meta">
                {theme.lifecycle} · priority {theme.priority}
              </p>
              <p>{theme.thesis}</p>
              <p className="muted">Why now: {theme.whyNow}</p>
              <p className="muted">Bottleneck: {theme.bottleneck}</p>
            </article>
          ))}
        </div>
      </div>

      <form className="panel" onSubmit={handleSubmit}>
        <div className="panel-header">
          <div>
            <p className="eyebrow">Create Theme</p>
            <h3>New theme card</h3>
          </div>
        </div>

        <label className="field">
          <span>Name</span>
          <input
            value={form.name}
            onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
            placeholder="AI Power and Cooling"
          />
        </label>

        <div className="field-grid">
          <label className="field">
            <span>Market state</span>
            <select
              value={form.marketState}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  marketState: event.target.value as MarketState
                }))
              }
            >
              {marketStates.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Lifecycle</span>
            <select
              value={form.lifecycle}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  lifecycle: event.target.value as ThemeLifecycle
                }))
              }
            >
              {lifecycleStates.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="field">
          <span>Priority</span>
          <input
            type="number"
            min={1}
            max={5}
            value={form.priority}
            onChange={(event) =>
              setForm((current) => ({ ...current, priority: Number(event.target.value) }))
            }
          />
        </label>

        <label className="field">
          <span>Thesis</span>
          <textarea
            value={form.thesis}
            onChange={(event) => setForm((current) => ({ ...current, thesis: event.target.value }))}
            placeholder="Why this theme matters."
          />
        </label>

        <label className="field">
          <span>Why now</span>
          <textarea
            value={form.whyNow}
            onChange={(event) => setForm((current) => ({ ...current, whyNow: event.target.value }))}
            placeholder="What catalyst is changing now."
          />
        </label>

        <label className="field">
          <span>Bottleneck</span>
          <textarea
            value={form.bottleneck}
            onChange={(event) =>
              setForm((current) => ({ ...current, bottleneck: event.target.value }))
            }
            placeholder="Main bottleneck or underpriced link."
          />
        </label>

        <button className="action-button" type="submit" disabled={saving}>
          {saving ? "Creating..." : "Create theme"}
        </button>
      </form>
    </section>
  );
}
