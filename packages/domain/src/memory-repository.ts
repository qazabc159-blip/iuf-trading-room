import type {
  AppSession,
  Company,
  CompanyCreateInput,
  CompanyKeyword,
  CompanyKeywordInput,
  CompanyRelation,
  CompanyRelationInput,
  CompanyUpdateInput,
  DailyBrief,
  DailyBriefCreateInput,
  ReviewEntry,
  ReviewEntryCreateInput,
  SessionUser,
  Signal,
  SignalCreateInput,
  SignalUpdateInput,
  Theme,
  ThemeCreateInput,
  ThemeUpdateInput,
  TradePlan,
  TradePlanCreateInput,
  TradePlanUpdateInput,
  Workspace
} from "@iuf-trading-room/contracts";

import type { SessionOptions, TradingRoomRepository } from "./types.js";

const now = () => new Date().toISOString();

const createSlug = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

const workspace: Workspace = {
  id: "8ff07314-4d01-4c8d-b472-7102ecb8b0bf",
  name: "Primary Desk",
  slug: "primary-desk"
};

const user: SessionUser = {
  id: "460a4868-c897-43e1-a744-9b25536838d5",
  name: "Desk Owner",
  email: "owner@iuf.local",
  role: "Owner"
};

const seededThemes: Theme[] = [
  {
    id: "4b2724d1-8f5c-4c60-8d69-23d29ca8e4c1",
    name: "AI Data Center Interconnect",
    slug: "ai-data-center-interconnect",
    marketState: "Selective Attack",
    lifecycle: "Validation",
    priority: 5,
    thesis:
      "Switching, optics, and supply-chain bottlenecks are becoming the next pricing leg after AI compute.",
    whyNow:
      "1.6T migration, optical bottlenecks, and hyperscaler capex are starting to spread beyond obvious leaders.",
    bottleneck: "Optical modules, high-speed materials, and system-level interconnect capacity.",
    corePoolCount: 4,
    observationPoolCount: 7,
    createdAt: now(),
    updatedAt: now()
  },
  {
    id: "7787b5ad-fcb2-4d3d-bbd1-10eb2a7083b0",
    name: "AI Power and Cooling",
    slug: "ai-power-and-cooling",
    marketState: "Balanced",
    lifecycle: "Discovery",
    priority: 4,
    thesis:
      "Higher rack density forces upgrades in power delivery, thermal management, and facility-level infrastructure.",
    whyNow:
      "Power density constraints are moving from background issue to visible spending line item.",
    bottleneck: "Power distribution equipment and liquid cooling readiness.",
    corePoolCount: 3,
    observationPoolCount: 6,
    createdAt: now(),
    updatedAt: now()
  }
];

const seededCompanies: Company[] = [
  {
    id: "a7cc55fd-2b43-493f-87b4-5fdd4c983c7b",
    name: "Acme Optics Taiwan",
    ticker: "6801",
    market: "TWSE",
    country: "Taiwan",
    themeIds: ["4b2724d1-8f5c-4c60-8d69-23d29ca8e4c1"],
    chainPosition: "Optical module supplier",
    beneficiaryTier: "Direct",
    exposure: {
      volume: 5,
      asp: 4,
      margin: 3,
      capacity: 4,
      narrative: 5
    },
    validation: {
      capitalFlow: "Foreign buying improving over the last two weeks.",
      consensus: "Street expectations just started to move up.",
      relativeStrength: "Holding above sector peers during pullbacks."
    },
    notes:
      "Good candidate when DCI optics move from headline story to group-wide validation.",
    updatedAt: now()
  },
  {
    id: "12c82c4e-62b9-4e89-8b95-40b99fd6d6b9",
    name: "GridFlow Systems",
    ticker: "PWRX",
    market: "NASDAQ",
    country: "United States",
    themeIds: ["7787b5ad-fcb2-4d3d-bbd1-10eb2a7083b0"],
    chainPosition: "Power distribution and rack-level control",
    beneficiaryTier: "Core",
    exposure: {
      volume: 4,
      asp: 4,
      margin: 4,
      capacity: 3,
      narrative: 4
    },
    validation: {
      capitalFlow: "Institutions accumulating on earnings revisions.",
      consensus: "Visibility improving after customer commentary.",
      relativeStrength: "Near 6-month highs."
    },
    notes:
      "Useful anchor name for the power theme, even if not the highest torque name.",
    updatedAt: now()
  }
];

export class MemoryTradingRoomRepository implements TradingRoomRepository {
  private themes = [...seededThemes];

  private companies = [...seededCompanies];

  private companyRelations: CompanyRelation[] = [];

  private companyKeywords: CompanyKeyword[] = [];

  private signals: Signal[] = [];

  private tradePlans: TradePlan[] = [];

  private reviews: ReviewEntry[] = [];

  private briefs: DailyBrief[] = [];

  async getSession(options?: SessionOptions): Promise<AppSession> {
    return {
      workspace: {
        ...workspace,
        slug: options?.workspaceSlug ?? workspace.slug
      },
      user: {
        ...user,
        role: options?.roleOverride ?? user.role
      },
      persistenceMode: "memory"
    };
  }

  async listThemes() {
    return this.themes.map((theme) => ({ ...theme }));
  }

  async getTheme(themeId: string) {
    return this.themes.find((theme) => theme.id === themeId) ?? null;
  }

  async createTheme(input: ThemeCreateInput) {
    const theme: Theme = {
      id: crypto.randomUUID(),
      slug: createSlug(input.name),
      corePoolCount: 0,
      observationPoolCount: 0,
      createdAt: now(),
      updatedAt: now(),
      ...input
    };
    this.themes.unshift(theme);
    return { ...theme };
  }

  async updateTheme(themeId: string, input: ThemeUpdateInput) {
    const theme = this.themes.find((item) => item.id === themeId);
    if (!theme) {
      return null;
    }

    Object.assign(theme, input, {
      slug: input.name ? createSlug(input.name) : theme.slug,
      updatedAt: now()
    });

    return { ...theme };
  }

  async listCompanies(themeId?: string) {
    const items = themeId
      ? this.companies.filter((company) => company.themeIds.includes(themeId))
      : this.companies;

    return items.map((company) => ({ ...company, themeIds: [...company.themeIds] }));
  }

  async getCompany(companyId: string) {
    return this.companies.find((company) => company.id === companyId) ?? null;
  }

  async createCompany(input: CompanyCreateInput) {
    const company: Company = {
      id: crypto.randomUUID(),
      updatedAt: now(),
      ...input
    };
    this.companies.unshift(company);
    return { ...company, themeIds: [...company.themeIds] };
  }

  async updateCompany(companyId: string, input: CompanyUpdateInput) {
    const company = this.companies.find((item) => item.id === companyId);
    if (!company) {
      return null;
    }

    Object.assign(company, input, {
      updatedAt: now()
    });

    return { ...company, themeIds: [...company.themeIds] };
  }

  async listCompanyRelations(companyId: string) {
    return this.companyRelations
      .filter((relation) => relation.companyId === companyId)
      .sort((left, right) => {
        if (right.confidence !== left.confidence) {
          return right.confidence - left.confidence;
        }

        return left.targetLabel.localeCompare(right.targetLabel);
      })
      .map((relation) => ({ ...relation }));
  }

  async replaceCompanyRelations(companyId: string, input: CompanyRelationInput[]) {
    this.companyRelations = this.companyRelations.filter(
      (relation) => relation.companyId !== companyId
    );

    const nextRelations = input.map((relation) => ({
      id: crypto.randomUUID(),
      companyId,
      targetCompanyId: relation.targetCompanyId ?? null,
      targetLabel: relation.targetLabel,
      relationType: relation.relationType,
      confidence: relation.confidence,
      sourcePath: relation.sourcePath,
      updatedAt: now()
    } satisfies CompanyRelation));

    this.companyRelations.unshift(...nextRelations);
    return nextRelations.map((relation) => ({ ...relation }));
  }

  async listCompanyKeywords(companyId: string) {
    return this.companyKeywords
      .filter((keyword) => keyword.companyId === companyId)
      .sort((left, right) => {
        if (right.confidence !== left.confidence) {
          return right.confidence - left.confidence;
        }

        return left.label.localeCompare(right.label);
      })
      .map((keyword) => ({ ...keyword }));
  }

  async replaceCompanyKeywords(companyId: string, input: CompanyKeywordInput[]) {
    this.companyKeywords = this.companyKeywords.filter((keyword) => keyword.companyId !== companyId);

    const nextKeywords = input.map((keyword) => ({
      id: crypto.randomUUID(),
      companyId,
      label: keyword.label,
      confidence: keyword.confidence,
      sourcePath: keyword.sourcePath,
      updatedAt: now()
    } satisfies CompanyKeyword));

    this.companyKeywords.unshift(...nextKeywords);
    return nextKeywords.map((keyword) => ({ ...keyword }));
  }

  // Signals

  async listSignals(filters?: { themeId?: string; companyId?: string; category?: string }) {
    let items = this.signals;
    if (filters?.themeId) {
      items = items.filter((s) => s.themeIds.includes(filters.themeId!));
    }
    if (filters?.companyId) {
      items = items.filter((s) => s.companyIds.includes(filters.companyId!));
    }
    if (filters?.category) {
      items = items.filter((s) => s.category === filters.category);
    }
    return items.map((s) => ({ ...s, themeIds: [...s.themeIds], companyIds: [...s.companyIds] }));
  }

  async getSignal(signalId: string) {
    return this.signals.find((s) => s.id === signalId) ?? null;
  }

  async createSignal(input: SignalCreateInput) {
    const signal: Signal = {
      id: crypto.randomUUID(),
      createdAt: now(),
      ...input,
      summary: input.summary ?? "",
      themeIds: input.themeIds ?? [],
      companyIds: input.companyIds ?? []
    };
    this.signals.unshift(signal);
    return { ...signal, themeIds: [...signal.themeIds], companyIds: [...signal.companyIds] };
  }

  async updateSignal(signalId: string, input: SignalUpdateInput) {
    const signal = this.signals.find((s) => s.id === signalId);
    if (!signal) {
      return null;
    }
    Object.assign(signal, input);
    return { ...signal, themeIds: [...signal.themeIds], companyIds: [...signal.companyIds] };
  }

  // Trade Plans

  async listTradePlans(filters?: { companyId?: string; status?: string }) {
    let items = this.tradePlans;
    if (filters?.companyId) {
      items = items.filter((p) => p.companyId === filters.companyId);
    }
    if (filters?.status) {
      items = items.filter((p) => p.status === filters.status);
    }
    return items.map((p) => ({ ...p }));
  }

  async getTradePlan(planId: string) {
    return this.tradePlans.find((p) => p.id === planId) ?? null;
  }

  async createTradePlan(input: TradePlanCreateInput) {
    const plan: TradePlan = {
      id: crypto.randomUUID(),
      createdAt: now(),
      updatedAt: now(),
      ...input,
      status: input.status ?? "draft",
      riskReward: input.riskReward ?? "",
      notes: input.notes ?? ""
    };
    this.tradePlans.unshift(plan);
    return { ...plan };
  }

  async updateTradePlan(planId: string, input: TradePlanUpdateInput) {
    const plan = this.tradePlans.find((p) => p.id === planId);
    if (!plan) {
      return null;
    }
    Object.assign(plan, input, { updatedAt: now() });
    return { ...plan };
  }

  // Reviews

  async listReviews(filters?: { tradePlanId?: string }) {
    let items = this.reviews;
    if (filters?.tradePlanId) {
      items = items.filter((r) => r.tradePlanId === filters.tradePlanId);
    }
    return items.map((r) => ({ ...r, setupTags: [...r.setupTags] }));
  }

  async createReview(input: ReviewEntryCreateInput) {
    const review: ReviewEntry = {
      id: crypto.randomUUID(),
      createdAt: now(),
      ...input,
      attribution: input.attribution ?? "",
      lesson: input.lesson ?? "",
      setupTags: input.setupTags ?? []
    };
    this.reviews.unshift(review);
    return { ...review, setupTags: [...review.setupTags] };
  }

  // Daily Briefs

  async listBriefs() {
    return this.briefs.map((b) => ({ ...b, sections: b.sections.map((s) => ({ ...s })) }));
  }

  async createBrief(input: DailyBriefCreateInput) {
    const brief: DailyBrief = {
      id: crypto.randomUUID(),
      createdAt: now(),
      ...input,
      generatedBy: input.generatedBy ?? "manual",
      status: input.status ?? "draft"
    };
    this.briefs.unshift(brief);
    return { ...brief, sections: brief.sections.map((s) => ({ ...s })) };
  }
}
