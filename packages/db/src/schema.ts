import {
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid
} from "drizzle-orm/pg-core";

export const marketStateEnum = pgEnum("market_state", [
  "Attack",
  "Selective Attack",
  "Balanced",
  "Defense",
  "Preservation"
]);

export const themeLifecycleEnum = pgEnum("theme_lifecycle", [
  "Discovery",
  "Validation",
  "Expansion",
  "Crowded",
  "Distribution"
]);

export const beneficiaryTierEnum = pgEnum("beneficiary_tier", [
  "Core",
  "Direct",
  "Indirect",
  "Observation"
]);

export const signalCategoryEnum = pgEnum("signal_category", [
  "macro",
  "industry",
  "company",
  "price",
  "portfolio"
]);

export const signalDirectionEnum = pgEnum("signal_direction", [
  "bullish",
  "bearish",
  "neutral"
]);

export const tradePlanStatusEnum = pgEnum("trade_plan_status", [
  "draft",
  "ready",
  "active",
  "reduced",
  "closed",
  "canceled"
]);

export const openAliceDeviceStatusEnum = pgEnum("openalice_device_status", [
  "active",
  "revoked"
]);

export const openAliceJobStatusEnum = pgEnum("openalice_job_status", [
  "queued",
  "running",
  "draft_ready",
  "validation_failed",
  "failed",
  "published",
  "rejected"
]);

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
});

export const workspaces = pgTable("workspaces", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
});

export const themes = pgTable("themes", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  marketState: marketStateEnum("market_state").default("Balanced").notNull(),
  lifecycle: themeLifecycleEnum("lifecycle").default("Discovery").notNull(),
  priority: integer("priority").default(3).notNull(),
  thesis: text("thesis").default("").notNull(),
  whyNow: text("why_now").default("").notNull(),
  bottleneck: text("bottleneck").default("").notNull(),
  corePoolCount: integer("core_pool_count").default(0).notNull(),
  observationPoolCount: integer("observation_pool_count").default(0).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
});

export const companies = pgTable("companies", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id),
  name: text("name").notNull(),
  ticker: text("ticker").notNull(),
  market: text("market").notNull(),
  country: text("country").notNull(),
  chainPosition: text("chain_position").notNull(),
  beneficiaryTier: beneficiaryTierEnum("beneficiary_tier").default("Observation").notNull(),
  exposure: jsonb("exposure").default({}).notNull(),
  validation: jsonb("validation").default({}).notNull(),
  notes: text("notes").default("").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
});

export const companyThemeLinks = pgTable(
  "company_theme_links",
  {
    companyId: uuid("company_id").notNull().references(() => companies.id),
    themeId: uuid("theme_id").notNull().references(() => themes.id)
  },
  (table) => ({
    pk: primaryKey({ columns: [table.companyId, table.themeId] })
  })
);

export const signals = pgTable("signals", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id),
  category: signalCategoryEnum("category").notNull(),
  direction: signalDirectionEnum("direction").notNull(),
  title: text("title").notNull(),
  summary: text("summary").default("").notNull(),
  confidence: integer("confidence").default(3).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
});

export const tradePlans = pgTable("trade_plans", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id),
  companyId: uuid("company_id").notNull().references(() => companies.id),
  status: tradePlanStatusEnum("status").default("draft").notNull(),
  entryPlan: text("entry_plan").default("").notNull(),
  invalidationPlan: text("invalidation_plan").default("").notNull(),
  targetPlan: text("target_plan").default("").notNull(),
  riskReward: text("risk_reward").default("").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
});

export const reviewEntries = pgTable("review_entries", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id),
  tradePlanId: uuid("trade_plan_id").notNull().references(() => tradePlans.id),
  outcome: text("outcome").default("").notNull(),
  attribution: text("attribution").default("").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
});

export const auditLogs = pgTable("audit_logs", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id),
  actorId: uuid("actor_id").references(() => users.id),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  payload: jsonb("payload").default({}).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
});

export const openAliceDevices = pgTable(
  "openalice_devices",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id),
    externalDeviceId: text("external_device_id").notNull(),
    deviceName: text("device_name").notNull(),
    capabilities: jsonb("capabilities").default([]).notNull(),
    tokenHash: text("token_hash").notNull(),
    status: openAliceDeviceStatusEnum("status").default("active").notNull(),
    registeredAt: timestamp("registered_at", { withTimezone: true }).defaultNow().notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
  },
  (table) => ({
    externalDeviceIdIdx: uniqueIndex("openalice_devices_external_device_id_idx").on(
      table.externalDeviceId
    )
  })
);

export const openAliceJobs = pgTable("openalice_jobs", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id),
  claimedByDeviceId: uuid("claimed_by_device_id").references(() => openAliceDevices.id),
  status: openAliceJobStatusEnum("status").default("queued").notNull(),
  taskType: text("task_type").notNull(),
  schemaName: text("schema_name").notNull(),
  instructions: text("instructions").notNull(),
  contextRefs: jsonb("context_refs").default([]).notNull(),
  parameters: jsonb("parameters").default({}).notNull(),
  timeoutSeconds: integer("timeout_seconds"),
  result: jsonb("result"),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  claimedAt: timestamp("claimed_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true })
});
