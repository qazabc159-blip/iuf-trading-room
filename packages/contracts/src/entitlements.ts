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
  features: Partial<Record<SubscriptionFeatureId, EntitlementStatus>>;
};

export const subscriptionFeatures: SubscriptionFeature[] = [
  {
    id: "market_intel",
    label: "市場情報與熱力圖",
    customerCopy: "重大訊息、AI 精選新聞、產業熱力圖與資料來源狀態。",
  },
  {
    id: "ai_recommendations",
    label: "AI 推薦股票",
    customerCopy: "今日推薦、進場區、停損、TP1/TP2、理由與風險。",
  },
  {
    id: "trading_room_paper",
    label: "交易室 Paper 模擬",
    customerCopy: "搜尋台股、查看行情/K 線、紙上單預覽、委託與成交紀錄。",
  },
  {
    id: "company_ai_report",
    label: "公司 AI 分析師",
    customerCopy: "公司概況、近期事件、技術、籌碼、題材、風險與資料來源。",
  },
  {
    id: "daily_brief",
    label: "AI 每日簡報",
    customerCopy: "每日盤勢、題材、公司觀察與風險提醒。",
  },
  {
    id: "strategy_observation",
    label: "策略觀察",
    customerCopy: "量化策略狀態、SIM-only 標示、forward observation 與風險 caveat。",
  },
  {
    id: "kgi_read_only",
    label: "KGI Read-only",
    customerCopy: "讀取券商連線狀態、庫存或資金摘要，不送正式委託。",
    requiresBroker: true,
  },
  {
    id: "kgi_sim",
    label: "KGI SIM",
    customerCopy: "券商模擬環境委託、回報與風控紀錄。",
    requiresBroker: true,
  },
  {
    id: "automation",
    label: "自動化與進階監控",
    customerCopy: "盤中監控、自動簡報重產、策略/券商狀態告警。",
  },
  {
    id: "owner_internal",
    label: "Owner 後台",
    customerCopy: "Brain、EventLog、ToolCenter、UTA、內部治理與系統操作。",
  },
];

export const subscriptionTiers: SubscriptionTier[] = [
  {
    id: "starter",
    name: "入門",
    levelLabel: "Starter",
    targetUser: "需要每天看盤、讀市場情報、保存觀察清單的使用者。",
    monthlyPriceTwd: null,
    yearlyPriceTwd: null,
    entitlementSummary: "看懂市場與公司，不開券商模擬委託。",
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
    targetUser: "需要 AI 推薦、公司分析與 Paper 交易演練的主力使用者。",
    monthlyPriceTwd: null,
    yearlyPriceTwd: null,
    entitlementSummary: "把 AI 判斷帶進交易室，完成研究到紙上單的流程。",
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
    targetUser: "需要券商 SIM、策略觀察與進階監控的進階使用者。",
    monthlyPriceTwd: null,
    yearlyPriceTwd: null,
    entitlementSummary: "連接券商 SIM/read-only 與進階監控，但正式下單仍需另行開通。",
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
    included: "完整開放",
    limited: "部分開放",
    not_included: "未包含",
    owner_only: "Owner-only",
  };
  return labels[status];
}

export function billingCycleLabel(cycle: BillingCycle) {
  return cycle === "monthly" ? "月費" : "年費";
}

export function tierPriceLabel(tier: SubscriptionTier, cycle: BillingCycle) {
  const value = cycle === "monthly" ? tier.monthlyPriceTwd : tier.yearlyPriceTwd;
  if (typeof value !== "number") return "價格待定";
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
        status: owner ? "owner_only" as const : "not_included" as const,
        access: owner,
        reason: owner ? "此帳號角色為 Owner，可進入內部治理與後台頁。" : "內部治理頁不屬於客戶訂閱功能。",
      };
    }

    const status = tierFeatureStatus(tier.id, feature.id);
    return {
      id: feature.id,
      label: feature.label,
      status,
      access: owner || status === "included" || status === "limited",
      reason: feature.requiresBroker && status === "included"
        ? "此功能需要完成券商連線設定，憑證只從安全環境讀取。"
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
      priceLabel: "價格待定",
      nextBillingAt: null,
    },
    features,
    ownerInternal: {
      visible: owner,
      reason: owner ? "Owner 帳號可看到 Brain、EventLog、ToolCenter、UTA 與系統治理頁。" : "一般客戶帳號不顯示內部治理頁。",
    },
    generatedAt: now.toISOString(),
  };
}
