import { z } from "zod";

export const billingCycles = ["monthly", "yearly"] as const;
export type BillingCycle = (typeof billingCycles)[number];

export const subscriptionTierIds = ["starter", "pro", "premium"] as const;
export type SubscriptionTierId = (typeof subscriptionTierIds)[number];

export const entitlementStatuses = ["included", "limited", "not_included", "owner_only"] as const;
export type EntitlementStatus = (typeof entitlementStatuses)[number];

export const subscriptionFeatureIds = [
  "market_intel",
  "ai_recommendations",
  "trading_room_paper",
  "company_ai_report",
  "daily_brief",
  "strategy_observation",
  "kgi_read_only",
  "kgi_sim",
  "automation",
  "owner_internal",
] as const;
export type SubscriptionFeatureId = (typeof subscriptionFeatureIds)[number];

export const billingCycleSchema = z.enum(billingCycles);
export const subscriptionTierIdSchema = z.enum(subscriptionTierIds);
export const entitlementStatusSchema = z.enum(entitlementStatuses);
export const subscriptionFeatureIdSchema = z.enum(subscriptionFeatureIds);

export type SubscriptionFeature = {
  id: SubscriptionFeatureId;
  label: string;
  customerCopy: string;
  requiresBroker?: boolean;
};

export type SubscriptionTier = {
  id: SubscriptionTierId;
  name: string;
  levelLabel: string;
  targetUser: string;
  monthlyPriceTwd: number | null;
  yearlyPriceTwd: number | null;
  entitlementSummary: string;
  usageLimits: string[];
  onboardingNote: string;
  features: Partial<Record<SubscriptionFeatureId, EntitlementStatus>>;
};

export const subscriptionFeatures: SubscriptionFeature[] = [
  {
    id: "market_intel",
    label: "市場情報與 AI 精選",
    customerCopy: "AI 精選市場新聞、重大公告、產業事件與來源狀態，協助使用者快速抓住今日重點。",
  },
  {
    id: "ai_recommendations",
    label: "AI 推薦股票",
    customerCopy: "每日候選股票、進場區、停損、TP1/TP2、理由、風險與可帶入交易室的操作計畫。",
  },
  {
    id: "trading_room_paper",
    label: "交易室 Paper 模擬",
    customerCopy: "可查看行情、K 線、資金、庫存、委託預覽與平台模擬帳本，不送出真實委託。",
  },
  {
    id: "company_ai_report",
    label: "公司 AI 分析師報告",
    customerCopy: "整合公司概況、近期事件、技術結構、籌碼、題材、風險與 AI 結論。",
  },
  {
    id: "daily_brief",
    label: "AI 每日簡報",
    customerCopy: "以當日價格、盤勢、重大訊息、AI 推薦與交易環境生成每日決策摘要。",
  },
  {
    id: "strategy_observation",
    label: "策略觀察",
    customerCopy: "查看策略研究、forward observation、SIM-only 狀態、風險 caveat 與最新 snapshot。",
  },
  {
    id: "kgi_read_only",
    label: "KGI 唯讀連線",
    customerCopy: "讀取券商模擬或唯讀狀態、部位與連線健康，不在產品頁收集憑證。",
    requiresBroker: true,
  },
  {
    id: "kgi_sim",
    label: "KGI SIM 模擬下單",
    customerCopy: "透過安全憑證連到券商模擬環境，和 Paper 帳本、正式下單清楚分離。",
    requiresBroker: true,
  },
  {
    id: "automation",
    label: "自動化排程與監控",
    customerCopy: "Daily smoke、資料新鮮度、策略排程與風控監控，讓產品每天自我檢查。",
  },
  {
    id: "owner_internal",
    label: "Owner 後台",
    customerCopy: "Brain、EventLog、ToolCenter、UTA 與內部排錯頁，只對 Owner 帳號開放。",
  },
];

export const subscriptionTiers: SubscriptionTier[] = [
  {
    id: "starter",
    name: "入門",
    levelLabel: "Starter",
    targetUser: "想先觀察市場情報、AI 摘要與少量研究候選，不需要券商連線的使用者。",
    monthlyPriceTwd: null,
    yearlyPriceTwd: null,
    entitlementSummary: "可查看市場情報、有限 AI 推薦與基本 Paper 交易室體驗。",
    usageLimits: [
      "市場情報與 AI 精選可讀，但進階來源與歷史深查有限。",
      "AI 推薦顯示研究候選與風險提醒，完整交易計畫數量有限。",
      "交易室只開 Paper 模擬基礎檢視，不含 KGI 唯讀或 SIM。",
    ],
    onboardingNote: "適合先熟悉戰情台流程，確認資料與 AI 判斷是否符合自己的交易節奏。",
    features: {
      market_intel: "included",
      ai_recommendations: "limited",
      trading_room_paper: "limited",
      company_ai_report: "limited",
      daily_brief: "limited",
      strategy_observation: "not_included",
      kgi_read_only: "not_included",
      kgi_sim: "not_included",
      automation: "not_included",
      owner_internal: "not_included",
    },
  },
  {
    id: "pro",
    name: "中級",
    levelLabel: "Pro",
    targetUser: "每天需要 AI 推薦、公司分析、每日簡報與完整 Paper 交易室的主力使用者。",
    monthlyPriceTwd: null,
    yearlyPriceTwd: null,
    entitlementSummary: "打開主要 AI 投研與 Paper 交易流程，適合日常開盤使用。",
    usageLimits: [
      "完整 AI 推薦、公司 AI 報告與 AI 每日簡報。",
      "交易室可用行情、K 線、指標、Paper 預覽與模擬帳本。",
      "策略觀察與自動化為有限開放；KGI SIM 與唯讀需升級到高級。",
    ],
    onboardingNote: "適合把 IUF 當成日常投研與 Paper 演練工具，但不接券商 SIM。",
    features: {
      market_intel: "included",
      ai_recommendations: "included",
      trading_room_paper: "included",
      company_ai_report: "included",
      daily_brief: "included",
      strategy_observation: "limited",
      kgi_read_only: "not_included",
      kgi_sim: "not_included",
      automation: "limited",
      owner_internal: "not_included",
    },
  },
  {
    id: "premium",
    name: "高級",
    levelLabel: "Premium",
    targetUser: "需要策略觀察、KGI 唯讀、KGI SIM 與更完整自動化監控的進階使用者。",
    monthlyPriceTwd: null,
    yearlyPriceTwd: null,
    entitlementSummary: "包含 Pro 全部功能，加上策略觀察、KGI read-only / SIM 與完整監控。",
    usageLimits: [
      "包含中級方案全部 AI、交易室與簡報功能。",
      "可啟用 KGI 唯讀與 KGI SIM，但仍需通過券商憑證與風控檢查。",
      "正式下單仍維持鎖定，除非另有完整授權與風控驗收。",
    ],
    onboardingNote: "適合準備接券商模擬流程、觀察策略與追蹤自動化狀態的使用者。",
    features: {
      market_intel: "included",
      ai_recommendations: "included",
      trading_room_paper: "included",
      company_ai_report: "included",
      daily_brief: "included",
      strategy_observation: "included",
      kgi_read_only: "included",
      kgi_sim: "included",
      automation: "included",
      owner_internal: "not_included",
    },
  },
];

export function getTierById(tierId: SubscriptionTierId) {
  return subscriptionTiers.find((tier) => tier.id === tierId) ?? subscriptionTiers[0];
}

export function tierFeatureStatus(tierId: SubscriptionTierId, featureId: SubscriptionFeatureId): EntitlementStatus {
  return getTierById(tierId).features[featureId] ?? "not_included";
}

export function tierCanAccess(tierId: SubscriptionTierId, featureId: SubscriptionFeatureId) {
  const status = tierFeatureStatus(tierId, featureId);
  return status === "included" || status === "limited";
}

export function isOwnerRole(role: string | null | undefined) {
  return role === "Owner";
}

export function featureStatusLabel(status: EntitlementStatus) {
  const labels: Record<EntitlementStatus, string> = {
    included: "已包含",
    limited: "有限開放",
    not_included: "未包含",
    owner_only: "Owner 專用",
  };
  return labels[status];
}

export function billingCycleLabel(cycle: BillingCycle) {
  return cycle === "monthly" ? "月費" : "年費";
}

export function tierPriceLabel(tier: SubscriptionTier, cycle: BillingCycle) {
  const value = cycle === "monthly" ? tier.monthlyPriceTwd : tier.yearlyPriceTwd;
  if (typeof value !== "number") return "價格待設定";
  return `NT$ ${value.toLocaleString("zh-TW")}`;
}

export const entitlementFeatureSchema = z.object({
  id: subscriptionFeatureIdSchema,
  label: z.string(),
  status: entitlementStatusSchema,
  access: z.boolean(),
  reason: z.string(),
});

export const myEntitlementsSchema = z.object({
  user: z.object({
    id: z.string(),
    email: z.string(),
    name: z.string(),
    role: z.string(),
  }),
  subscription: z.object({
    tier: subscriptionTierIdSchema,
    tierName: z.string(),
    billingCycle: billingCycleSchema.nullable(),
    status: z.enum(["trial", "active", "inactive", "owner_internal"]),
    source: z.enum(["role_default", "billing_pending", "owner_override"]),
    priceLabel: z.string(),
    nextBillingAt: z.string().nullable(),
  }),
  features: z.array(entitlementFeatureSchema),
  ownerInternal: z.object({
    visible: z.boolean(),
    reason: z.string(),
  }),
  generatedAt: z.string(),
});

export type MyEntitlements = z.infer<typeof myEntitlementsSchema>;

type EntitlementUser = {
  id?: string | null;
  email?: string | null;
  name?: string | null;
  role?: string | null;
};

export function defaultTierForRole(role: string | null | undefined): SubscriptionTierId {
  if (role === "Owner") return "premium";
  if (role === "Admin" || role === "Analyst" || role === "Trader") return "pro";
  return "starter";
}

export function buildMyEntitlements(user: EntitlementUser, now = new Date()): MyEntitlements {
  const role = user.role ?? "Viewer";
  const owner = isOwnerRole(role);
  const tier = getTierById(defaultTierForRole(role));
  const features = subscriptionFeatures.map((feature) => {
    if (feature.id === "owner_internal") {
      return {
        id: feature.id,
        label: feature.label,
        status: owner ? ("owner_only" as const) : ("not_included" as const),
        access: owner,
        reason: owner ? "Owner 帳號可進入內部後台與診斷頁。" : "一般客戶不包含內部後台功能。",
      };
    }

    const status = tierFeatureStatus(tier.id, feature.id);
    return {
      id: feature.id,
      label: feature.label,
      status,
      access: owner || status === "included" || status === "limited",
      reason:
        feature.requiresBroker && status === "included"
          ? "需要券商憑證、連線與風控檢查通過後啟用。"
          : featureStatusLabel(status),
    };
  });

  return {
    user: {
      id: user.id ?? "unknown",
      email: user.email ?? "",
      name: user.name ?? user.email ?? "使用者",
      role,
    },
    subscription: {
      tier: tier.id,
      tierName: tier.name,
      billingCycle: null,
      status: owner ? "owner_internal" : "trial",
      source: owner ? "owner_override" : "role_default",
      priceLabel: "價格待設定",
      nextBillingAt: null,
    },
    features,
    ownerInternal: {
      visible: owner,
      reason: owner ? "Owner 帳號可看 Brain、EventLog、ToolCenter、UTA 等內部頁。" : "一般客戶只看正式產品功能。",
    },
    generatedAt: now.toISOString(),
  };
}
