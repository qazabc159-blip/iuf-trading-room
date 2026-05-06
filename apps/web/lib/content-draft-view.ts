import type { ContentDraftEntry, ContentDraftStatus } from "@/lib/api";

export const CONTENT_DRAFT_STATUSES: ContentDraftStatus[] = [
  "awaiting_review",
  "approved",
  "rejected",
];

export function contentDraftStatusLabel(status: ContentDraftStatus) {
  if (status === "awaiting_review") return "待審";
  if (status === "approved") return "已核准";
  if (status === "rejected") return "已退回";
  return status;
}

export function contentDraftStatusBadge(status: ContentDraftStatus) {
  if (status === "approved") return "badge-green";
  if (status === "rejected") return "badge-red";
  return "badge-yellow";
}

export function contentDraftTargetLabel(draft: ContentDraftEntry) {
  const labels: Record<string, string> = {
    daily_briefs: "每日簡報",
    themes: "主題資料",
    theme_summaries: "主題摘要",
    signals: "訊號證據",
    companies: "公司資料",
    company_notes: "公司備註",
    trade_plans: "交易計畫",
    reviews: "審核紀錄",
  };
  return labels[draft.targetTable] ?? draft.targetTable.replace(/_/g, " ");
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

function arrayField(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return Array.isArray(value) ? value : [];
}

export function contentDraftPayloadRecord(draft: ContentDraftEntry) {
  return asRecord(draft.payload);
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

export function contentDraftMarketState(draft: ContentDraftEntry) {
  const payload = asRecord(draft.payload);
  return stringField(payload, "marketState");
}

export function contentDraftDate(draft: ContentDraftEntry) {
  const payload = asRecord(draft.payload);
  return stringField(payload, "date");
}

export function contentDraftSections(draft: ContentDraftEntry) {
  const payload = asRecord(draft.payload);
  return arrayField(payload, "sections")
    .map((item) => asRecord(item))
    .map((item) => ({
      heading: stringField(item, "heading") ?? "未命名段落",
      body: stringField(item, "body") ?? "",
    }))
    .filter((item) => item.heading || item.body);
}

export function contentDraftReviewActor(draft: ContentDraftEntry) {
  if (draft.reviewedBy) return draft.reviewedBy;
  if (draft.status === "approved" || draft.status === "rejected") return "AI reviewer / system";
  return "尚未審核";
}

export function contentDraftReviewNote(draft: ContentDraftEntry) {
  if (draft.status === "awaiting_review") {
    return "等待 AI reviewer 或 Owner fallback 審核；尚未寫入正式資料表。";
  }
  if (draft.status === "approved") {
    return draft.approvedRefId
      ? `已核准並寫入正式資料：${draft.approvedRefId}`
      : "已核准，正式資料 id 尚未回傳。";
  }
  return draft.rejectReason ?? "已退回；未提供退回原因。";
}

export function contentDraftPayloadText(draft: ContentDraftEntry) {
  return JSON.stringify(draft.payload, null, 2);
}
