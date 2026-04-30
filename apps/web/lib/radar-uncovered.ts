const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";
const WORKSPACE_SLUG = process.env.NEXT_PUBLIC_DEFAULT_WORKSPACE_SLUG ?? "primary-desk";

async function getMaybe<T>(path: string, fallback: T, accept?: (value: unknown) => value is T): Promise<T> {
  if (!API_BASE) return fallback;
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      credentials: "include",
      headers: { "x-workspace-slug": WORKSPACE_SLUG },
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`${response.status} ${path}`);
    const body = await response.json();
    const data = (body && typeof body === "object" && "data" in body) ? body.data : body;
    if (accept && !accept(data)) return fallback;
    return data as T;
  } catch (error) {
    console.warn("[radar-uncovered] mock fallback:", path, error);
    return fallback;
  }
}

async function postMaybe<TOut>(path: string, body: unknown, fallback: TOut): Promise<TOut> {
  if (!API_BASE) return fallback;
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", "x-workspace-slug": WORKSPACE_SLUG },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`${response.status} ${path}`);
    const payload = await response.json();
    return ((payload && typeof payload === "object" && "data" in payload) ? payload.data : payload) as TOut;
  } catch (error) {
    console.warn("[radar-uncovered] mock POST fallback:", path, error);
    return fallback;
  }
}

function isArray<T>(value: unknown): value is T[] {
  return Array.isArray(value);
}

export type ReviewItemType = "signal" | "theme" | "note";
export type ReviewAction = "ACCEPT" | "REJECT";

export type ReviewItem = {
  id: string;
  type: ReviewItemType;
  title: string;
  author: string;
  createdAgo: string;
  body: string;
  metadata: { label: string; value: string }[];
};

export type ReviewLogItem = {
  id: string;
  ts: string;
  reviewer: string;
  action: ReviewAction;
  itemId: string;
};

export type BriefTheme = {
  code: string;
  name: string;
  short: string;
  heat: number;
  dHeat: number;
  state: "LOCKED" | "TRACK" | "WATCH";
};

export type BriefIdea = {
  id: string;
  symbol: string;
  name: string;
  side: "LONG" | "TRIM" | "EXIT";
  confidence: number;
  themeCode: string;
};

export type DailyBriefRadar = {
  date: string;
  market: {
    state: "PRE-OPEN" | "OPEN" | "MIDDAY" | "POST-CLOSE";
    futuresNight: { last: number; chgPct: number };
    usMarket: { index: string; last: number; chgPct: number };
    usdTwd: number;
    vix: number;
    confidence: number;
  };
  overview: string[];
  themes: BriefTheme[];
  ideas: BriefIdea[];
  note: string;
};

export type ContentDraftStatus = "DRAFT" | "REVIEW" | "PUBLISHED" | "REJECTED";
export type ContentDraftType = "theme" | "signal" | "note";

export type ContentDraft = {
  id: string;
  type: ContentDraftType;
  title: string;
  author: string;
  status: ContentDraftStatus;
  updatedAt: string;
  body: string;
  source: string;
  version: number;
};

export type DraftAudit = {
  id: string;
  ts: string;
  actor: string;
  action: string;
  note: string;
};

export type QuoteInterval = "1m" | "5m" | "15m" | "1d";
export type QuoteStatus = {
  symbol: string;
  name: string;
  last: number;
  change: number;
  changePct: number;
  volume: number;
  bid: number;
  ask: number;
  high: number;
  low: number;
  open: number;
};

export type BidAskLevel = {
  level: number;
  bidQty: number;
  bidPrice: number;
  askPrice: number;
  askQty: number;
};

export type QuoteTick = {
  id: string;
  ts: string;
  price: number;
  qty: number;
  side: "B" | "S";
};

export type CompanyShort = {
  id: string;
  ticker: string;
  name: string;
  sector: string;
};

export type DuplicatePairStatus = "PENDING" | "RESOLVED" | "IGNORED";
export type DuplicatePair = {
  id: string;
  score: number;
  a: CompanyShort;
  b: CompanyShort;
  status: DuplicatePairStatus;
};

export const mockReviewQueue: ReviewItem[] = [
  {
    id: "REV-1042",
    type: "signal",
    title: "6504 南六量能突破與 PWR-GRD 連動",
    author: "OpenAlice",
    createdAgo: "T-08m",
    body: "南六今日量能放大，價格站回 5 日線。PWR-GRD 主題同步升溫，但流動性仍需人工覆核。",
    metadata: [
      { label: "SYMBOL", value: "6504" },
      { label: "THEME", value: "PWR-GRD" },
      { label: "CONF", value: "0.78" },
    ],
  },
  {
    id: "REV-1041",
    type: "theme",
    title: "AI-PWR rank-hold：成員新增 +1",
    author: "OpenAlice",
    createdAgo: "T-16m",
    body: "AI-PWR 熱度維持 94，新增一筆與先進封裝供應鏈相關成員，建議維持 LOCKED。",
    metadata: [
      { label: "THEME", value: "AI-PWR" },
      { label: "HEAT", value: "94" },
      { label: "STATE", value: "LOCKED" },
    ],
  },
  {
    id: "REV-1040",
    type: "note",
    title: "VIX-TW 回落，執行層風險預算維持",
    author: "Jason",
    createdAgo: "T-22m",
    body: "波動率降至 14.20，未觸發降槓桿條件。仍需確認午盤 liquidity window。",
    metadata: [
      { label: "SOURCE", value: "risk-note" },
      { label: "VIX-TW", value: "14.20" },
      { label: "MODE", value: "POST-CLOSE" },
    ],
  },
  {
    id: "REV-1039",
    type: "signal",
    title: "2376 DDR5 動能轉弱，trim candidate",
    author: "OpenAlice",
    createdAgo: "T-31m",
    body: "DDR5 pulse 連續下滑，2376 外資流向偏弱。建議標成 TRIM candidate，不直接送單。",
    metadata: [
      { label: "SYMBOL", value: "2376" },
      { label: "MOM", value: "DECEL" },
      { label: "ACTION", value: "TRIM" },
    ],
  },
  {
    id: "REV-1038",
    type: "theme",
    title: "ROBOT 關鍵詞群聚：humanoid / actuator",
    author: "OpenAlice",
    createdAgo: "T-44m",
    body: "ROBOT 關鍵詞簇增溫，4915 / 1503 被附著到同一供應鏈敘事。需人工確認是否過度延伸。",
    metadata: [
      { label: "THEME", value: "ROBOT" },
      { label: "MEMBERS", value: "14" },
      { label: "QUALITY", value: "MED" },
    ],
  },
  {
    id: "REV-1037",
    type: "note",
    title: "週計畫摘要：下週維持 post-close rhythm",
    author: "Elva",
    createdAgo: "T-57m",
    body: "保留收盤後掃描與早盤 briefing。quote / order 仍維持 operator gated。",
    metadata: [
      { label: "WEEK", value: "W17" },
      { label: "RUN", value: "RUN-218" },
      { label: "OWNER", value: "IUF-01" },
    ],
  },
];

export const mockReviewLog: ReviewLogItem[] = [
  { id: "ACT-09", ts: "14:28:11", reviewer: "IUF-01", action: "ACCEPT", itemId: "REV-1036" },
  { id: "ACT-08", ts: "14:17:42", reviewer: "ELVA", action: "REJECT", itemId: "REV-1035" },
  { id: "ACT-07", ts: "13:59:20", reviewer: "IUF-01", action: "ACCEPT", itemId: "REV-1034" },
  { id: "ACT-06", ts: "13:41:08", reviewer: "JASON", action: "ACCEPT", itemId: "REV-1033" },
];

export const mockBrief: DailyBriefRadar = {
  date: "2026-04-29",
  market: {
    state: "PRE-OPEN",
    futuresNight: { last: 21480, chgPct: 0.42 },
    usMarket: { index: "NASDAQ", last: 17892, chgPct: 0.68 },
    usdTwd: 32.14,
    vix: 14.2,
    confidence: 0.78,
  },
  overview: [
    "夜盤期貨小幅走高，AI server / 先進封裝仍是主軸。",
    "美股科技類股反彈，但台股開盤仍要看外資期貨淨部位。",
    "今日不放大槓桿，先確認 09:35 後的 liquidity window。",
  ],
  themes: [
    { code: "AI-PWR", name: "AI 算力供應鏈", short: "ai-power", heat: 94, dHeat: 6, state: "LOCKED" },
    { code: "HBM-TW", name: "HBM 先進封裝", short: "hbm-advpkg", heat: 91, dHeat: 9, state: "TRACK" },
    { code: "ROBOT", name: "人形機器人", short: "humanoid", heat: 82, dHeat: 12, state: "TRACK" },
  ],
  ideas: [
    { id: "ID-1142", symbol: "6504", name: "南六", side: "LONG", confidence: 0.78, themeCode: "PWR-GRD" },
    { id: "ID-1141", symbol: "2330", name: "台積電", side: "LONG", confidence: 0.74, themeCode: "AI-PWR" },
    { id: "ID-1138", symbol: "2376", name: "技嘉", side: "TRIM", confidence: 0.55, themeCode: "DDR5" },
  ],
  note: "Operator note：早盤只看前 30 分鐘，不追第一根紅 K。若 TAIEX 開高但量縮，讓 OpenAlice 只產生 review，不送 portfolio handoff。",
};

export const mockDrafts: ContentDraft[] = [
  { id: "DRF-2201", type: "theme", title: "AI-PWR 盤前摘要", author: "OpenAlice", status: "REVIEW", updatedAt: "2026-04-29T08:42:00+08:00", body: "AI-PWR heat 維持高檔，注意台積電與 HBM 封裝鏈外資流向。", source: "openalice-job-842", version: 3 },
  { id: "DRF-2200", type: "signal", title: "6504 南六量能突破", author: "OpenAlice", status: "DRAFT", updatedAt: "2026-04-29T08:31:00+08:00", body: "量能突破但流動性偏薄，需人工審核。", source: "openalice-job-839", version: 1 },
  { id: "DRF-2199", type: "note", title: "KGI quote freshness note", author: "Jason", status: "DRAFT", updatedAt: "2026-04-29T08:12:00+08:00", body: "KGI stream 延遲超過 5 秒時 quote badge 轉 STALE。", source: "manual", version: 1 },
  { id: "DRF-2198", type: "theme", title: "ROBOT keyword cluster", author: "OpenAlice", status: "PUBLISHED", updatedAt: "2026-04-28T15:16:00+08:00", body: "humanoid / actuator / controller 關鍵詞群聚。", source: "openalice-job-821", version: 2 },
  { id: "DRF-2197", type: "signal", title: "2376 DDR5 decel", author: "OpenAlice", status: "REVIEW", updatedAt: "2026-04-28T14:55:00+08:00", body: "DDR5 pulse -8，2376 trim candidate。", source: "openalice-job-818", version: 2 },
  { id: "DRF-2196", type: "note", title: "Risk budget weekly", author: "Elva", status: "PUBLISHED", updatedAt: "2026-04-28T10:33:00+08:00", body: "週風險預算維持 58%，不啟用自動送單。", source: "manual", version: 4 },
  { id: "DRF-2195", type: "theme", title: "PWR-GRD storage memo", author: "OpenAlice", status: "DRAFT", updatedAt: "2026-04-27T16:08:00+08:00", body: "電網重建與儲能鏈觀察。", source: "openalice-job-802", version: 1 },
  { id: "DRF-2194", type: "signal", title: "2454 momentum follow", author: "OpenAlice", status: "REVIEW", updatedAt: "2026-04-27T13:22:00+08:00", body: "聯發科動能延續但估值壓力需人工補註。", source: "openalice-job-797", version: 2 },
];

export const mockDraftAudit: DraftAudit[] = [
  { id: "AUD-01", ts: "08:42:10", actor: "OpenAlice", action: "UPDATE", note: "version 3 generated" },
  { id: "AUD-02", ts: "08:45:33", actor: "IUF-01", action: "ASSIGN", note: "assigned to ELVA" },
  { id: "AUD-03", ts: "08:52:01", actor: "ELVA", action: "COMMENT", note: "needs source link before publish" },
];

export const mockQuotes: Record<string, QuoteStatus> = {
  "2330": { symbol: "2330", name: "台積電", last: 1084, change: 19, changePct: 1.84, volume: 48213, bid: 1083, ask: 1084, high: 1090, low: 1064, open: 1068 },
  "2454": { symbol: "2454", name: "聯發科", last: 1420, change: 29, changePct: 2.11, volume: 10942, bid: 1415, ask: 1420, high: 1435, low: 1390, open: 1395 },
  "6504": { symbol: "6504", name: "南六", last: 84.2, change: 1.2, changePct: 1.45, volume: 3102, bid: 84.1, ask: 84.2, high: 85.1, low: 82.5, open: 82.9 },
  "2376": { symbol: "2376", name: "技嘉", last: 342, change: -3.8, changePct: -1.1, volume: 8812, bid: 341.5, ask: 342, high: 348, low: 340.5, open: 346 },
};

export function fallbackQuote(symbol: string): QuoteStatus {
  return mockQuotes[symbol] ?? { ...mockQuotes["2330"], symbol, name: "UNKNOWN" };
}

export function mockBidAsk(symbol: string): BidAskLevel[] {
  const quote = fallbackQuote(symbol);
  return Array.from({ length: 5 }, (_, i) => ({
    level: i + 1,
    bidQty: 18 - i * 2,
    bidPrice: Number((quote.bid - i * 0.5).toFixed(2)),
    askPrice: Number((quote.ask + i * 0.5).toFixed(2)),
    askQty: 14 + i * 3,
  }));
}

export function mockTicks(symbol: string): QuoteTick[] {
  const quote = fallbackQuote(symbol);
  return Array.from({ length: 50 }, (_, i) => {
    const drift = ((i % 7) - 3) * 0.2;
    return {
      id: `${symbol}-T-${i}`,
      ts: `14:${String(32 - Math.floor(i / 3)).padStart(2, "0")}:${String(58 - (i % 50)).padStart(2, "0")}`,
      price: Number((quote.last - drift).toFixed(2)),
      qty: 1 + (i % 8),
      side: i % 3 === 0 ? "S" : "B",
    };
  });
}

export const mockDuplicatePairs: DuplicatePair[] = [
  { id: "DUP-01", score: 0.94, a: { id: "cmp-2330-a", ticker: "2330", name: "台積電", sector: "Semiconductor" }, b: { id: "cmp-tsmc-b", ticker: "TSMC", name: "Taiwan Semiconductor", sector: "Semiconductor" }, status: "PENDING" },
  { id: "DUP-02", score: 0.89, a: { id: "cmp-2454-a", ticker: "2454", name: "聯發科", sector: "IC Design" }, b: { id: "cmp-mtk-b", ticker: "MTK", name: "MediaTek Inc.", sector: "IC Design" }, status: "PENDING" },
  { id: "DUP-03", score: 0.86, a: { id: "cmp-6504-a", ticker: "6504", name: "南六", sector: "Material" }, b: { id: "cmp-6504-b", ticker: "6504.TW", name: "Nan Liu Enterprise", sector: "Material" }, status: "PENDING" },
  { id: "DUP-04", score: 0.72, a: { id: "cmp-3008-a", ticker: "3008", name: "大立光", sector: "Optics" }, b: { id: "cmp-largan-b", ticker: "LARGAN", name: "Largan Precision", sector: "Optics" }, status: "RESOLVED" },
  { id: "DUP-05", score: 0.64, a: { id: "cmp-2376-a", ticker: "2376", name: "技嘉", sector: "Hardware" }, b: { id: "cmp-gbt-b", ticker: "GBT", name: "Giga-Byte", sector: "Hardware" }, status: "IGNORED" },
];

export const radarUncoveredApi = {
  reviewQueue: () => getMaybe<ReviewItem[]>("/api/v1/reviews", mockReviewQueue, isArray),
  review: (id: string) => Promise.resolve(mockReviewQueue.find((item) => item.id === id) ?? mockReviewQueue[0]),
  // W7 L6: reviewLog now points to /api/v1/reviews/log (new route) instead of
  // /api/v1/openalice/jobs (wrong shape). Graceful fallback to mockReviewLog preserved.
  reviewLog: () => getMaybe<ReviewLogItem[]>("/api/v1/reviews/log", mockReviewLog, isArray),
  reviewAction: (id: string, action: ReviewAction) =>
    postMaybe(`/api/v1/reviews/${encodeURIComponent(id)}/action`, { action }, { ok: true, id, action }),

  brief: () => getMaybe<DailyBriefRadar>("/api/v1/briefs", mockBrief),

  drafts: () => getMaybe<ContentDraft[]>("/api/v1/content-drafts", mockDrafts, isArray),
  adminDrafts: () => getMaybe<ContentDraft[]>("/api/v1/content-drafts", mockDrafts, isArray),
  adminDraft: (id: string) => Promise.resolve(mockDrafts.find((draft) => draft.id === id) ?? mockDrafts[0]),
  adminDraftAudit: (_id: string) => Promise.resolve(mockDraftAudit),
  adminDraftAction: (id: string, action: "APPROVE" | "REJECT" | "REASSIGN", payload?: unknown) =>
    postMaybe(`/api/v1/content-drafts/${encodeURIComponent(id)}/${action.toLowerCase()}`, payload ?? {}, { ok: true, id, action }),

  quoteStatus: (symbol: string) => getMaybe<QuoteStatus>(`/api/v1/kgi/quote/status?symbol=${encodeURIComponent(symbol)}`, fallbackQuote(symbol)),
  quoteBidask: (symbol: string) => getMaybe<BidAskLevel[]>(`/api/v1/kgi/quote/bidask?symbol=${encodeURIComponent(symbol)}`, mockBidAsk(symbol), isArray),
  quoteTicks: (symbol: string) => getMaybe<QuoteTick[]>(`/api/v1/kgi/quote/ticks?symbol=${encodeURIComponent(symbol)}&limit=50`, mockTicks(symbol), isArray),

  duplicatePairs: () => getMaybe<DuplicatePair[]>("/api/v1/companies/duplicates", mockDuplicatePairs, isArray),
  duplicatePair: (id: string) => Promise.resolve(mockDuplicatePairs.find((pair) => pair.id === id) ?? mockDuplicatePairs[0]),
  duplicateAction: (id: string, action: "MERGE" | "NOT_DUP" | "IGNORE", payload?: unknown) =>
    postMaybe(`/api/v1/companies/duplicates/${encodeURIComponent(id)}/action`, { action, payload }, { ok: true, id, action }),
};
