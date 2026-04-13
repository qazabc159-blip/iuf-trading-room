"use client";

import { useEffect, useState } from "react";

import type { DailyBrief, DailyBriefCreateInput } from "@iuf-trading-room/contracts";

import { createBrief, getBriefs } from "@/lib/api";

const today = () => new Date().toISOString().slice(0, 10);

const initialForm: DailyBriefCreateInput = {
  date: today(),
  marketState: "Balanced",
  sections: [
    { heading: "Market State", body: "" },
    { heading: "Theme Changes", body: "" },
    { heading: "Top Signals", body: "" },
    { heading: "Pending Catalysts", body: "" },
    { heading: "Watchlist Changes", body: "" }
  ],
  generatedBy: "manual",
  status: "draft"
};

export function BriefBoard() {
  const [briefs, setBriefs] = useState<DailyBrief[]>([]);
  const [form, setForm] = useState<DailyBriefCreateInput>(initialForm);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [selectedBrief, setSelectedBrief] = useState<DailyBrief | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const response = await getBriefs();
        setBriefs(response.data);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Unable to load briefs.");
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, []);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError(null);

    try {
      const response = await createBrief(form);
      setBriefs((current) => [response.data, ...current]);
      setForm({ ...initialForm, date: today() });
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to create brief.");
    } finally {
      setSaving(false);
    }
  };

  const updateSection = (index: number, field: "heading" | "body", value: string) => {
    setForm((current) => ({
      ...current,
      sections: current.sections.map((s, i) =>
        i === index ? { ...s, [field]: value } : s
      )
    }));
  };

  return (
    <section className="board-grid">
      {/* Brief reader */}
      <div className="panel panel-large">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Daily Briefs</p>
            <h3>Operating Picture</h3>
          </div>
          <div className="metric-chip">
            <span>{briefs.length}</span>
            <small>Total</small>
          </div>
        </div>

        {loading ? <p className="muted">Loading briefs...</p> : null}
        {error ? <p className="error-text">{error}</p> : null}

        {selectedBrief ? (
          <div className="brief-reader">
            <div className="record-topline">
              <strong>{selectedBrief.date}</strong>
              <span className="badge">{selectedBrief.status}</span>
              <span className="badge">{selectedBrief.generatedBy}</span>
              <button
                className="action-button-small"
                onClick={() => setSelectedBrief(null)}
              >
                Back
              </button>
            </div>
            <p className="record-meta">Market: {selectedBrief.marketState}</p>
            {selectedBrief.sections.map((section, i) => (
              <div key={i} className="brief-section">
                <h4>{section.heading}</h4>
                <p>{section.body}</p>
              </div>
            ))}
          </div>
        ) : (
          <div className="card-stack">
            {briefs.map((brief) => (
              <article
                key={brief.id}
                className="record-card"
                onClick={() => setSelectedBrief(brief)}
                style={{ cursor: "pointer" }}
              >
                <div className="record-topline">
                  <strong>{brief.date}</strong>
                  <span className="badge">{brief.status}</span>
                  <span className="badge">{brief.generatedBy}</span>
                </div>
                <p className="record-meta">
                  Market: {brief.marketState} · {brief.sections.length} sections
                </p>
              </article>
            ))}
            {briefs.length === 0 && !loading ? (
              <p className="muted">No briefs yet. Create one to get started.</p>
            ) : null}
          </div>
        )}
      </div>

      {/* Brief creator */}
      <form className="panel" onSubmit={handleSubmit}>
        <div className="panel-header">
          <div>
            <p className="eyebrow">Create Brief</p>
            <h3>New daily brief</h3>
          </div>
        </div>

        <label className="field">
          <span>Date</span>
          <input
            type="date"
            value={form.date}
            onChange={(event) => setForm((current) => ({ ...current, date: event.target.value }))}
          />
        </label>

        <label className="field">
          <span>Market State</span>
          <input
            value={form.marketState}
            onChange={(event) =>
              setForm((current) => ({ ...current, marketState: event.target.value }))
            }
            placeholder="Balanced, Attack, Defense..."
          />
        </label>

        {form.sections.map((section, i) => (
          <div key={i} className="field">
            <span>{section.heading}</span>
            <textarea
              value={section.body}
              onChange={(event) => updateSection(i, "body", event.target.value)}
              placeholder={`Write ${section.heading.toLowerCase()} notes...`}
            />
          </div>
        ))}

        <button className="action-button" type="submit" disabled={saving}>
          {saving ? "Creating..." : "Create brief"}
        </button>
      </form>
    </section>
  );
}
