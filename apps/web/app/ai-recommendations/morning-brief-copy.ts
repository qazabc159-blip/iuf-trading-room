/**
 * morning-brief-copy.ts
 * ──────────────────────
 * Pure presentational helpers for the "AI 投研晨報" (AI recommendations v2
 * redesign, reports/design_redesign_20260722/drafts/ai_rec_redesign_v2.html).
 * No React, no fetch — kept separate from page.tsx so it is unit-testable
 * and so the newspaper layout components stay thin.
 *
 * These functions only *reshape display* of already-live data produced by
 * v3-view.ts's mapV3ItemToStockRecCard(); they must never invent numbers or
 * boilerplate text that isn't derived from a real field (AI_REC_IMPL_FIELD_
 * MAP_20260723.md documents which design-draft fields have no backend
 * equivalent and were dropped rather than faked).
 *
 * Dropped from the design draft (not implemented here): the 頭版 "deck"
 * one-line abstract. Tried deriving it as "first 。-delimited sentence of
 * why_buy" and caught (via a local seeded-DB render, not just code review)
 * that real AI narrative paragraphs often only contain one 。 at the very
 * end — the "first sentence" then equals the entire first paragraph,
 * rendering as a verbatim duplicate immediately above it. The design
 * draft's deck text is a distinct hand-written abstract, not mechanically
 * derivable from why_buy; no such field exists on AiRecommendationV3Item.
 */

const RANK_LABELS = ["序位第一", "貳", "叁", "肆", "伍"] as const;

/** 序位標籤：0-based index → 頭版特稿「序位第一」/ 內頁「貳」「叁」「肆」「伍」 */
export function rankLabel(index: number): string {
  return RANK_LABELS[index] ?? `第 ${index + 1} 名`;
}

/** 敘事文字按換行切成段落（既有 joinLines() 用 \n 合併多筆來源） */
export function splitParagraphs(text: string | null | undefined): string[] {
  if (!text) return [];
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

/** 版次日期 — 從 "MM/DD HH:mm" 格式的 timestamp label 取日期段 */
export function editionDateLabel(timestampLabel: string): string {
  const datePart = timestampLabel.split(" ")[0]?.trim();
  if (!datePart || datePart === "-") return "--";
  return `${datePart} 收盤`;
}

export type OfficialAnnouncementState = "live" | "empty" | "degraded" | "pending" | string;

/** 官方公告狀態 → 天頭/band 顯示字 */
export function officialAnnouncementLabel(state: OfficialAnnouncementState): string {
  if (state === "live") return "已納入";
  if (state === "empty") return "已檢查無公告";
  if (state === "degraded") return "降級";
  if (state === "pending") return "待接入";
  return "待確認";
}

/** 生成狀態 → band 顯示字 */
export function generationStatusLabel(status: string | null | undefined): string {
  return status === "complete" ? "完成" : "需留意";
}

// ── 數字格式化（沿用 StockRecCard.tsx 同款規則，避免同頁兩套格式化邏輯打架）──

export function fmtPrice(value: number | null | undefined): string {
  if (value == null) return "--";
  return value.toLocaleString("zh-TW", { maximumFractionDigits: 2 });
}

export function fmtScore(value: number | null | undefined, max: number): string {
  if (value == null) return "--";
  return `${value}/${max}`;
}

export function fmtConfidence(value: number | null | undefined): string {
  if (value == null) return "--";
  return `${Math.round(value * 100)}%`;
}

export function fmtRValue(value: number | null | undefined): string {
  if (value == null) return "--";
  return `${value.toFixed(2)}R`;
}

export function fmtMultiplier(value: number | null | undefined): string {
  if (value == null) return "--";
  return String(value);
}

// ── 七維評分列定義（沿用 StockRecCard.tsx SUB_SCORE_ROWS 同一套配分規則，
//    頭版/內頁兩種版面共用同一份定義，避免兩處各自寫一份配分表漂移） ──

export type SubScoreKey =
  | "theme_position"
  | "revenue_earnings"
  | "institutional_etf"
  | "margin_short"
  | "rs_volume"
  | "technical_structure"
  | "valuation_event";

export const SUB_SCORE_ROWS: Array<{ key: SubScoreKey; label: string; max: number }> = [
  { key: "theme_position", label: "題材", max: 20 },
  { key: "revenue_earnings", label: "營收", max: 15 },
  { key: "institutional_etf", label: "法人 / ETF", max: 15 },
  { key: "margin_short", label: "籌碼", max: 15 },
  { key: "rs_volume", label: "RS / 量", max: 10 },
  { key: "technical_structure", label: "技術", max: 20 },
  { key: "valuation_event", label: "估值 / 事件", max: 5 },
];
