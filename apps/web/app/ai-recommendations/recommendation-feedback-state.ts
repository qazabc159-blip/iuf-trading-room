export type RecommendationFeedbackReaction = "like" | "dislike" | "skip" | "acted";
export type RecommendationFeedbackSnapshotStatus = "queued" | "saved";

export type RecommendationFeedbackSnapshot = {
  recommendationId: string;
  reaction: RecommendationFeedbackReaction;
  status: RecommendationFeedbackSnapshotStatus;
  updatedAt: number;
};

export const RECOMMENDATION_FEEDBACK_EVENT = "iuf:recommendation-feedback";

const STORAGE_PREFIX = "iuf:recommendation-feedback:";

function storageKey(recommendationId: string) {
  return `${STORAGE_PREFIX}${recommendationId}`;
}

function isReaction(value: unknown): value is RecommendationFeedbackReaction {
  return value === "like" || value === "dislike" || value === "skip" || value === "acted";
}

function isSnapshotStatus(value: unknown): value is RecommendationFeedbackSnapshotStatus {
  return value === "queued" || value === "saved";
}

function normalizeSnapshot(value: unknown, recommendationId: string): RecommendationFeedbackSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const snapshot = value as Partial<RecommendationFeedbackSnapshot>;
  if (snapshot.recommendationId !== recommendationId) return null;
  if (!isReaction(snapshot.reaction)) return null;
  if (!isSnapshotStatus(snapshot.status)) return null;
  return {
    recommendationId,
    reaction: snapshot.reaction,
    status: snapshot.status,
    updatedAt: typeof snapshot.updatedAt === "number" ? snapshot.updatedAt : Date.now(),
  };
}

export function readRecommendationFeedbackSnapshot(recommendationId: string): RecommendationFeedbackSnapshot | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(storageKey(recommendationId));
    if (!raw) return null;
    return normalizeSnapshot(JSON.parse(raw), recommendationId);
  } catch {
    return null;
  }
}

export function writeRecommendationFeedbackSnapshot(
  recommendationId: string,
  reaction: RecommendationFeedbackReaction,
  status: RecommendationFeedbackSnapshotStatus,
) {
  const snapshot: RecommendationFeedbackSnapshot = {
    recommendationId,
    reaction,
    status,
    updatedAt: Date.now(),
  };

  if (typeof window !== "undefined") {
    try {
      window.sessionStorage.setItem(storageKey(recommendationId), JSON.stringify(snapshot));
    } catch {
      // Session storage can be disabled; the in-page event still keeps the UI responsive.
    }
  }

  return snapshot;
}

export function emitRecommendationFeedbackSnapshot(
  recommendationId: string,
  reaction: RecommendationFeedbackReaction,
  status: RecommendationFeedbackSnapshotStatus,
) {
  if (typeof window === "undefined") return;
  const snapshot = writeRecommendationFeedbackSnapshot(recommendationId, reaction, status);
  window.dispatchEvent(new CustomEvent<RecommendationFeedbackSnapshot>(RECOMMENDATION_FEEDBACK_EVENT, { detail: snapshot }));
}
