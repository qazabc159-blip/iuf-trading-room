import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  real,
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

export const companyRelationTypeEnum = pgEnum("company_relation_type", [
  "supplier",
  "customer",
  "technology",
  "application",
  "co_occurrence",
  "unknown"
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

export const userRoleEnum = pgEnum("user_role", [
  "Owner",
  "Admin",
  "Analyst",
  "Trader",
  "Viewer"
]);

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash"),
  role: userRoleEnum("role").default("Viewer").notNull(),
  workspaceId: uuid("workspace_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
});

export const inviteCodes = pgTable("invite_codes", {
  id: uuid("id").defaultRandom().primaryKey(),
  code: text("code").notNull().unique(),
  issuedBy: uuid("issued_by").references(() => users.id),
  usedBy: uuid("used_by").references(() => users.id),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
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

export const companyRelations = pgTable(
  "company_relations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    targetCompanyId: uuid("target_company_id").references(() => companies.id),
    targetLabel: text("target_label").notNull(),
    relationType: companyRelationTypeEnum("relation_type").notNull(),
    confidence: real("confidence").default(0.5).notNull(),
    sourcePath: text("source_path").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
  },
  (table) => ({
    companyIdx: index("company_relations_company_idx").on(table.companyId, table.updatedAt),
    targetIdx: index("company_relations_target_idx").on(table.targetCompanyId),
    uniqueEdgeIdx: uniqueIndex("company_relations_unique_edge_idx").on(
      table.workspaceId,
      table.companyId,
      table.targetLabel,
      table.relationType
    )
  })
);

export const companyKeywords = pgTable(
  "company_keywords",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    label: text("label").notNull(),
    confidence: real("confidence").default(0.5).notNull(),
    sourcePath: text("source_path").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
  },
  (table) => ({
    companyIdx: index("company_keywords_company_idx").on(table.companyId, table.updatedAt),
    uniqueKeywordIdx: uniqueIndex("company_keywords_unique_keyword_idx").on(
      table.workspaceId,
      table.companyId,
      table.label
    )
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
  companyIds: jsonb("company_ids").$type<string[]>().default([]).notNull(),
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
  execution: jsonb("execution"),
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
  attemptCount: integer("attempt_count").default(0).notNull(),
  maxAttempts: integer("max_attempts").default(3).notNull(),
  result: jsonb("result"),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  claimedAt: timestamp("claimed_at", { withTimezone: true }),
  lastHeartbeatAt: timestamp("last_heartbeat_at", { withTimezone: true }),
  leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true })
},
  (table) => ({
    workspaceStatusIdx: index("openalice_jobs_workspace_status_idx").on(
      table.workspaceId,
      table.status,
      table.createdAt
    ),
    leaseExpiryIdx: index("openalice_jobs_lease_expires_idx").on(
      table.status,
      table.leaseExpiresAt
    )
  })
);

export const paperBrokerState = pgTable(
  "paper_broker_state",
  {
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id),
    accountId: text("account_id").notNull(),
    state: jsonb("state").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
  },
  (table) => ({
    pk: primaryKey({ columns: [table.workspaceId, table.accountId] })
  })
);

export const executionEvents = pgTable(
  "execution_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id),
    accountId: text("account_id").notNull(),
    orderId: text("order_id").notNull(),
    clientOrderId: text("client_order_id").notNull(),
    type: text("type").notNull(),
    status: text("status").notNull(),
    message: text("message"),
    payload: jsonb("payload"),
    emittedAt: timestamp("emitted_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
  },
  (table) => ({
    workspaceAccountIdx: index("execution_events_workspace_account_idx").on(
      table.workspaceId,
      table.accountId,
      table.emittedAt
    ),
    orderIdx: index("execution_events_order_idx").on(
      table.workspaceId,
      table.orderId
    )
  })
);

// ── Worker-produced content tables ────────────────────────────────────────────

export const dailyBriefs = pgTable("daily_briefs", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id),
  date: text("date").notNull(),
  marketState: text("market_state").notNull().default("Balanced"),
  sections: jsonb("sections").$type<Array<{ heading: string; body: string }>>().notNull().default([]),
  generatedBy: text("generated_by").notNull().default("worker"),
  status: text("status").notNull().default("draft"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
}, (table) => ({
  workspaceDateIdx: index("daily_briefs_workspace_date_idx").on(table.workspaceId, table.date)
}));

export const themeSummaries = pgTable("theme_summaries", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id),
  themeId: uuid("theme_id").notNull().references(() => themes.id),
  summary: text("summary").notNull(),
  companyCount: integer("company_count").notNull().default(0),
  generatedAt: timestamp("generated_at", { withTimezone: true }).defaultNow().notNull()
}, (table) => ({
  themeIdx: index("theme_summaries_theme_idx").on(table.themeId, table.generatedAt)
}));

export const companyNotes = pgTable("company_notes", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id),
  companyId: uuid("company_id").notNull().references(() => companies.id),
  note: text("note").notNull(),
  generatedAt: timestamp("generated_at", { withTimezone: true }).defaultNow().notNull()
}, (table) => ({
  companyIdx: index("company_notes_company_idx").on(table.companyId, table.generatedAt)
}));

// ── P1 Worker-produced content tables ────────────────────────────────────────

export const reviewSummaries = pgTable("review_summaries", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id),
  themeId: uuid("theme_id").notNull().references(() => themes.id),
  bodyMd: text("body_md").notNull(),
  period: text("period").notNull().default("week"),
  generatedAt: timestamp("generated_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
}, (table) => ({
  themeIdx: index("review_summaries_theme_idx").on(table.themeId, table.generatedAt),
  workspacePeriodIdx: index("review_summaries_workspace_period_idx").on(table.workspaceId, table.period, table.generatedAt)
}));

export const signalClusters = pgTable("signal_clusters", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id),
  label: text("label").notNull(),
  memberTickers: jsonb("member_tickers").$type<string[]>().notNull().default([]),
  memberThemes: jsonb("member_themes").$type<string[]>().notNull().default([]),
  rationale_md: text("rationale_md").notNull(),
  generatedAt: timestamp("generated_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
}, (table) => ({
  workspaceIdx: index("signal_clusters_workspace_idx").on(table.workspaceId, table.generatedAt)
}));

// ── OpenAlice content review queue ───────────────────────────────────────────

export const contentDraftStatusEnum = pgEnum("content_draft_status", [
  "awaiting_review",
  "approved",
  "rejected"
]);

export const contentDrafts = pgTable("content_drafts", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id),
  sourceJobId: uuid("source_job_id").references(() => openAliceJobs.id),
  targetTable: text("target_table").notNull(),
  targetEntityId: text("target_entity_id"),
  payload: jsonb("payload").notNull(),
  status: contentDraftStatusEnum("status").default("awaiting_review").notNull(),
  dedupeKey: text("dedupe_key").notNull(),
  producerVersion: text("producer_version").default("v1").notNull(),
  reviewedBy: uuid("reviewed_by").references(() => users.id),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  rejectReason: text("reject_reason"),
  approvedRefId: uuid("approved_ref_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
}, (table) => ({
  workspaceStatusIdx: index("content_drafts_workspace_status_idx").on(
    table.workspaceId, table.status, table.createdAt
  ),
  dedupeKeyIdx: index("content_drafts_dedupe_key_idx").on(table.dedupeKey, table.createdAt),
  statusCreatedIdx: index("content_drafts_status_created_idx").on(table.status, table.createdAt),
  sourceJobIdx: index("content_drafts_source_job_idx").on(table.sourceJobId)
}));

// ── W6 Paper Sprint — paper_orders / paper_fills (migration 0015) ─────────────
// These tables are standalone; no dependency on KGI broker tables.

export const paperOrders = pgTable(
  "paper_orders",
  {
    id:             uuid("id").defaultRandom().primaryKey(),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    symbol:         text("symbol").notNull(),
    side:           text("side", { enum: ["buy", "sell"] }).notNull(),
    orderType:      text("order_type", { enum: ["market", "limit", "stop", "stop_limit"] }).notNull(),
    qty:            integer("qty").notNull(),
    price:          numeric("price", { precision: 14, scale: 4 }),
    status:         text("status", { enum: ["PENDING", "ACCEPTED", "FILLED", "REJECTED", "CANCELLED"] })
                      .notNull()
                      .default("PENDING"),
    reason:         text("reason"),
    userId:         uuid("user_id").notNull(),
    intentId:       uuid("intent_id").notNull(),
    createdAt:      timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt:      timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
  },
  (table) => ({
    idempotencyKeyIdx: uniqueIndex("paper_orders_idempotency_key_idx").on(table.idempotencyKey),
    userIdIdx:         index("paper_orders_user_id_idx").on(table.userId),
    symbolIdx:         index("paper_orders_symbol_idx").on(table.symbol, table.createdAt)
  })
);

export const paperFills = pgTable(
  "paper_fills",
  {
    id:          uuid("id").defaultRandom().primaryKey(),
    orderId:     uuid("order_id").notNull().references(() => paperOrders.id, { onDelete: "cascade" }),
    fillQty:     integer("fill_qty").notNull(),
    fillPrice:   numeric("fill_price", { precision: 14, scale: 4 }).notNull(),
    fillTime:    timestamp("fill_time", { withTimezone: true }).notNull(),
    simulatedAt: timestamp("simulated_at", { withTimezone: true }).defaultNow().notNull()
  },
  (table) => ({
    orderIdIdx: index("paper_fills_order_id_idx").on(table.orderId)
  })
);
