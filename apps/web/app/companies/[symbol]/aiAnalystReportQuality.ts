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
  reason: "empty" | "engineering_leak" | "quality_protected" | "ok";
  blockedTerms: string[];
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

  return { ok: true, reason: "ok", blockedTerms: [] };
}
