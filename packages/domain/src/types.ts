import type {
  AppSession,
  Company,
  CompanyCreateInput,
  CompanyUpdateInput,
  DailyBrief,
  DailyBriefCreateInput,
  ReviewEntry,
  ReviewEntryCreateInput,
  Signal,
  SignalCreateInput,
  SignalUpdateInput,
  Theme,
  ThemeCreateInput,
  ThemeUpdateInput,
  TradePlan,
  TradePlanCreateInput,
  TradePlanUpdateInput
} from "@iuf-trading-room/contracts";

export type SessionOptions = {
  workspaceSlug?: string;
  roleOverride?: AppSession["user"]["role"];
};

export interface TradingRoomRepository {
  getSession(options?: SessionOptions): Promise<AppSession>;

  // Themes
  listThemes(options?: SessionOptions): Promise<Theme[]>;
  getTheme(themeId: string, options?: SessionOptions): Promise<Theme | null>;
  createTheme(input: ThemeCreateInput, options?: SessionOptions): Promise<Theme>;
  updateTheme(themeId: string, input: ThemeUpdateInput, options?: SessionOptions): Promise<Theme | null>;

  // Companies
  listCompanies(themeId?: string, options?: SessionOptions): Promise<Company[]>;
  getCompany(companyId: string, options?: SessionOptions): Promise<Company | null>;
  createCompany(input: CompanyCreateInput, options?: SessionOptions): Promise<Company>;
  updateCompany(companyId: string, input: CompanyUpdateInput, options?: SessionOptions): Promise<Company | null>;

  // Signals
  listSignals(filters?: { themeId?: string; companyId?: string; category?: string }, options?: SessionOptions): Promise<Signal[]>;
  getSignal(signalId: string, options?: SessionOptions): Promise<Signal | null>;
  createSignal(input: SignalCreateInput, options?: SessionOptions): Promise<Signal>;
  updateSignal(signalId: string, input: SignalUpdateInput, options?: SessionOptions): Promise<Signal | null>;

  // Trade Plans
  listTradePlans(filters?: { companyId?: string; status?: string }, options?: SessionOptions): Promise<TradePlan[]>;
  getTradePlan(planId: string, options?: SessionOptions): Promise<TradePlan | null>;
  createTradePlan(input: TradePlanCreateInput, options?: SessionOptions): Promise<TradePlan>;
  updateTradePlan(planId: string, input: TradePlanUpdateInput, options?: SessionOptions): Promise<TradePlan | null>;

  // Reviews
  listReviews(filters?: { tradePlanId?: string }, options?: SessionOptions): Promise<ReviewEntry[]>;
  createReview(input: ReviewEntryCreateInput, options?: SessionOptions): Promise<ReviewEntry>;

  // Daily Briefs
  listBriefs(options?: SessionOptions): Promise<DailyBrief[]>;
  createBrief(input: DailyBriefCreateInput, options?: SessionOptions): Promise<DailyBrief>;
}
