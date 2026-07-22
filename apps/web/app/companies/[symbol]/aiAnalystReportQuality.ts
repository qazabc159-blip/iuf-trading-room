import {
  COMPANY_AI_ANALYST_MAX_DATA_GAP_SENTENCES,
  COMPANY_AI_ANALYST_MIN_NUMERIC_FACTS,
  COMPANY_AI_ANALYST_MIN_SOURCE_MENTIONS,
  COMPANY_AI_ANALYST_REQUIRED_SECTIONS,
} from "./aiAnalystReportContract";

const ENGINEERING_REPORT_LEAK_PATTERNS = [
  /\bget_market_overview\b/i,
  /\bget_news_top10\b/i,
  /\bget_company_technical\b/i,
  /\bget_institutional_flow\b/i,
  /\btoo_short\b/i,
  /\bgeneric_data_gap_reason\b/i,
  /\bgeneric_placeholder_line\b/i,
  /\brun_id\b/i,
  /\bprompt_tokens\b/i,
  /\bcompletion_tokens\b/i,
  /\bsource dump\b/i,
  /\braw dump\b/i,
  /\btool\s*[_-]?call\b/i,
];

export interface CompanyAiReportQuality {
  ok: boolean;
  reason:
    | "empty"
    | "engineering_leak"
    | "missing_sections"
    | "quality_protected"
    | "low_substance"
    | "ok";
  blockedTerms: string[];
}

// SYNC SOURCE — DO NOT let this drift silently:
// apps/api/src/brain/react-loop.ts:91-101 (`COMPANY_AI_ANALYST_REQUIRED_SECTION_PATTERNS`)
// is the single authority for "does this report contain section N". The backend
// synthesizer already validates against these lenient regexes before it ever
// marks a report as passed (`validateSynthesisSections`, react-loop.ts:1038 call
// site). This file used to re-check with a strict literal `.includes(section)`
// against `COMPANY_AI_ANALYST_REQUIRED_SECTIONS` (a *prompt/display* string, not
// a validator) — any whitespace/punctuation variance in a backend-approved real
// LLM report (e.g. no space after "##", extra space before the period) would be
// re-blocked here at display time, hiding a real report behind an empty gate
// state. Fixed 2026-07-22 (AI_PIPELINE_DIAGNOSIS_20260722.md). Backend gate is
// NOT touched by this change — this is a frontend-only copy kept in parity by
// the "gate parity" test in ai-analyst-report-panel.test.ts, which reads the
// backend source file directly and fails CI if the two arrays diverge.
export const COMPANY_AI_ANALYST_REQUIRED_SECTION_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /##\s*1[.\s]*公司概況與定位/u, label: COMPANY_AI_ANALYST_REQUIRED_SECTIONS[0] },
  { pattern: /##\s*2[.\s]*今日\/最近資料狀態/u, label: COMPANY_AI_ANALYST_REQUIRED_SECTIONS[1] },
  { pattern: /##\s*3[.\s]*近期事件與新聞/u, label: COMPANY_AI_ANALYST_REQUIRED_SECTIONS[2] },
  { pattern: /##\s*4[.\s]*技術結構/u, label: COMPANY_AI_ANALYST_REQUIRED_SECTIONS[3] },
  { pattern: /##\s*5[.\s]*籌碼與法人/u, label: COMPANY_AI_ANALYST_REQUIRED_SECTIONS[4] },
  { pattern: /##\s*6[.\s]*主題與產業鏈位置/u, label: COMPANY_AI_ANALYST_REQUIRED_SECTIONS[5] },
  { pattern: /##\s*7[.\s]*主要風險/u, label: COMPANY_AI_ANALYST_REQUIRED_SECTIONS[6] },
  { pattern: /##\s*8[.\s]*AI\s*結論與觀察等級/u, label: COMPANY_AI_ANALYST_REQUIRED_SECTIONS[7] },
  { pattern: /##\s*9[.\s]*資料來源與生成時間/u, label: COMPANY_AI_ANALYST_REQUIRED_SECTIONS[8] },
];

const DATA_GAP_PATTERNS = [
  /資料不足/g,
  /缺(?:少|乏)?資料/g,
  /尚未(?:回傳|取得|生成)/g,
  /無法(?:判斷|分析|讀取)/g,
  /未提供/g,
  /待(?:補|回傳|生成|確認)/g,
];

const SOURCE_MENTION_PATTERNS = [
  /即時行情|報價|quote/i,
  /日\s*K|K\s*線|ohlcv|kbar/i,
  /成交量|量價|成交值/i,
  /新聞|重大訊息|公告|MOPS|TWSE/i,
  /三大法人|法人|institutional/i,
  /融資融券|margin/i,
  /財報|營收|EPS|FinMind/i,
  /KGI|券商|唯讀/i,
  /主題|產業鏈|供應鏈/i,
];

function countMatches(md: string, patterns: RegExp[]): number {
  return patterns.reduce((sum, pattern) => {
    const matches = md.match(pattern);
    return sum + (matches?.length ?? 0);
  }, 0);
}

function countNumericFacts(md: string): number {
  const matches = md.match(/(?:\d{4}[/-]\d{1,2}[/-]\d{1,2}|\d+(?:\.\d+)?\s*(?:%|元|億|萬|張|股|日|筆|倍|美元|USD)?)/g);
  return matches?.length ?? 0;
}

function countSourceMentions(md: string): number {
  return SOURCE_MENTION_PATTERNS.filter((pattern) => pattern.test(md)).length;
}

export function assessCompanyAiReportQuality(reportMd: string | null | undefined): CompanyAiReportQuality {
  const md = reportMd?.trim() ?? "";
  if (!md) return { ok: false, reason: "empty", blockedTerms: [] };

  const blockedTerms = ENGINEERING_REPORT_LEAK_PATTERNS
    .filter((pattern) => pattern.test(md))
    .map((pattern) => pattern.source.replaceAll("\\b", "").replaceAll("\\s*", " "));

  if (blockedTerms.length > 0) {
    return { ok: false, reason: "engineering_leak", blockedTerms };
  }

  if (md.includes("品質保護版") || md.includes("保守分析版")) {
    return { ok: false, reason: "quality_protected", blockedTerms: [] };
  }

  const missingSections = COMPANY_AI_ANALYST_REQUIRED_SECTION_PATTERNS
    .filter(({ pattern }) => !pattern.test(md))
    .map(({ label }) => label);
  if (missingSections.length > 0) {
    return { ok: false, reason: "missing_sections", blockedTerms: missingSections };
  }

  const dataGapSentences = countMatches(md, DATA_GAP_PATTERNS);
  const numericFacts = countNumericFacts(md);
  const sourceMentions = countSourceMentions(md);
  const lowSubstanceReasons = [
    dataGapSentences > COMPANY_AI_ANALYST_MAX_DATA_GAP_SENTENCES ? `資料缺口句過多：${dataGapSentences}` : null,
    numericFacts < COMPANY_AI_ANALYST_MIN_NUMERIC_FACTS ? `可驗證數字不足：${numericFacts}` : null,
    sourceMentions < COMPANY_AI_ANALYST_MIN_SOURCE_MENTIONS ? `來源類型不足：${sourceMentions}` : null,
  ].filter((reason): reason is string => Boolean(reason));
  if (lowSubstanceReasons.length > 0) {
    return { ok: false, reason: "low_substance", blockedTerms: lowSubstanceReasons };
  }

  return { ok: true, reason: "ok", blockedTerms: [] };
}
