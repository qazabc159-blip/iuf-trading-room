import type { ContentDraftEntry, ContentDraftStatus } from "@/lib/api";

export const CONTENT_DRAFT_STATUSES: ContentDraftStatus[] = [
  "awaiting_review",
  "approved",
  "rejected",
];

export function contentDraftStatusLabel(status: ContentDraftStatus) {
  if (status === "awaiting_review") return "AWAITING REVIEW";
  return status.toUpperCase();
}

export function contentDraftStatusBadge(status: ContentDraftStatus) {
  if (status === "approved") return "badge-green";
  if (status === "rejected") return "badge-red";
  return "badge-yellow";
}

export function contentDraftTargetLabel(draft: ContentDraftEntry) {
  return draft.targetTable.replace(/_/g, " ").toUpperCase();
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringField(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function contentDraftTitle(draft: ContentDraftEntry) {
  const payload = asRecord(draft.payload);
  const explicit = stringField(payload, "title")
    ?? stringField(payload, "heading")
    ?? stringField(payload, "date")
    ?? stringField(payload, "marketState");
  if (explicit) return explicit;

  const body = contentDraftBody(draft);
  if (body) return body.length > 80 ? `${body.slice(0, 80)}...` : body;
  return contentDraftTargetLabel(draft);
}

export function contentDraftBody(draft: ContentDraftEntry) {
  const payload = asRecord(draft.payload);
  return stringField(payload, "summary")
    ?? stringField(payload, "note")
    ?? stringField(payload, "body")
    ?? null;
}

export function contentDraftPayloadText(draft: ContentDraftEntry) {
  return JSON.stringify(draft.payload, null, 2);
}
