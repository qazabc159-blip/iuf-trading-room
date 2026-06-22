import type { ContentDraftEntry } from "@/lib/api";

export type TodayDraftOutcome =
  | "none"
  | "awaiting_review"
  | "approved_unpublished"
  | "rejected";

function draftTime(draft: ContentDraftEntry) {
  return Date.parse(draft.updatedAt ?? draft.createdAt);
}

export function latestTodayDraftOutcome(drafts: ContentDraftEntry[]): TodayDraftOutcome {
  const latest = [...drafts].sort((left, right) => draftTime(right) - draftTime(left))[0];
  if (!latest) return "none";
  if (latest.status === "awaiting_review") return "awaiting_review";
  if (latest.status === "approved") return "approved_unpublished";
  return "rejected";
}
