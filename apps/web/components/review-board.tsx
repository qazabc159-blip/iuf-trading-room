"use client";

import { useEffect, useState } from "react";

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
  const [reviews, setReviews] = useState<ReviewEntry[]>([]);
  const [form, setForm] = useState<ReviewEntryCreateInput>(initialForm);
  const [tagInput, setTagInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const response = await getReviews();
        setReviews(response.data);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Unable to load reviews.");
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
              <p><strong>Outcome:</strong> {review.outcome}</p>
              {review.attribution ? <p><strong>Attribution:</strong> {review.attribution}</p> : null}
              {review.lesson ? <p><strong>Lesson:</strong> {review.lesson}</p> : null}
              {review.setupTags.length > 0 ? (
                <div className="tag-row">
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
            <h3>New review entry</h3>
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
          <div className="tag-input-row">
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
            />
            <button type="button" className="action-button-small" onClick={addTag}>
              Add
            </button>
          </div>
          {form.setupTags.length > 0 ? (
            <div className="tag-row">
              {form.setupTags.map((tag) => (
                <span key={tag} className="badge" onClick={() => removeTag(tag)} style={{ cursor: "pointer" }}>
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
