export type WebSurfaceKind = "external" | "owner" | "admin" | "support" | "legacy";

export type WebSurfaceDisposition =
  | "canonical"
  | "owner"
  | "internal"
  | "secondary"
  | "grouped"
  | "redirect"
  | "frame"
  | "auth";

export type WebSurface = {
  path: string;
  title: string;
  shortTitle: string;
  sub: string;
  kind: WebSurfaceKind;
  disposition: WebSurfaceDisposition;
  activePaths: readonly string[];
  commandCode?: string;
  commandSub?: string;
  replacementPath?: string;
  note?: string;
};

export const CANONICAL_PRODUCT_SURFACES = [
  {
    path: "/",
    title: "戰情台",
    shortTitle: "戰情",
    sub: "今日總覽",
    kind: "external",
    disposition: "canonical",
    activePaths: ["/"],
    commandCode: "01",
    commandSub: "大盤、觀察清單、重大訊息與策略總覽",
  },
  {
    path: "/market-intel",
    title: "市場情報",
    shortTitle: "情報",
    sub: "AI 精選",
    kind: "external",
    disposition: "canonical",
    activePaths: ["/market-intel"],
    commandCode: "02",
    commandSub: "公司公告、新聞線索與市場情報",
  },
  {
    path: "/ai-recommendations",
    title: "AI 推薦",
    shortTitle: "推薦",
    sub: "推薦股票",
    kind: "external",
    disposition: "canonical",
    activePaths: ["/ai-recommendations", "/ideas", "/runs", "/signals"],
    commandCode: "03",
    commandSub: "今日推薦、觀察名單與風控分層",
  },
  {
    path: "/portfolio",
    title: "交易室",
    shortTitle: "交易",
    sub: "Paper / SIM",
    kind: "external",
    disposition: "canonical",
    activePaths: ["/portfolio", "/plans"],
    commandCode: "04",
    commandSub: "模擬資金、部位、委託、成交與風控",
  },
  {
    path: "/companies",
    title: "公司 / 主題",
    shortTitle: "公司",
    sub: "公司雷達",
    kind: "external",
    disposition: "canonical",
    activePaths: ["/companies", "/themes"],
    commandCode: "05",
    commandSub: "公司池、主題板、產業鏈與 K 線",
  },
  {
    path: "/quant-strategies",
    title: "量化策略",
    shortTitle: "策略",
    sub: "SIM-only",
    kind: "external",
    disposition: "canonical",
    activePaths: ["/quant-strategies"],
    commandCode: "06",
    commandSub: "Athena strategy input 與 SIM-only 訂閱",
  },
] as const satisfies readonly WebSurface[];

export const OWNER_PRODUCT_SURFACES = [
  {
    path: "/ops/f-auto",
    title: "F-AUTO SIM",
    shortTitle: "F-AUTO",
    sub: "S1 持倉 / 損益",
    kind: "owner",
    disposition: "owner",
    activePaths: ["/ops/f-auto"],
  },
] as const satisfies readonly WebSurface[];

export const INTERNAL_ADMIN_SURFACES = [
  {
    path: "/admin/brain/llm",
    title: "Brain",
    shortTitle: "Brain",
    sub: "AI 費用與模型",
    kind: "admin",
    disposition: "internal",
    activePaths: ["/admin/brain/llm"],
  },
  {
    path: "/admin/brain/decisions",
    title: "主腦決策",
    shortTitle: "決策",
    sub: "決策流",
    kind: "admin",
    disposition: "internal",
    activePaths: ["/admin/brain/decisions"],
  },
  {
    path: "/admin/events",
    title: "EventLog",
    shortTitle: "事件",
    sub: "事件流",
    kind: "admin",
    disposition: "internal",
    activePaths: ["/admin/events"],
  },
  {
    path: "/admin/portfolio/snapshots",
    title: "Portfolio",
    shortTitle: "快照",
    sub: "快照版本",
    kind: "admin",
    disposition: "internal",
    activePaths: ["/admin/portfolio/snapshots"],
  },
  {
    path: "/admin/tools",
    title: "Tools",
    shortTitle: "工具",
    sub: "工具登錄",
    kind: "admin",
    disposition: "internal",
    activePaths: ["/admin/tools"],
  },
  {
    path: "/admin/uta/accounts",
    title: "UTA",
    shortTitle: "UTA",
    sub: "帳號管理",
    kind: "admin",
    disposition: "internal",
    activePaths: ["/admin/uta"],
  },
  {
    path: "/admin/strategies",
    title: "Strategies",
    shortTitle: "策略",
    sub: "策略治理",
    kind: "admin",
    disposition: "internal",
    activePaths: ["/admin/strategies"],
  },
  {
    path: "/admin/team",
    title: "團隊與邀請",
    shortTitle: "團隊",
    sub: "用戶 / 邀請管理",
    kind: "admin",
    disposition: "internal",
    activePaths: ["/admin/team"],
  },
] as const satisfies readonly WebSurface[];

export const SECONDARY_ADMIN_SURFACES = [
  {
    path: "/admin/content-drafts",
    title: "內容草稿",
    shortTitle: "草稿",
    sub: "審核流程",
    kind: "admin",
    disposition: "secondary",
    activePaths: ["/admin/content-drafts"],
  },
  {
    path: "/admin/invites",
    title: "邀請管理",
    shortTitle: "邀請",
    sub: "註冊邀請",
    kind: "admin",
    disposition: "secondary",
    activePaths: ["/admin/invites"],
  },
] as const satisfies readonly WebSurface[];

export const SUPPORT_WEB_SURFACES = [
  {
    path: "/settings",
    title: "設定中心",
    shortTitle: "設定",
    sub: "帳號、券商與訂閱",
    kind: "support",
    disposition: "secondary",
    activePaths: ["/settings"],
  },
  {
    path: "/settings/account",
    title: "帳號設定",
    shortTitle: "帳號",
    sub: "登入與個人資料",
    kind: "support",
    disposition: "secondary",
    activePaths: ["/settings/account"],
  },
  {
    path: "/settings/broker",
    title: "券商連線",
    shortTitle: "券商",
    sub: "真金 gateway 配對",
    kind: "support",
    disposition: "secondary",
    activePaths: ["/settings/broker"],
  },
  {
    path: "/settings/subscription",
    title: "方案與權限",
    shortTitle: "方案",
    sub: "訂閱狀態",
    kind: "support",
    disposition: "secondary",
    activePaths: ["/settings/subscription"],
  },
  {
    path: "/briefs",
    title: "AI 每日簡報",
    shortTitle: "簡報",
    sub: "OpenAlice 簡報列表",
    kind: "support",
    disposition: "secondary",
    activePaths: ["/briefs"],
  },
  {
    path: "/alerts",
    title: "警示",
    shortTitle: "警示",
    sub: "風控提醒與警示紀錄",
    kind: "support",
    disposition: "secondary",
    activePaths: ["/alerts"],
  },
  {
    path: "/login",
    title: "登入",
    shortTitle: "登入",
    sub: "帳號入口",
    kind: "support",
    disposition: "auth",
    activePaths: ["/login"],
  },
  {
    path: "/register",
    title: "註冊",
    shortTitle: "註冊",
    sub: "邀請註冊",
    kind: "support",
    disposition: "auth",
    activePaths: ["/register"],
  },
  {
    path: "/m",
    title: "行動入口",
    shortTitle: "行動",
    sub: "手機版觀察",
    kind: "support",
    disposition: "secondary",
    activePaths: ["/m"],
  },
  {
    path: "/final-v031/market-intel",
    title: "Final v031 市場情報",
    shortTitle: "v031 情報",
    sub: "正式頁框架",
    kind: "support",
    disposition: "frame",
    activePaths: ["/final-v031/market-intel"],
  },
  {
    path: "/final-v031/ideas",
    title: "Final v031 AI 推薦",
    shortTitle: "v031 推薦",
    sub: "正式頁框架",
    kind: "support",
    disposition: "frame",
    activePaths: ["/final-v031/ideas"],
  },
  {
    path: "/final-v031/portfolio",
    title: "Final v031 交易室",
    shortTitle: "v031 交易",
    sub: "正式頁框架",
    kind: "support",
    disposition: "frame",
    activePaths: ["/final-v031/portfolio"],
  },
] as const satisfies readonly WebSurface[];

export const LEGACY_WEB_SURFACES = [
  {
    path: "/ideas",
    title: "策略推薦舊入口",
    shortTitle: "舊推薦",
    sub: "已併入 AI 推薦",
    kind: "legacy",
    disposition: "redirect",
    activePaths: ["/ideas"],
    replacementPath: "/ai-recommendations",
    note: "保留 301 與深連結相容，不列為正式導航。",
  },
  {
    path: "/runs",
    title: "策略批次",
    shortTitle: "批次",
    sub: "AI 推薦子頁",
    kind: "legacy",
    disposition: "grouped",
    activePaths: ["/runs"],
    replacementPath: "/ai-recommendations",
    note: "批次清單與詳情可深連結，但入口收斂到 AI 推薦。",
  },
  {
    path: "/signals",
    title: "訊號證據",
    shortTitle: "訊號",
    sub: "AI 推薦子頁",
    kind: "legacy",
    disposition: "grouped",
    activePaths: ["/signals"],
    replacementPath: "/ai-recommendations",
  },
  {
    path: "/plans",
    title: "交易計畫",
    shortTitle: "計畫",
    sub: "交易室子頁",
    kind: "legacy",
    disposition: "grouped",
    activePaths: ["/plans"],
    replacementPath: "/portfolio",
  },
  {
    path: "/themes",
    title: "主題戰區",
    shortTitle: "主題",
    sub: "公司 / 主題子頁",
    kind: "legacy",
    disposition: "grouped",
    activePaths: ["/themes"],
    replacementPath: "/companies",
  },
  {
    path: "/quote",
    title: "即時報價",
    shortTitle: "報價",
    sub: "公司頁報價子功能",
    kind: "legacy",
    disposition: "grouped",
    activePaths: ["/quote"],
    replacementPath: "/companies",
  },
  {
    path: "/reviews",
    title: "交易檢討",
    shortTitle: "檢討",
    sub: "週檢討歷史頁",
    kind: "legacy",
    disposition: "secondary",
    activePaths: ["/reviews"],
    replacementPath: "/portfolio",
    note: "保留歷史檢視，不列為正式導航。",
  },
  {
    path: "/drafts",
    title: "草稿審核",
    shortTitle: "草稿",
    sub: "內容草稿舊入口",
    kind: "legacy",
    disposition: "grouped",
    activePaths: ["/drafts"],
    replacementPath: "/admin/content-drafts",
  },
  {
    path: "/lab",
    title: "Lab 舊入口",
    shortTitle: "Lab",
    sub: "已併入量化策略",
    kind: "legacy",
    disposition: "redirect",
    activePaths: ["/lab"],
    replacementPath: "/quant-strategies",
    note: "全節點 301 到量化策略。",
  },
  {
    path: "/ops",
    title: "系統戰情舊入口",
    shortTitle: "Ops",
    sub: "已收斂到 F-AUTO SIM",
    kind: "legacy",
    disposition: "grouped",
    activePaths: ["/ops"],
    replacementPath: "/ops/f-auto",
  },
] as const satisfies readonly WebSurface[];

export const ALL_WEB_SURFACES = [
  ...CANONICAL_PRODUCT_SURFACES,
  ...OWNER_PRODUCT_SURFACES,
  ...INTERNAL_ADMIN_SURFACES,
  ...SECONDARY_ADMIN_SURFACES,
  ...SUPPORT_WEB_SURFACES,
  ...LEGACY_WEB_SURFACES,
] as const satisfies readonly WebSurface[];

export const PRODUCT_COMMAND_SURFACES = CANONICAL_PRODUCT_SURFACES;
