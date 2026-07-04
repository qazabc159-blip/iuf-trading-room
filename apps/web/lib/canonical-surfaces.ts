import type { SessionUser } from "@iuf-trading-room/contracts";

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

/** Workspace role name, kept aligned with `sessionUserSchema` in packages/contracts. */
export type WorkspaceRole = SessionUser["role"];

/**
 * Strict ladder rank table — permission matrix v1 D1 (`reports/permission_matrix/PERMISSION_MATRIX_v1.md`).
 * Must stay numerically identical to `ROLE_RANK` in `apps/api/src/auth/require-min-role.ts`
 * (front/back rank tables are two independent copies by design — web has no import path into
 * apps/api/src — but the *numbers* must never drift).
 */
export const ROLE_RANK: Record<WorkspaceRole, number> = {
  Viewer: 0,
  Trader: 1,
  Analyst: 2,
  Admin: 3,
  Owner: 4,
};

/** True when `role`'s rank is >= `minRole`'s rank on the D1 ladder. Unknown/missing role = false (fail-closed). */
export function meetsMinRole(role: string | null | undefined, minRole: WorkspaceRole): boolean {
  if (!role || !(role in ROLE_RANK)) return false;
  return ROLE_RANK[role as WorkspaceRole] >= ROLE_RANK[minRole];
}

export type WebSurface = {
  path: string;
  title: string;
  shortTitle: string;
  sub: string;
  kind: WebSurfaceKind;
  disposition: WebSurfaceDisposition;
  activePaths: readonly string[];
  /** Minimum role (permission matrix D1 ladder) required to see/use this surface. */
  minRole: WorkspaceRole;
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
    minRole: "Viewer",
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
    minRole: "Viewer",
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
    minRole: "Viewer",
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
    minRole: "Viewer",
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
    minRole: "Viewer",
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
    minRole: "Viewer",
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
    minRole: "Owner",
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
    minRole: "Owner",
  },
  {
    path: "/admin/brain/decisions",
    title: "主腦決策",
    shortTitle: "決策",
    sub: "決策流",
    kind: "admin",
    disposition: "internal",
    activePaths: ["/admin/brain/decisions"],
    minRole: "Owner",
  },
  {
    path: "/admin/events",
    title: "EventLog",
    shortTitle: "事件",
    sub: "事件流",
    kind: "admin",
    disposition: "internal",
    activePaths: ["/admin/events"],
    minRole: "Owner",
  },
  {
    path: "/admin/portfolio/snapshots",
    title: "Portfolio",
    shortTitle: "快照",
    sub: "快照版本",
    kind: "admin",
    disposition: "internal",
    activePaths: ["/admin/portfolio/snapshots"],
    minRole: "Owner",
  },
  {
    path: "/admin/tools",
    title: "Tools",
    shortTitle: "工具",
    sub: "工具登錄",
    kind: "admin",
    disposition: "internal",
    activePaths: ["/admin/tools"],
    minRole: "Owner",
  },
  {
    path: "/admin/uta/accounts",
    title: "UTA",
    shortTitle: "UTA",
    sub: "帳號管理",
    kind: "admin",
    disposition: "internal",
    activePaths: ["/admin/uta"],
    minRole: "Owner",
  },
  {
    path: "/admin/strategies",
    title: "Strategies",
    shortTitle: "策略",
    sub: "策略治理",
    kind: "admin",
    disposition: "internal",
    activePaths: ["/admin/strategies"],
    minRole: "Owner",
  },
  {
    path: "/admin/team",
    title: "團隊與邀請",
    shortTitle: "團隊",
    sub: "用戶 / 邀請管理",
    kind: "admin",
    disposition: "internal",
    activePaths: ["/admin/team"],
    // G-ADMIN 群 carve-out (PERMISSION_MATRIX_v1 §2 D3 / PM-O3)：邀請/用戶管理是唯一留在
    // Admin 級的 G-ADMIN 內容，brain/themes 治理其餘全維持 Owner。
    minRole: "Admin",
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
    // G-RESEARCH：content-drafts 讀取＝原 READ_DRAFT_ROLES 本意，Analyst 起。
    minRole: "Analyst",
  },
  {
    path: "/admin/invites",
    title: "邀請管理（舊）",
    shortTitle: "邀請",
    sub: "已併入團隊管理",
    kind: "legacy",
    disposition: "redirect",
    activePaths: ["/admin/invites"],
    // P1-2 legacy invite converge (2026-07-05)：invite_codes 簽發端點已下線
    // (/auth/issue-invite → 410)，本頁改為薄轉址頁，permanentRedirect 到
    // /admin/team（workspace_invites／migration 0050 系統）。
    // G-ADMIN：仍維持 Admin 起。
    minRole: "Admin",
    replacementPath: "/admin/team",
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
    minRole: "Viewer",
  },
  {
    path: "/settings/account",
    title: "帳號設定",
    shortTitle: "帳號",
    sub: "登入與個人資料",
    kind: "support",
    disposition: "secondary",
    activePaths: ["/settings/account"],
    minRole: "Viewer",
  },
  {
    path: "/settings/broker",
    title: "券商連線",
    shortTitle: "券商",
    sub: "真金 gateway 配對",
    kind: "support",
    disposition: "secondary",
    activePaths: ["/settings/broker"],
    // G-SELF：自己的券商 gateway 配對＝Trader 起。
    minRole: "Trader",
  },
  {
    path: "/settings/subscription",
    title: "方案與權限",
    shortTitle: "方案",
    sub: "訂閱狀態",
    kind: "support",
    disposition: "secondary",
    activePaths: ["/settings/subscription"],
    minRole: "Viewer",
  },
  {
    path: "/briefs",
    title: "AI 每日簡報",
    shortTitle: "簡報",
    sub: "OpenAlice 簡報列表",
    kind: "support",
    disposition: "secondary",
    activePaths: ["/briefs"],
    minRole: "Viewer",
  },
  {
    path: "/alerts",
    title: "警示",
    shortTitle: "警示",
    sub: "風控提醒與警示紀錄",
    kind: "support",
    disposition: "secondary",
    activePaths: ["/alerts"],
    minRole: "Viewer",
  },
  {
    path: "/login",
    title: "登入",
    shortTitle: "登入",
    sub: "帳號入口",
    kind: "support",
    disposition: "auth",
    activePaths: ["/login"],
    // 未登入公開頁；minRole 只是佔位值（Viewer=最低），過濾邏輯不套用在 auth 頁。
    minRole: "Viewer",
  },
  {
    path: "/register",
    title: "註冊",
    shortTitle: "註冊",
    sub: "邀請註冊",
    kind: "support",
    disposition: "auth",
    activePaths: ["/register"],
    minRole: "Viewer",
  },
  {
    path: "/m",
    title: "行動入口",
    shortTitle: "行動",
    sub: "手機版觀察",
    kind: "support",
    disposition: "secondary",
    activePaths: ["/m"],
    minRole: "Viewer",
  },
  {
    path: "/final-v031/market-intel",
    title: "Final v031 市場情報",
    shortTitle: "v031 情報",
    sub: "正式頁框架",
    kind: "support",
    disposition: "frame",
    activePaths: ["/final-v031/market-intel"],
    minRole: "Viewer",
  },
  {
    path: "/final-v031/ideas",
    title: "Final v031 AI 推薦",
    shortTitle: "v031 推薦",
    sub: "正式頁框架",
    kind: "support",
    disposition: "frame",
    activePaths: ["/final-v031/ideas"],
    minRole: "Viewer",
  },
  {
    path: "/final-v031/portfolio",
    title: "Final v031 交易室",
    shortTitle: "v031 交易",
    sub: "正式頁框架",
    kind: "support",
    disposition: "frame",
    activePaths: ["/final-v031/portfolio"],
    minRole: "Viewer",
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
    minRole: "Viewer",
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
    minRole: "Viewer",
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
    minRole: "Viewer",
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
    minRole: "Viewer",
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
    minRole: "Viewer",
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
    minRole: "Viewer",
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
    minRole: "Viewer",
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
    minRole: "Analyst",
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
    minRole: "Viewer",
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
    minRole: "Owner",
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
