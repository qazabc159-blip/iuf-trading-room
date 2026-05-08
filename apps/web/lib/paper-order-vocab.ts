const RISK_DECISION_LABELS: Record<string, string> = {
  allow: "通過",
  warn: "提醒",
  block: "未通過",
};

const QUOTE_DECISION_LABELS: Record<string, string> = {
  allow: "可送出",
  review_accepted: "覆核已接受",
  review_required: "需要覆核",
  review_unusable: "覆核不可用",
  block: "未通過",
  quote_unknown: "報價未知",
};

const GUARD_LABELS: Record<string, string> = {
  account_equity: "帳戶權益",
  daily_loss: "單日損失上限",
  duplicate_intent: "重複委託防呆",
  kill_switch: "停止交易開關",
  max_absolute_notional: "模擬金額上限",
  max_order_notional: "單筆金額上限",
  position_limit: "部位上限",
  pre_trade: "送出前檢查",
  quote_gate: "報價門檻",
  stale_quote: "報價過舊",
  trading_hours: "交易時段",
  max_per_trade: "單筆風控上限",
  max_single_position: "單一部位上限",
};

const REASON_LABELS: Record<string, string> = {
  blocked: "未通過",
  decision_block: "報價決策未通過",
  decision_review_accepted: "報價覆核已接受",
  decision_review_not_usable: "報價覆核不可用",
  decision_review_required_override: "需要覆核或人工放行",
  missing_market_decision: "缺少市場決策輸出",
  missing_quote: "缺少報價",
  no_quote: "沒有可用報價",
  quote_unknown: "報價未知",
  stale_quote: "報價過舊",
};

const SOURCE_LABELS: Record<string, string> = {
  finmind: "FinMind",
  kgi: "凱基唯讀",
  ohlcv: "K 線資料",
  tej: "TEJ",
  twse: "臺灣證交所",
  tpex: "櫃買中心",
};

function normalize(value: string | null | undefined) {
  return String(value ?? "").trim().toLowerCase();
}

function humanizeIdentifier(value: string | null | undefined) {
  const raw = String(value ?? "").trim();
  if (!raw) return "未提供";
  return raw
    .replace(/^decision:/i, "")
    .replace(/[_-]+/g, " ")
    .trim();
}

export function paperRiskDecisionLabel(value: string | null | undefined) {
  const key = normalize(value);
  return RISK_DECISION_LABELS[key] ?? humanizeIdentifier(value);
}

export function paperQuoteDecisionLabel(value: string | null | undefined) {
  const key = normalize(value);
  return QUOTE_DECISION_LABELS[key] ?? humanizeIdentifier(value);
}

export function paperRiskGuardLabel(value: string | null | undefined) {
  const key = normalize(value);
  return GUARD_LABELS[key] ?? humanizeIdentifier(value);
}

export function paperQuoteSourceLabel(value: string | null | undefined) {
  const key = normalize(value);
  return SOURCE_LABELS[key] ?? humanizeIdentifier(value).toUpperCase();
}

export function paperGateReasonLabel(value: string | null | undefined) {
  const raw = String(value ?? "").trim();
  const key = normalize(raw.replace(/^decision:/i, "decision_"));
  return REASON_LABELS[key] ?? humanizeIdentifier(raw);
}

export function paperRiskMessageLabel(value: string | null | undefined) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";

  const outsideTradingHours = raw.match(/^Current time is outside allowed trading hours \((.+)\)\.$/i);
  if (outsideTradingHours) {
    return `目前不在允許交易時段（${outsideTradingHours[1]}），只能做風控檢查，不能送出委託。`;
  }

  const noQuote = raw.match(/^No quote available for (.+)\.$/i);
  if (noQuote) {
    return `目前沒有 ${noQuote[1]} 的正式報價；可檢查限價與風控，但不會把 FinMind / K 線當成交價。`;
  }

  if (/Order size exceeds the per-trade risk budget\./i.test(raw)) {
    return "委託金額超過單筆風控上限。";
  }

  if (/Resulting symbol exposure would exceed the single-position limit\./i.test(raw)) {
    return "送出後個股曝險會超過單一部位上限。";
  }

  const blocked = raw.match(/^Blocked by (.+)\.$/i);
  if (blocked) {
  return `未通過「${blocked[1].split(",").map((item) => paperRiskGuardLabel(item.trim())).join("、")}」。`;
  }

  const warned = raw.match(/^Allowed with warnings: (.+)\.$/i);
  if (warned) {
    return `通過，但「${warned[1].split(",").map((item) => paperRiskGuardLabel(item.trim())).join("、")}」有提醒。`;
  }

  return raw.replace(/\(override requested\)/gi, "（已要求覆核）");
}
