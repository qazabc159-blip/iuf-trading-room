/**
 * ui-vocab.ts — shared UI wording / translation layer for the home + AI
 * recommendations + companies page cluster.
 *
 * Source: reports/product_critique_20260710/PRODUCT_CRITIQUE_v1.md, P1-1
 * ("工程語意大面積外洩" — raw backend field names, enum values, and literal
 * API endpoint strings leaking straight into UI copy, e.g. AI-generated risk
 * text containing `company_graph_db`, `dataAvailable=false`, `volumeRatio20d`,
 * `revenueYoyTrend為accelerating`, `get_company_news itemCount=0`; status
 * footers printing raw `GET /api/v1/...` strings).
 *
 * Product rule (repo CLAUDE.md): UI 禁工程語意 — this module is the single
 * place that knows how to turn known engineering fragments into 人話 so other
 * pages/components can reuse the same mapping instead of writing ad-hoc
 * regex per component. This batch wires it into the home page and
 * ai-recommendations' v3-view narrative pipeline; later batches touching
 * other pages can extend the tables below instead of re-inventing them.
 */

/** Honest fallback when a backend record is missing a display name. Never
 * repeat the ticker/id as a fake "name" (P1-12: ranking table used to show
 * "9110 9110" when the company name was absent). */
export const MISSING_COMPANY_NAME_LABEL = "名稱待補";

// Known raw field-name / debug tokens that have leaked into AI-generated
// narrative text (why_buy / risk / rationale strings from the v3
// recommendation engine). The engine's Chinese phrasing AROUND these tokens
// varies run to run (it's LLM-templated, e.g. "顯示 dataAvailable=false" one
// run vs "為 dataAvailable=false" the next — confirmed against live prod
// data, not just the critique's single captured screenshot) — so these are
// intentionally TOKEN-level replacements, not whole-clause pattern matches.
// A token-level swap can't produce perfectly fluent Chinese grammar, but it
// reliably removes every raw identifier regardless of the surrounding
// sentence, which is the actual product rule (UI 禁工程語意). More specific
// multi-token patterns are listed before their single-token fallback.
const NARRATIVE_JARGON_REPLACEMENTS: Array<[RegExp, string]> = [
  [/dataAvailable\s*=\s*false/gi, "尚未回傳"],
  [/dataAvailable\s*=\s*true/gi, "已回傳"],
  [/company_graph_db/gi, "產業鏈定位資料庫"],
  [/chainPosition/gi, "供應鏈定位"],
  [/beneficiaryTier/gi, "受惠層級"],
  [/get_company_news/gi, "個股新聞來源"],
  [/itemCount\s*=\s*0/gi, "查無新項目"],
  [/itemCount\s*=\s*(\d+)/gi, "共 $1 筆"],
  [/volumeRatio20d/gi, "20日均量比"],
  [/revenueYoyTrend\s*為\s*accelerating/gi, "營收年增趨勢轉強"],
  [/revenueYoyTrend\s*為\s*decelerating/gi, "營收年增趨勢轉弱"],
  [/revenueYoyTrend/gi, "營收年增趨勢"],
  // Bare English identifiers seen mixed directly into otherwise-Chinese
  // narrative sentences (e.g. "法人買超張數 trace 未提供，institutional 維持
  // 預設 8" — real prod text, 2026-07-11). Negative lookahead on `trace`
  // avoids double-handling `trace=...` clauses, which the caller strips
  // wholesale afterwards.
  [/\btrace\b(?!\s*=)/g, "資料軌跡"],
  [/\binstitutional\b/g, "法人資料"],
  [/\bthemes?\b/g, "主題"],
];

/** Translates known raw backend field-name fragments inside AI-generated
 * narrative text into human Chinese. Safe to call on any narrative string —
 * text with no matching fragment passes through unchanged. */
export function translateNarrativeJargon(value: string): string {
  let out = value;
  for (const [pattern, replacement] of NARRATIVE_JARGON_REPLACEMENTS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

// Known raw "METHOD /api/..." endpoint strings that have appeared directly in
// status-panel footers. Human labels describe WHAT the source is, never the
// literal route — callers should never fall through to printing `raw` as-is.
const ENDPOINT_LABELS: Record<string, string> = {
  "GET /api/v1/market-intel/news-top10": "AI 新聞精選來源",
  "GET /api/v1/market-intel/announcements": "官方重大訊息來源",
  "GET /api/v1/recommendations/today": "AI 推薦來源",
};

/** Turns a raw "METHOD /api/v1/..." endpoint string into a human source
 * label. Query strings are ignored for lookup purposes. Unknown endpoints
 * fall back to a generic "資料來源" rather than ever printing the route. */
export function humanizeEndpointLabel(raw: string | null | undefined): string {
  if (!raw) return "資料來源";
  const base = raw.split("?")[0]?.trim() ?? raw;
  return ENDPOINT_LABELS[base] ?? ENDPOINT_LABELS[raw] ?? "資料來源";
}
