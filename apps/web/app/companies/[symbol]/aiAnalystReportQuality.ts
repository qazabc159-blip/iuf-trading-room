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

  const missingSections = COMPANY_AI_ANALYST_REQUIRED_SECTIONS.filter((section) => !md.includes(section));
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
