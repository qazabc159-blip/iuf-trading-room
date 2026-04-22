import {
  and,
  asc,
  desc,
  eq,
  inArray
} from "drizzle-orm";

import {
  type AppSession,
  type Company,
  type CompanyCreateInput,
  type CompanyKeyword,
  type CompanyKeywordInput,
  companyKeywordSchema,
  type CompanyRelation,
  type CompanyRelationInput,
  companyRelationSchema,
  companySchema,
  type CompanyUpdateInput,
  type DailyBrief,
  type DailyBriefCreateInput,
  exposureBreakdownSchema,
  type ReviewEntry,
  type ReviewEntryCreateInput,
  type Signal,
  type SignalCreateInput,
  type SignalUpdateInput,
  type Theme,
  themeSchema,
  type ThemeCreateInput,
  type ThemeUpdateInput,
  type TradePlan,
  type TradePlanCreateInput,
  type TradePlanExecution,
  tradePlanExecutionSchema,
  type TradePlanUpdateInput,
  validationSnapshotSchema,
  type Workspace
} from "@iuf-trading-room/contracts";
import {
  companies,
  companyKeywords,
  companyRelations,
  companyThemeLinks,
  getDb,
  reviewEntries,
  signals,
  themes,
  tradePlans,
  users,
  workspaces
} from "@iuf-trading-room/db";

import type {
  CompanyKeywordListFilters,
  CompanyRelationListFilters,
  SessionOptions,
  TradingRoomRepository
} from "./types.js";

const defaultWorkspaceSlug = "primary-desk";
const defaultWorkspaceName = "Primary Desk";
const defaultOwnerEmail = "owner@iuf.local";
const defaultOwnerName = "Desk Owner";

const createSlug = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

export class PostgresTradingRoomRepository implements TradingRoomRepository {
  private get database() {
    const db = getDb();
    if (!db) {
      throw new Error("Database mode is not active.");
    }

    return db;
  }

  private async ensureSessionBase(options?: SessionOptions) {
    const db = this.database;
    const workspaceSlug = options?.workspaceSlug ?? defaultWorkspaceSlug;

    let [workspace] = await db
      .select()
      .from(workspaces)
      .where(eq(workspaces.slug, workspaceSlug))
      .limit(1);

    if (!workspace) {
      [workspace] = await db
        .insert(workspaces)
        .values({
          name: workspaceSlug === defaultWorkspaceSlug ? defaultWorkspaceName : workspaceSlug,
          slug: workspaceSlug
        })
        .returning();
    }

    let [user] = await db
      .select()
      .from(users)
      .where(eq(users.email, defaultOwnerEmail))
      .limit(1);

    if (!user) {
      [user] = await db
        .insert(users)
        .values({
          email: defaultOwnerEmail,
          name: defaultOwnerName
        })
        .returning();
    }

    return {
      workspace,
      user
    };
  }

  private buildSession(
    workspace: Workspace,
    user: { id: string; name: string; email: string },
    options?: SessionOptions
  ): AppSession {
    return {
      workspace,
      user: {
        ...user,
        role: options?.roleOverride ?? "Owner"
      },
      persistenceMode: "database"
    };
  }

  private async loadThemeIdsByCompany(companyIds: string[]) {
    if (companyIds.length === 0) {
      return new Map<string, string[]>();
    }

    const db = this.database;
    const links = await db
      .select()
      .from(companyThemeLinks)
      .where(inArray(companyThemeLinks.companyId, companyIds));

    const mapping = new Map<string, string[]>();
    for (const link of links) {
      const current = mapping.get(link.companyId) ?? [];
      current.push(link.themeId);
      mapping.set(link.companyId, current);
    }

    return mapping;
  }

  private parseCompanyRelation(row: typeof companyRelations.$inferSelect): CompanyRelation {
    return companyRelationSchema.parse({
      id: row.id,
      companyId: row.companyId,
      targetCompanyId: row.targetCompanyId,
      targetLabel: row.targetLabel,
      relationType: row.relationType,
      confidence: row.confidence,
      sourcePath: row.sourcePath,
      updatedAt: row.updatedAt.toISOString()
    });
  }

  private parseCompanyKeyword(row: typeof companyKeywords.$inferSelect): CompanyKeyword {
    return companyKeywordSchema.parse({
      id: row.id,
      companyId: row.companyId,
      label: row.label,
      confidence: row.confidence,
      sourcePath: row.sourcePath,
      updatedAt: row.updatedAt.toISOString()
    });
  }

  async getSession(options?: SessionOptions) {
    const { workspace, user } = await this.ensureSessionBase(options);
    return this.buildSession(workspace, user, options);
  }

  async listThemes(options?: SessionOptions) {
    const { workspace } = await this.ensureSessionBase(options);
    const db = this.database;

    const rows = await db
      .select()
      .from(themes)
      .where(eq(themes.workspaceId, workspace.id))
      .orderBy(desc(themes.updatedAt));

    const results = [];
    for (const row of rows) {
      const parsed = themeSchema.safeParse({
        id: row.id,
        name: row.name,
        slug: row.slug,
        marketState: row.marketState,
        lifecycle: row.lifecycle,
        priority: row.priority,
        thesis: row.thesis,
        whyNow: row.whyNow,
        bottleneck: row.bottleneck,
        corePoolCount: row.corePoolCount,
        observationPoolCount: row.observationPoolCount,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString()
      });
      if (parsed.success) {
        results.push(parsed.data);
      } else {
        // Log bad row so we can identify and fix it
        console.error(
          `[listThemes] skipping invalid row id=${row.id} slug="${row.slug}" errors=${JSON.stringify(parsed.error.flatten())}`
        );
      }
    }
    return results;
  }

  async getTheme(themeId: string, options?: SessionOptions) {
    const { workspace } = await this.ensureSessionBase(options);
    const db = this.database;

    const [row] = await db
      .select()
      .from(themes)
      .where(and(eq(themes.id, themeId), eq(themes.workspaceId, workspace.id)))
      .limit(1);

    if (!row) {
      return null;
    }

    return themeSchema.parse({
      id: row.id,
      name: row.name,
      slug: row.slug,
      marketState: row.marketState,
      lifecycle: row.lifecycle,
      priority: row.priority,
      thesis: row.thesis,
      whyNow: row.whyNow,
      bottleneck: row.bottleneck,
      corePoolCount: row.corePoolCount,
      observationPoolCount: row.observationPoolCount,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString()
    });
  }

  async createTheme(input: ThemeCreateInput, options?: SessionOptions) {
    const { workspace } = await this.ensureSessionBase(options);
    const db = this.database;

    const [row] = await db
      .insert(themes)
      .values({
        workspaceId: workspace.id,
        name: input.name,
        slug: createSlug(input.name),
        marketState: input.marketState,
        lifecycle: input.lifecycle,
        priority: input.priority,
        thesis: input.thesis,
        whyNow: input.whyNow,
        bottleneck: input.bottleneck,
        corePoolCount: 0,
        observationPoolCount: 0
      })
      .returning();

    return themeSchema.parse({
      id: row.id,
      name: row.name,
      slug: row.slug,
      marketState: row.marketState,
      lifecycle: row.lifecycle,
      priority: row.priority,
      thesis: row.thesis,
      whyNow: row.whyNow,
      bottleneck: row.bottleneck,
      corePoolCount: row.corePoolCount,
      observationPoolCount: row.observationPoolCount,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString()
    });
  }

  async updateTheme(themeId: string, input: ThemeUpdateInput, options?: SessionOptions) {
    const { workspace } = await this.ensureSessionBase(options);
    const db = this.database;

    const [row] = await db
      .update(themes)
      .set({
        ...input,
        // Prefer explicit slug override (for CJK names that createSlug strips to "");
        // fall back to createSlug(name) if name changed; keep existing if neither.
        slug: input.slug
          ? input.slug
          : input.name
            ? createSlug(input.name) || undefined
            : undefined,
        updatedAt: new Date()
      })
      .where(and(eq(themes.id, themeId), eq(themes.workspaceId, workspace.id)))
      .returning();

    if (!row) {
      return null;
    }

    return themeSchema.parse({
      id: row.id,
      name: row.name,
      slug: row.slug,
      marketState: row.marketState,
      lifecycle: row.lifecycle,
      priority: row.priority,
      thesis: row.thesis,
      whyNow: row.whyNow,
      bottleneck: row.bottleneck,
      corePoolCount: row.corePoolCount,
      observationPoolCount: row.observationPoolCount,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString()
    });
  }

  async listCompanies(themeId?: string, options?: SessionOptions) {
    const { workspace } = await this.ensureSessionBase(options);
    const db = this.database;

    const rows = themeId
      ? await db
          .select({
            id: companies.id,
            name: companies.name,
            ticker: companies.ticker,
            market: companies.market,
            country: companies.country,
            chainPosition: companies.chainPosition,
            beneficiaryTier: companies.beneficiaryTier,
            exposure: companies.exposure,
            validation: companies.validation,
            notes: companies.notes,
            updatedAt: companies.updatedAt
          })
          .from(companies)
          .innerJoin(companyThemeLinks, eq(companyThemeLinks.companyId, companies.id))
          .where(
            and(eq(companies.workspaceId, workspace.id), eq(companyThemeLinks.themeId, themeId))
          )
      : await db
          .select()
          .from(companies)
          .where(eq(companies.workspaceId, workspace.id))
          .orderBy(desc(companies.updatedAt));

    const themeIdsByCompany = await this.loadThemeIdsByCompany(rows.map((row) => row.id));

    return rows.map((row) =>
      companySchema.parse({
        id: row.id,
        name: row.name,
        ticker: row.ticker,
        market: row.market,
        country: row.country,
        themeIds: themeIdsByCompany.get(row.id) ?? [],
        chainPosition: row.chainPosition,
        beneficiaryTier: row.beneficiaryTier,
        exposure: exposureBreakdownSchema.parse(row.exposure),
        validation: validationSnapshotSchema.parse(row.validation),
        notes: row.notes,
        updatedAt: row.updatedAt.toISOString()
      })
    );
  }

  async getCompany(companyId: string, options?: SessionOptions) {
    const { workspace } = await this.ensureSessionBase(options);
    const db = this.database;

    const [row] = await db
      .select()
      .from(companies)
      .where(and(eq(companies.id, companyId), eq(companies.workspaceId, workspace.id)))
      .limit(1);

    if (!row) {
      return null;
    }

    const themeIdsByCompany = await this.loadThemeIdsByCompany([row.id]);

    return companySchema.parse({
      id: row.id,
      name: row.name,
      ticker: row.ticker,
      market: row.market,
      country: row.country,
      themeIds: themeIdsByCompany.get(row.id) ?? [],
      chainPosition: row.chainPosition,
      beneficiaryTier: row.beneficiaryTier,
      exposure: exposureBreakdownSchema.parse(row.exposure),
      validation: validationSnapshotSchema.parse(row.validation),
      notes: row.notes,
      updatedAt: row.updatedAt.toISOString()
    });
  }

  async createCompany(input: CompanyCreateInput, options?: SessionOptions) {
    const { workspace } = await this.ensureSessionBase(options);
    const db = this.database;

    const [row] = await db
      .insert(companies)
      .values({
        workspaceId: workspace.id,
        name: input.name,
        ticker: input.ticker,
        market: input.market,
        country: input.country,
        chainPosition: input.chainPosition,
        beneficiaryTier: input.beneficiaryTier,
        exposure: input.exposure,
        validation: input.validation,
        notes: input.notes
      })
      .returning();

    if (input.themeIds.length > 0) {
      await db.insert(companyThemeLinks).values(
        input.themeIds.map((themeId) => ({
          companyId: row.id,
          themeId
        }))
      );
    }

    return companySchema.parse({
      id: row.id,
      name: row.name,
      ticker: row.ticker,
      market: row.market,
      country: row.country,
      themeIds: input.themeIds,
      chainPosition: row.chainPosition,
      beneficiaryTier: row.beneficiaryTier,
      exposure: exposureBreakdownSchema.parse(row.exposure),
      validation: validationSnapshotSchema.parse(row.validation),
      notes: row.notes,
      updatedAt: row.updatedAt.toISOString()
    });
  }

  async updateCompany(companyId: string, input: CompanyUpdateInput, options?: SessionOptions) {
    const { workspace } = await this.ensureSessionBase(options);
    const db = this.database;

    const [row] = await db
      .update(companies)
      .set({
        name: input.name,
        ticker: input.ticker,
        market: input.market,
        country: input.country,
        chainPosition: input.chainPosition,
        beneficiaryTier: input.beneficiaryTier,
        exposure: input.exposure,
        validation: input.validation,
        notes: input.notes,
        updatedAt: new Date()
      })
      .where(and(eq(companies.id, companyId), eq(companies.workspaceId, workspace.id)))
      .returning();

    if (!row) {
      return null;
    }

    if (input.themeIds) {
      await db.delete(companyThemeLinks).where(eq(companyThemeLinks.companyId, companyId));
      if (input.themeIds.length > 0) {
        await db.insert(companyThemeLinks).values(
          input.themeIds.map((themeId) => ({
            companyId,
            themeId
          }))
        );
      }
    }

    const themeIdsByCompany = await this.loadThemeIdsByCompany([row.id]);

    return companySchema.parse({
      id: row.id,
      name: row.name,
      ticker: row.ticker,
      market: row.market,
      country: row.country,
      themeIds: themeIdsByCompany.get(row.id) ?? [],
      chainPosition: row.chainPosition,
      beneficiaryTier: row.beneficiaryTier,
      exposure: exposureBreakdownSchema.parse(row.exposure),
      validation: validationSnapshotSchema.parse(row.validation),
      notes: row.notes,
      updatedAt: row.updatedAt.toISOString()
    });
  }

  async listCompanyRelations(companyId: string, options?: SessionOptions) {
    const { workspace } = await this.ensureSessionBase(options);
    const db = this.database;

    const rows = await db
      .select()
      .from(companyRelations)
      .where(
        and(
          eq(companyRelations.workspaceId, workspace.id),
          eq(companyRelations.companyId, companyId)
        )
      )
      .orderBy(desc(companyRelations.confidence), asc(companyRelations.targetLabel));

    return rows.map((row) => this.parseCompanyRelation(row));
  }

  async replaceCompanyRelations(
    companyId: string,
    input: CompanyRelationInput[],
    options?: SessionOptions
  ) {
    const { workspace } = await this.ensureSessionBase(options);
    const db = this.database;

    await db
      .delete(companyRelations)
      .where(
        and(
          eq(companyRelations.workspaceId, workspace.id),
          eq(companyRelations.companyId, companyId)
        )
      );

    if (input.length === 0) {
      return [] as CompanyRelation[];
    }

    const rows = await db
      .insert(companyRelations)
      .values(
        input.map((relation) => ({
          workspaceId: workspace.id,
          companyId,
          targetCompanyId: relation.targetCompanyId ?? null,
          targetLabel: relation.targetLabel,
          relationType: relation.relationType,
          confidence: relation.confidence,
          sourcePath: relation.sourcePath
        }))
      )
      .returning();

    return rows.map((row) => this.parseCompanyRelation(row));
  }

  async listWorkspaceCompanyRelations(
    filters?: CompanyRelationListFilters,
    options?: SessionOptions
  ) {
    const { workspace } = await this.ensureSessionBase(options);
    const db = this.database;
    const conditions = [eq(companyRelations.workspaceId, workspace.id)];

    if (filters?.companyId) {
      conditions.push(eq(companyRelations.companyId, filters.companyId));
    }

    if (filters?.targetCompanyId) {
      conditions.push(eq(companyRelations.targetCompanyId, filters.targetCompanyId));
    }

    if (filters?.relationType) {
      conditions.push(eq(companyRelations.relationType, filters.relationType as any));
    }

    const rows = await db
      .select()
      .from(companyRelations)
      .where(and(...conditions))
      .orderBy(desc(companyRelations.confidence), asc(companyRelations.targetLabel));

    return rows.map((row) => this.parseCompanyRelation(row));
  }

  async listCompanyKeywords(companyId: string, options?: SessionOptions) {
    const { workspace } = await this.ensureSessionBase(options);
    const db = this.database;

    const rows = await db
      .select()
      .from(companyKeywords)
      .where(
        and(
          eq(companyKeywords.workspaceId, workspace.id),
          eq(companyKeywords.companyId, companyId)
        )
      )
      .orderBy(desc(companyKeywords.confidence), asc(companyKeywords.label));

    return rows.map((row) => this.parseCompanyKeyword(row));
  }

  async replaceCompanyKeywords(
    companyId: string,
    input: CompanyKeywordInput[],
    options?: SessionOptions
  ) {
    const { workspace } = await this.ensureSessionBase(options);
    const db = this.database;

    await db
      .delete(companyKeywords)
      .where(
        and(
          eq(companyKeywords.workspaceId, workspace.id),
          eq(companyKeywords.companyId, companyId)
        )
      );

    if (input.length === 0) {
      return [] as CompanyKeyword[];
    }

    const rows = await db
      .insert(companyKeywords)
      .values(
        input.map((keyword) => ({
          workspaceId: workspace.id,
          companyId,
          label: keyword.label,
          confidence: keyword.confidence,
          sourcePath: keyword.sourcePath
        }))
      )
      .returning();

    return rows.map((row) => this.parseCompanyKeyword(row));
  }

  async listWorkspaceCompanyKeywords(
    filters?: CompanyKeywordListFilters,
    options?: SessionOptions
  ) {
    const { workspace } = await this.ensureSessionBase(options);
    const db = this.database;
    const conditions = [eq(companyKeywords.workspaceId, workspace.id)];

    if (filters?.companyId) {
      conditions.push(eq(companyKeywords.companyId, filters.companyId));
    }

    const rows = await db
      .select()
      .from(companyKeywords)
      .where(and(...conditions))
      .orderBy(desc(companyKeywords.confidence), asc(companyKeywords.label));

    return rows.map((row) => this.parseCompanyKeyword(row));
  }

  // ── Signals ──

  async listSignals(
    filters?: { themeId?: string; companyId?: string; category?: string },
    options?: SessionOptions
  ): Promise<Signal[]> {
    const db = this.database;
    const workspace = await this.ensureSessionBase(options).then((s) => s.workspace);
    const conditions = [eq(signals.workspaceId, workspace.id)];
    if (filters?.category) {
      conditions.push(eq(signals.category, filters.category as any));
    }
    const rows = await db
      .select()
      .from(signals)
      .where(and(...conditions))
      .orderBy(desc(signals.createdAt));

    return rows.map((row) => ({
      id: row.id,
      category: row.category,
      direction: row.direction,
      title: row.title,
      summary: row.summary,
      confidence: row.confidence,
      themeIds: [],
      companyIds: Array.isArray(row.companyIds) ? (row.companyIds as string[]) : [],
      createdAt: row.createdAt.toISOString()
    }));
  }

  async getSignal(signalId: string, options?: SessionOptions): Promise<Signal | null> {
    const db = this.database;
    const workspace = await this.ensureSessionBase(options).then((s) => s.workspace);
    const [row] = await db
      .select()
      .from(signals)
      .where(and(eq(signals.id, signalId), eq(signals.workspaceId, workspace.id)));

    if (!row) return null;

    return {
      id: row.id,
      category: row.category,
      direction: row.direction,
      title: row.title,
      summary: row.summary,
      confidence: row.confidence,
      themeIds: [],
      companyIds: Array.isArray(row.companyIds) ? (row.companyIds as string[]) : [],
      createdAt: row.createdAt.toISOString()
    };
  }

  async createSignal(input: SignalCreateInput, options?: SessionOptions): Promise<Signal> {
    const db = this.database;
    const workspace = await this.ensureSessionBase(options).then((s) => s.workspace);
    const [row] = await db
      .insert(signals)
      .values({
        workspaceId: workspace.id,
        category: input.category,
        direction: input.direction,
        title: input.title,
        summary: input.summary ?? "",
        confidence: input.confidence,
        companyIds: input.companyIds ?? []
      })
      .returning();

    return {
      id: row.id,
      category: row.category,
      direction: row.direction,
      title: row.title,
      summary: row.summary,
      confidence: row.confidence,
      themeIds: [],
      companyIds: Array.isArray(row.companyIds) ? (row.companyIds as string[]) : [],
      createdAt: row.createdAt.toISOString()
    };
  }

  async updateSignal(
    signalId: string,
    input: SignalUpdateInput,
    options?: SessionOptions
  ): Promise<Signal | null> {
    const db = this.database;
    const workspace = await this.ensureSessionBase(options).then((s) => s.workspace);
    const [row] = await db
      .update(signals)
      .set({
        category: input.category,
        direction: input.direction,
        title: input.title,
        summary: input.summary,
        confidence: input.confidence,
        ...(input.companyIds !== undefined ? { companyIds: input.companyIds } : {})
      })
      .where(and(eq(signals.id, signalId), eq(signals.workspaceId, workspace.id)))
      .returning();

    if (!row) return null;

    return {
      id: row.id,
      category: row.category,
      direction: row.direction,
      title: row.title,
      summary: row.summary,
      confidence: row.confidence,
      themeIds: [],
      companyIds: Array.isArray(row.companyIds) ? (row.companyIds as string[]) : [],
      createdAt: row.createdAt.toISOString()
    };
  }

  // ── Trade Plans ──

  private parseExecution(raw: unknown): TradePlanExecution | null {
    if (raw === null || raw === undefined) return null;
    const parsed = tradePlanExecutionSchema.safeParse(raw);
    if (!parsed.success) {
      console.warn(
        "[postgres-repository] dropping malformed trade_plans.execution payload",
        parsed.error.flatten()
      );
      return null;
    }
    return parsed.data;
  }

  private mapTradePlanRow(row: typeof tradePlans.$inferSelect): TradePlan {
    return {
      id: row.id,
      companyId: row.companyId,
      status: row.status,
      entryPlan: row.entryPlan,
      invalidationPlan: row.invalidationPlan,
      targetPlan: row.targetPlan,
      riskReward: row.riskReward,
      notes: "",
      execution: this.parseExecution(row.execution),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString()
    };
  }

  async listTradePlans(
    filters?: { companyId?: string; status?: string },
    options?: SessionOptions
  ): Promise<TradePlan[]> {
    const db = this.database;
    const workspace = await this.ensureSessionBase(options).then((s) => s.workspace);
    const conditions = [eq(tradePlans.workspaceId, workspace.id)];
    if (filters?.companyId) {
      conditions.push(eq(tradePlans.companyId, filters.companyId));
    }
    if (filters?.status) {
      conditions.push(eq(tradePlans.status, filters.status as any));
    }
    const rows = await db
      .select()
      .from(tradePlans)
      .where(and(...conditions))
      .orderBy(desc(tradePlans.createdAt));

    return rows.map((row) => this.mapTradePlanRow(row));
  }

  async getTradePlan(planId: string, options?: SessionOptions): Promise<TradePlan | null> {
    const db = this.database;
    const workspace = await this.ensureSessionBase(options).then((s) => s.workspace);
    const [row] = await db
      .select()
      .from(tradePlans)
      .where(and(eq(tradePlans.id, planId), eq(tradePlans.workspaceId, workspace.id)));

    if (!row) return null;
    return this.mapTradePlanRow(row);
  }

  async createTradePlan(input: TradePlanCreateInput, options?: SessionOptions): Promise<TradePlan> {
    const db = this.database;
    const workspace = await this.ensureSessionBase(options).then((s) => s.workspace);
    const execution = input.execution
      ? tradePlanExecutionSchema.parse(input.execution)
      : null;
    const [row] = await db
      .insert(tradePlans)
      .values({
        workspaceId: workspace.id,
        companyId: input.companyId,
        status: input.status ?? "draft",
        entryPlan: input.entryPlan,
        invalidationPlan: input.invalidationPlan,
        targetPlan: input.targetPlan,
        riskReward: input.riskReward ?? "",
        execution
      })
      .returning();

    return this.mapTradePlanRow(row);
  }

  async updateTradePlan(
    planId: string,
    input: TradePlanUpdateInput,
    options?: SessionOptions
  ): Promise<TradePlan | null> {
    const db = this.database;
    const workspace = await this.ensureSessionBase(options).then((s) => s.workspace);
    // Explicit null clears the execution block; undefined leaves it untouched.
    const executionPatch =
      input.execution === undefined
        ? {}
        : {
            execution:
              input.execution === null
                ? null
                : tradePlanExecutionSchema.parse(input.execution)
          };
    const [row] = await db
      .update(tradePlans)
      .set({
        status: input.status,
        entryPlan: input.entryPlan,
        invalidationPlan: input.invalidationPlan,
        targetPlan: input.targetPlan,
        riskReward: input.riskReward,
        ...executionPatch,
        updatedAt: new Date()
      })
      .where(and(eq(tradePlans.id, planId), eq(tradePlans.workspaceId, workspace.id)))
      .returning();

    if (!row) return null;
    return this.mapTradePlanRow(row);
  }

  // ── Reviews ──

  async listReviews(
    filters?: { tradePlanId?: string },
    options?: SessionOptions
  ): Promise<ReviewEntry[]> {
    const db = this.database;
    const workspace = await this.ensureSessionBase(options).then((s) => s.workspace);
    const conditions = [eq(reviewEntries.workspaceId, workspace.id)];
    if (filters?.tradePlanId) {
      conditions.push(eq(reviewEntries.tradePlanId, filters.tradePlanId));
    }
    const rows = await db
      .select()
      .from(reviewEntries)
      .where(and(...conditions))
      .orderBy(desc(reviewEntries.createdAt));

    return rows.map((row) => ({
      id: row.id,
      tradePlanId: row.tradePlanId,
      outcome: row.outcome,
      attribution: row.attribution,
      lesson: "",
      setupTags: [],
      executionQuality: 3,
      createdAt: row.createdAt.toISOString()
    }));
  }

  async createReview(input: ReviewEntryCreateInput, options?: SessionOptions): Promise<ReviewEntry> {
    const db = this.database;
    const workspace = await this.ensureSessionBase(options).then((s) => s.workspace);
    const [row] = await db
      .insert(reviewEntries)
      .values({
        workspaceId: workspace.id,
        tradePlanId: input.tradePlanId,
        outcome: input.outcome,
        attribution: input.attribution ?? ""
      })
      .returning();

    return {
      id: row.id,
      tradePlanId: row.tradePlanId,
      outcome: row.outcome,
      attribution: row.attribution,
      lesson: "",
      setupTags: [],
      executionQuality: input.executionQuality,
      createdAt: row.createdAt.toISOString()
    };
  }

  // ── Daily Briefs (memory-only for v1, no DB table yet) ──

  private briefs: DailyBrief[] = [];

  async listBriefs(): Promise<DailyBrief[]> {
    return this.briefs.map((b) => ({ ...b, sections: b.sections.map((s) => ({ ...s })) }));
  }

  async createBrief(input: DailyBriefCreateInput): Promise<DailyBrief> {
    const brief: DailyBrief = {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      ...input,
      generatedBy: input.generatedBy ?? "manual",
      status: input.status ?? "draft"
    };
    this.briefs.unshift(brief);
    return { ...brief, sections: brief.sections.map((s) => ({ ...s })) };
  }
}
