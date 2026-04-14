"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

import type { ReviewEntry, ReviewEntryCreateInput } from "@iuf-trading-room/contracts";

import { createReview, getReviews } from "@/lib/api";

const initialForm: ReviewEntryCreateInput = {
  tradePlanId: "",
  outcome: "",
  attribution: "",
  lesson: "",
  setupTags: [],
  executionQuality: 3
};

export function ReviewBoard() {
  const searchParams = useSearchParams();
  const prefillPlanId = searchParams.get("newForPlan") ?? "";
  const prefillPlanLabel = searchParams.get("planLabel") ?? "";
  const filterPlanId = searchParams.get("tradePlanId") ?? "";

  const [reviews, setReviews] = useState<ReviewEntry[]>([]);
  const [form, setForm] = useState<ReviewEntryCreateInput>({
    ...initialForm,
    tradePlanId: prefillPlanId
  });
  const [tagInput, setTagInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const params = filterPlanId ? { tradePlanId: filterPlanId } : undefined;
        const response = await getReviews(params);
        setReviews(response.data);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Unable to load reviews.");
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, [filterPlanId]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError(null);

    try {
      const response = await createReview(form);
      setReviews((current) => [response.data, ...current]);
      setForm(initialForm);
      setTagInput("");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to create review.");
    } finally {
      setSaving(false);
    }
  };

  const addTag = () => {
    const tag = tagInput.trim();
    if (tag && !form.setupTags.includes(tag)) {
      setForm((current) => ({ ...current, setupTags: [...current.setupTags, tag] }));
      setTagInput("");
    }
  };

  const removeTag = (tag: string) => {
    setForm((current) => ({
      ...current,
      setupTags: current.setupTags.filter((t) => t !== tag)
    }));
  };

  return (
    <section className="board-grid">
      <div className="panel panel-large">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Live Board</p>
            <h3>Reviews</h3>
          </div>
          <div className="metric-chip">
            <span>{reviews.length}</span>
            <small>Total</small>
          </div>
        </div>

        {loading ? <p className="muted">Loading reviews...</p> : null}
        {error ? <p className="error-text">{error}</p> : null}

        <div className="card-stack">
          {reviews.map((review) => (
            <article key={review.id} className="record-card">
              <div className="record-topline">
                <strong>Review {review.id.slice(0, 8)}</strong>
                <span className="badge">Quality: {review.executionQuality}/5</span>
              </div>
              <p className="record-meta">Plan: {review.tradePlanId.slice(0, 8)}...</p>
              <p>
                <strong>Outcome:</strong> {review.outcome}
              </p>
              {review.attribution ? (
                <p>
                  <strong>Attribution:</strong> {review.attribution}
                </p>
              ) : null}
              {review.lesson ? (
                <p>
                  <strong>Lesson:</strong> {review.lesson}
                </p>
              ) : null}
              {review.setupTags.length > 0 ? (
                <div className="tag-row" style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                  {review.setupTags.map((tag) => (
                    <span key={tag} className="badge">
                      {tag}
                    </span>
                  ))}
                </div>
              ) : null}
            </article>
          ))}
        </div>
      </div>

      <form className="panel" onSubmit={handleSubmit}>
        <div className="panel-header">
          <div>
            <p className="eyebrow">Create Review</p>
            <h3>{prefillPlanLabel ? `Review for ${prefillPlanLabel}` : "New review entry"}</h3>
          </div>
        </div>

        <label className="field">
          <span>Trade Plan ID</span>
          <input
            value={form.tradePlanId}
            onChange={(event) =>
              setForm((current) => ({ ...current, tradePlanId: event.target.value }))
            }
            placeholder="Paste trade plan UUID"
          />
          {prefillPlanId ? (
            <small className="muted">Pre-filled from plan: {prefillPlanId.slice(0, 12)}...</small>
          ) : null}
        </label>

        <label className="field">
          <span>Outcome</span>
          <textarea
            value={form.outcome}
            onChange={(event) => setForm((current) => ({ ...current, outcome: event.target.value }))}
            placeholder="What happened. Win, loss, or scratch."
          />
        </label>

        <label className="field">
          <span>Attribution</span>
          <textarea
            value={form.attribution}
            onChange={(event) =>
              setForm((current) => ({ ...current, attribution: event.target.value }))
            }
            placeholder="Was the thesis right? Timing? Execution?"
          />
        </label>

        <label className="field">
          <span>Lesson</span>
          <textarea
            value={form.lesson}
            onChange={(event) => setForm((current) => ({ ...current, lesson: event.target.value }))}
            placeholder="What to do differently next time."
          />
        </label>

        <label className="field">
          <span>Execution quality (1-5)</span>
          <input
            type="number"
            min={1}
            max={5}
            value={form.executionQuality}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                executionQuality: Number(event.target.value)
              }))
            }
          />
        </label>

        <div className="field">
          <span>Setup tags</span>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              value={tagInput}
              onChange={(event) => setTagInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  addTag();
                }
              }}
              placeholder="Type tag and press Enter"
              style={{ flex: 1 }}
            />
            <button
              type="button"
              className="hero-link"
              style={{ padding: "8px 14px", fontSize: "0.85rem" }}
              onClick={addTag}
            >
              Add
            </button>
          </div>
          {form.setupTags.length > 0 ? (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
              {form.setupTags.map((tag) => (
                <span
                  key={tag}
                  className="badge"
                  onClick={() => removeTag(tag)}
                  style={{ cursor: "pointer" }}
                >
                  {tag} x
                </span>
              ))}
            </div>
          ) : null}
        </div>

        <button className="action-button" type="submit" disabled={saving}>
          {saving ? "Creating..." : "Create review"}
        </button>
      </form>
    </section>
  );
}
