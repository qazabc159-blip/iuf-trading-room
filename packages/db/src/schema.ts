import {
  bigint,
  boolean,
  date,
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

export const companies = pgTable(
  "companies",
  {
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
  },
  (table) => ({
    workspaceTickerUidx: uniqueIndex("companies_workspace_ticker_uidx").on(
      table.workspaceId,
      table.ticker
    )
  })
);

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

// User-managed watchlist for the trade desk. Replaces the hardcoded default
// watchlist — each user curates their own symbols (add/remove, persisted).
export const userWatchlist = pgTable(
  "user_watchlist",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id),
    userId: uuid("user_id").notNull().references(() => users.id),
    symbol: text("symbol").notNull(),
    name: text("name").default("").notNull(),
    sortOrder: real("sort_order").default(0).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
  },
  (table) => ({
    userSymbolUidx: uniqueIndex("user_watchlist_user_symbol_uidx").on(
      table.workspaceId,
      table.userId,
      table.symbol
    )
  })
);

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
    // quantity_unit: 'LOT' = board lot (1000 shares); 'SHARE' = odd-lot (1–999).
    // Migration 0020 adds this column; default 'LOT' for backward compat.
    quantityUnit:   text("quantity_unit", { enum: ["SHARE", "LOT"] }).notNull().default("LOT"),
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

// ── W7 D3: OHLCV bars per company ─────────────────────────────────────────────
// migration 0017_companies_ohlcv.sql

export const companiesOhlcv = pgTable(
  "companies_ohlcv",
  {
    id:          uuid("id").defaultRandom().primaryKey(),
    companyId:   uuid("company_id").notNull(),
    workspaceId: uuid("workspace_id").notNull(),
    dt:          date("dt").notNull(),
    interval:    text("interval", { enum: ["1d", "1w", "1m"] }).notNull().default("1d"),
    open:        numeric("open",  { precision: 14, scale: 4 }).notNull(),
    high:        numeric("high",  { precision: 14, scale: 4 }).notNull(),
    low:         numeric("low",   { precision: 14, scale: 4 }).notNull(),
    close:       numeric("close", { precision: 14, scale: 4 }).notNull(),
    volume:      bigint("volume", { mode: "number" }).notNull().default(0),
    source:      text("source", { enum: ["mock", "kgi", "tej"] }).notNull().default("mock"),
    createdAt:   timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
  },
  (table) => ({
    companyDtIntervalUidx: uniqueIndex("companies_ohlcv_company_dt_interval_uidx").on(
      table.companyId, table.dt, table.interval
    ),
    workspaceDtIdx: index("companies_ohlcv_workspace_dt_idx").on(table.workspaceId, table.dt),
    companyDtIdx:   index("companies_ohlcv_company_dt_idx").on(table.companyId, table.dt)
  })
);

// ── W7 D3: Daily AI-generated theme summary ────────────────────────────────────
// migration 0018_daily_theme_summaries.sql

export const dailyThemeSummaries = pgTable(
  "daily_theme_summaries",
  {
    id:               uuid("id").defaultRandom().primaryKey(),
    workspaceId:      uuid("workspace_id").notNull(),
    dt:               text("dt").notNull(),
    summaryMd:        text("summary_md").notNull(),
    themeLabel:       text("theme_label").notNull().default(""),
    sourceEventCount: integer("source_event_count").notNull().default(0),
    generatedBy:      text("generated_by").notNull().default("worker_cron"),
    createdAt:        timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
  },
  (table) => ({
    workspaceDtUidx: uniqueIndex("daily_theme_summaries_workspace_dt_uidx").on(
      table.workspaceId, table.dt
    ),
    dtIdx: index("daily_theme_summaries_dt_idx").on(table.dt)
  })
);

// ── Strategy Runs — migration 0029_strategy_runs.sql ──────────────────────────
// Replaces ephemeral filesystem JSONL (runtime-data/strategy-runs/).
// One row per strategy run; payload JSONB holds full StrategyRunRecord.

export const strategyRuns = pgTable(
  "strategy_runs",
  {
    id:                 uuid("id").defaultRandom().primaryKey(),
    workspaceId:        uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "restrict" }),
    strategyId:         text("strategy_id").notNull(),
    runLabel:           text("run_label").notNull(),
    status:             text("status", { enum: ["queued", "running", "passed", "failed", "blocked"] })
                          .notNull()
                          .default("queued"),
    createdAt:          timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt:          timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    candidatesCount:    integer("candidates_count").notNull().default(0),
    observableCount:    integer("observable_count").notNull().default(0),
    pendingReviewCount: integer("pending_review_count").notNull().default(0),
    rejectedCount:      integer("rejected_count").notNull().default(0),
    payload:            jsonb("payload").notNull().default({})
  },
  (table) => ({
    workspaceCreatedIdx: index("idx_strategy_runs_workspace_created").on(table.workspaceId, table.createdAt),
    workspaceStatusIdx:  index("idx_strategy_runs_workspace_status").on(table.workspaceId, table.status)
  })
);

// ── UTA Phase A — migration 0032_uta_phase_a.sql ──────────────────────────────
// BrokerAdapter abstraction layer: registry + workspace account bindings + unified orders.
// AGPL compliance: design-only inspiration from OpenAlice README/docs. All code is IUF-original.

export const brokerAdapters = pgTable("broker_adapters", {
  adapterKey:           text("adapter_key").primaryKey(),
  displayName:          text("display_name").notNull(),
  capOddLot:            boolean("cap_odd_lot").notNull().default(false),
  capMarginTrading:     boolean("cap_margin_trading").notNull().default(false),
  capShortSelling:      boolean("cap_short_selling").notNull().default(false),
  capAfterHoursFix:     boolean("cap_after_hours_fix").notNull().default(false),
  capSimMode:           boolean("cap_sim_mode").notNull().default(false),
  capMaxSubscriptions:  integer("cap_max_subscriptions").notNull().default(0),
  isActive:             boolean("is_active").notNull().default(true),
  createdAt:            timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt:            timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
});

export const brokerAccounts = pgTable(
  "broker_accounts",
  {
    id:            uuid("id").defaultRandom().primaryKey(),
    workspaceId:   uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    adapterKey:    text("adapter_key").notNull().references(() => brokerAdapters.adapterKey, { onDelete: "restrict" }),
    accountRef:    text("account_ref").notNull(),
    accountLabel:  text("account_label").notNull().default(""),
    // allocation_ratio: fraction 0.0–1.0 (not a percentage). CHECK enforced in DB.
    allocationRatio: numeric("allocation_ratio", { precision: 5, scale: 4 }).notNull().default("1.0"),
    isPrimary:     boolean("is_primary").notNull().default(false),
    isActive:      boolean("is_active").notNull().default(true),
    createdAt:     timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt:     timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
  },
  (table) => ({
    workspaceAdapterRefUidx: uniqueIndex("broker_accounts_workspace_adapter_ref_uidx").on(
      table.workspaceId, table.adapterKey, table.accountRef
    ),
    workspaceIdx: index("broker_accounts_workspace_idx").on(table.workspaceId),
    adapterIdx:   index("broker_accounts_adapter_idx").on(table.adapterKey)
  })
);

// broker_gateway_pairings — UTA Phase 2 後續 (Option A customer-side gateway).
// Pairing between an IUF broker_account and a customer-run gateway agent. Stores
// token HASHES + liveness only — NEVER broker credentials (those stay client-side).
export const brokerGatewayPairings = pgTable(
  "broker_gateway_pairings",
  {
    id:               uuid("id").defaultRandom().primaryKey(),
    brokerAccountId:  uuid("broker_account_id").notNull().references(() => brokerAccounts.id, { onDelete: "cascade" }),
    workspaceId:      uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    // SHA-256 hash of the one-time pairing token (plaintext returned once at issuance).
    pairingTokenHash: text("pairing_token_hash").notNull(),
    // lifecycle: pending → paired → revoked|expired
    status:           text("status", { enum: ["pending", "paired", "revoked", "expired"] }).notNull().default("pending"),
    gatewayLabel:     text("gateway_label").notNull().default(""),
    // SHA-256 hash of the long-lived gateway session token (set on register, slice 2).
    gatewayTokenHash: text("gateway_token_hash"),
    pairedAt:         timestamp("paired_at", { withTimezone: true }),
    lastHeartbeatAt:  timestamp("last_heartbeat_at", { withTimezone: true }),
    expiresAt:        timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt:        timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt:        timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
  },
  (table) => ({
    // Full unique on the pairing token hash (matches migration 0047).
    pairingTokenUidx: uniqueIndex("broker_gateway_pairings_pairing_token_uidx").on(table.pairingTokenHash),
    workspaceIdx:     index("broker_gateway_pairings_workspace_idx").on(table.workspaceId)
    // NOTE: the partial UNIQUE indexes (one-active-per-account; gateway_token_hash
    // WHERE NOT NULL) are created by migration 0047 — drizzle metadata here omits
    // them because partial indexes are not the source of truth (migrations are).
  })
);

export const unifiedOrders = pgTable(
  "unified_orders",
  {
    id:               uuid("id").defaultRandom().primaryKey(),
    workspaceId:      uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "restrict" }),
    brokerAccountId:  uuid("broker_account_id").references(() => brokerAccounts.id, { onDelete: "set null" }),
    adapterKey:       text("adapter_key").notNull(),
    symbol:           text("symbol").notNull(),
    action:           text("action", { enum: ["Buy", "Sell"] }).notNull(),
    qty:              integer("qty").notNull(),
    // quantity_unit: 'LOT' = board lot (1000 shares TW); 'SHARE' = odd-lot (1–999). Matches paper_orders/kgi_orders.
    quantityUnit:     text("quantity_unit", { enum: ["SHARE", "LOT"] }).notNull().default("LOT"),
    priceType:        text("price_type", { enum: ["Market", "Limit", "LimitUp", "LimitDown"] }).notNull(),
    limitPrice:       numeric("limit_price", { precision: 14, scale: 4 }),
    orderCond:        text("order_cond", { enum: ["Cash", "Margin", "ShortSelling", "LendSelling"] }),
    oddLot:           boolean("odd_lot").notNull().default(false),
    status:           text("status", { enum: ["pending", "submitted", "partial_fill", "filled", "cancelled", "rejected"] })
                        .notNull()
                        .default("pending"),
    idempotencyKey:   text("idempotency_key").unique(),
    externalOrderId:  text("external_order_id"),
    filledQty:        integer("filled_qty").notNull().default(0),
    filledPrice:      numeric("filled_price", { precision: 14, scale: 4 }),
    submittedAt:      timestamp("submitted_at", { withTimezone: true }),
    filledAt:         timestamp("filled_at", { withTimezone: true }),
    cancelledAt:      timestamp("cancelled_at", { withTimezone: true }),
    actorId:          uuid("actor_id"),
    adapterResponse:  jsonb("adapter_response"),
    createdAt:        timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt:        timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
  },
  (table) => ({
    workspaceCreatedIdx:  index("unified_orders_workspace_created_idx").on(table.workspaceId, table.createdAt),
    workspaceStatusIdx:   index("unified_orders_workspace_status_idx").on(table.workspaceId, table.status),
    brokerAccountIdx:     index("unified_orders_broker_account_idx").on(table.brokerAccountId)
  })
);

// ── EventLog Phase A — migration 0033_eventlog_phase_a.sql ───────────────────
// Append-only event store with per-stream sequence numbers and time-travel API.
// NOTE: "el_" prefix used to avoid collision with iuf_events (migration 0025, event-rule-engine).
// AGPL compliance: design-only inspiration from OpenAlice README/docs. All code is IUF-original.

export const elEventStreams = pgTable(
  "el_event_streams",
  {
    id:          uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "restrict" }),
    // stream_type: logical category (strategy / order / workspace / session / kgi)
    streamType:  text("stream_type").notNull(),
    // stream_id: entity key within stream_type namespace (e.g. "cont_liq_v36")
    streamId:    text("stream_id").notNull(),
    metadata:    jsonb("metadata").notNull().default({}),
    createdAt:   timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
  },
  (table) => ({
    workspaceTypeIdUidx: uniqueIndex("el_event_streams_workspace_type_id_uidx").on(
      table.workspaceId, table.streamType, table.streamId
    ),
    workspaceIdx: index("el_event_streams_workspace_idx").on(table.workspaceId),
    typeIdx:      index("el_event_streams_type_idx").on(table.streamType)
  })
);

export const elEvents = pgTable(
  "el_events",
  {
    id:            uuid("id").defaultRandom().primaryKey(),
    streamId:      uuid("stream_id").notNull().references(() => elEventStreams.id, { onDelete: "restrict" }),
    // seq: per-stream monotonic sequence number. Generated inside TX: SELECT MAX(seq)+1 FOR UPDATE.
    seq:           bigint("seq", { mode: "number" }).notNull(),
    // event_type: dotted namespaced string e.g. "strategy.subscribed", "order.filled"
    eventType:     text("event_type").notNull(),
    // schema_version: payload format version (1 = Phase A). Increment on breaking payload changes.
    schemaVersion: integer("schema_version").notNull().default(1),
    // actor_id: null for system-generated events (cron, scheduler)
    actorId:       uuid("actor_id"),
    payload:       jsonb("payload").notNull().default({}),
    // occurred_at: business clock — when the event happened (caller-supplied or defaults to now)
    occurredAt:    timestamp("occurred_at", { withTimezone: true }).defaultNow().notNull(),
    // recorded_at: server write clock — always server-assigned
    recordedAt:    timestamp("recorded_at", { withTimezone: true }).defaultNow().notNull()
  },
  (table) => ({
    streamSeqUidx:       uniqueIndex("el_events_stream_seq_uidx").on(table.streamId, table.seq),
    // NOTE: el_events_stream_seq_idx removed — UNIQUE (stream_id, seq) already builds a B-tree index.
    // Adding a separate CREATE INDEX on the same columns would double write cost with zero read benefit.
    eventTypeRecordedIdx: index("el_events_event_type_recorded_idx").on(table.eventType, table.recordedAt),
    streamOccurredIdx:   index("el_events_stream_occurred_idx").on(table.streamId, table.occurredAt)
  })
);

export const elEventSnapshots = pgTable(
  "el_event_snapshots",
  {
    id:        uuid("id").defaultRandom().primaryKey(),
    streamId:  uuid("stream_id").notNull().references(() => elEventStreams.id, { onDelete: "restrict" }),
    // up_to_seq: snapshot covers stream state through (inclusive) this seq.
    upToSeq:   bigint("up_to_seq", { mode: "number" }).notNull(),
    state:     jsonb("state").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
  },
  (table) => ({
    streamSeqIdx: index("el_event_snapshots_stream_seq_idx").on(table.streamId, table.upToSeq)
  })
);

// -- Brain Phase A -- migration 0034_brain_phase_a.sql
// LLM model registry + call ledger + daily cost rollup.
// Yang 5/17 critical mandate: unified LLM gateway + cost tracking + model registry.

export const llmModelsRegistry = pgTable("llm_models_registry", {
  id:                        uuid("id").defaultRandom().primaryKey(),
  modelKey:                  text("model_key").notNull().unique(),
  provider:                  text("provider").notNull(),
  displayName:               text("display_name").notNull(),
  inputPricePer1mTokens:     numeric("input_price_per_1m_tokens", { precision: 10, scale: 6 }).notNull().default("0"),
  outputPricePer1mTokens:    numeric("output_price_per_1m_tokens", { precision: 10, scale: 6 }).notNull().default("0"),
  maxContextTokens:          integer("max_context_tokens").notNull().default(128000),
  capabilities:              jsonb("capabilities").notNull().default({}),
  isActive:                  boolean("is_active").notNull().default(true),
  createdAt:                 timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
});

export const llmCalls = pgTable(
  "llm_calls",
  {
    id:               uuid("id").defaultRandom().primaryKey(),
    workspaceId:      uuid("workspace_id").references(() => workspaces.id, { onDelete: "restrict" }),
    modelKey:         text("model_key").notNull(),
    callerModule:     text("caller_module").notNull(),
    taskType:         text("task_type").notNull(),
    promptTokens:     integer("prompt_tokens").notNull().default(0),
    completionTokens: integer("completion_tokens").notNull().default(0),
    totalTokens:      integer("total_tokens").notNull().default(0),
    costUsd:          numeric("cost_usd", { precision: 10, scale: 8 }).notNull().default("0"),
    latencyMs:        integer("latency_ms"),
    status:           text("status").notNull().default("success"),
    errorCode:        text("error_code"),
    inputSummary:     text("input_summary"),
    outputSummary:    text("output_summary"),
    createdAt:        timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
  },
  (table) => ({
    workspaceCreatedIdx: index("llm_calls_workspace_created_idx").on(table.workspaceId, table.createdAt),
    modelCreatedIdx:     index("llm_calls_model_created_idx").on(table.modelKey, table.createdAt),
    callerCreatedIdx:    index("llm_calls_caller_created_idx").on(table.callerModule, table.createdAt),
    createdAtIdx:        index("llm_calls_created_at_idx").on(table.createdAt)
  })
);

export const llmCostDaily = pgTable(
  "llm_cost_daily",
  {
    id:           uuid("id").defaultRandom().primaryKey(),
    workspaceId:  uuid("workspace_id").references(() => workspaces.id, { onDelete: "restrict" }),
    date:         date("date").notNull(),
    totalCalls:   integer("total_calls").notNull().default(0),
    totalTokens:  integer("total_tokens").notNull().default(0),
    totalCostUsd: numeric("total_cost_usd", { precision: 10, scale: 6 }).notNull().default("0"),
    byModel:      jsonb("by_model").notNull().default({}),
    byModule:     jsonb("by_module").notNull().default({}),
    createdAt:    timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt:    timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
  },
  (table) => ({
    workspaceDateUidx: uniqueIndex("llm_cost_daily_workspace_date_uidx").on(table.workspaceId, table.date),
    dateIdx:           index("llm_cost_daily_date_idx").on(table.date)
  })
);

// -- Portfolio Snapshots -- migration 0037_portfolio_snapshots.sql
// Trading-as-Git Phase A: portfolio state version control.
// Each snapshot is a "git commit" of the full positions object.
// parent_id forms a linked list (null = root).
export const portfolioSnapshots = pgTable(
  "portfolio_snapshots",
  {
    id:            uuid("id").defaultRandom().primaryKey(),
    workspaceId:   uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "restrict" }),
    // parent_id: self-referential FK declared in SQL migration. Drizzle doesn't support
    // recursive table self-reference at declaration time, so FK is SQL-only (migration 0037).
    parentId:      uuid("parent_id"),
    // positions: object keyed by ticker — { [ticker]: { shares, avgCost, sector?, lastPrice? } }
    positions:     jsonb("positions").notNull().default({}),
    // trigger: what caused this snapshot to be taken
    trigger:       text("trigger").notNull(),
    // trigger_ref_id: optional reference to triggering entity (strategy run id, order id, etc.)
    triggerRefId:  text("trigger_ref_id"),
    metadata:      jsonb("metadata").notNull().default({}),
    createdAt:     timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
  },
  (table) => ({
    workspaceCreatedIdx: index("portfolio_snapshots_workspace_created_idx").on(table.workspaceId, table.createdAt.desc()),
    parentIdx:           index("portfolio_snapshots_parent_idx").on(table.parentId)
  })
);

export const portfolioDiffs = pgTable(
  "portfolio_diffs",
  {
    id:               uuid("id").defaultRandom().primaryKey(),
    // from_snapshot_id: older snapshot (null = diff from empty portfolio)
    fromSnapshotId:   uuid("from_snapshot_id").references(() => portfolioSnapshots.id, { onDelete: "restrict" }),
    // to_snapshot_id: newer snapshot that was just created
    toSnapshotId:     uuid("to_snapshot_id").notNull().references(() => portfolioSnapshots.id, { onDelete: "restrict" }),
    // added_positions: tickers present in to but not from
    addedPositions:   jsonb("added_positions").notNull().default({}),
    // removed_positions: tickers present in from but not to
    removedPositions: jsonb("removed_positions").notNull().default({}),
    // changed_positions: tickers in both but with different field values
    changedPositions: jsonb("changed_positions").notNull().default({}),
    summary:          text("summary").notNull().default(""),
    createdAt:        timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
  },
  (table) => ({
    fromSnapshotIdx: index("portfolio_diffs_from_snapshot_idx").on(table.fromSnapshotId),
    toSnapshotIdx:   index("portfolio_diffs_to_snapshot_idx").on(table.toSnapshotId)
  })
);

// -- News AI Selections -- migration 0035_news_ai_selections.sql
// Persists each AI news selection run result.
// Boot recovery reads latest row instead of starting with never_run state.
export const newsAiSelections = pgTable(
  "news_ai_selections",
  {
    id:             text("id").primaryKey(),
    asOf:           timestamp("as_of", { withTimezone: true }).notNull(),
    windowLabel:    text("window_label").notNull(),
    selectionMode:  text("selection_mode").notNull(),
    items:          jsonb("items").notNull().default([]),
    inputRowCount:  integer("input_row_count").notNull().default(0),
    aiCallSuccess:  boolean("ai_call_success").notNull().default(false),
    createdAt:      timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
  },
  (table) => ({
    asOfIdx: index("news_ai_selections_as_of_idx").on(table.asOf.desc())
  })
);

// -- ToolCenter Phase A -- migration 0038_toolcenter_phase_a.sql
// Central manifest registry for OpenAlice tools.
// Phase A: registry + audit records only (no logic changes to underlying tools).

export const tools = pgTable(
  "tools",
  {
    id:           uuid("id").defaultRandom().primaryKey(),
    toolKey:      text("tool_key").notNull().unique(),
    toolType:     text("tool_type").notNull(),
    displayName:  text("display_name"),
    description:  text("description"),
    inputSchema:  jsonb("input_schema").notNull().default({}),
    outputSchema: jsonb("output_schema").notNull().default({}),
    isActive:     boolean("is_active").notNull().default(true),
    capabilities: jsonb("capabilities").notNull().default({}),
    createdAt:    timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
  },
  (table) => ({
    typeIdx:   index("tools_type_idx").on(table.toolType),
    activeIdx: index("tools_active_idx").on(table.isActive)
  })
);

export const toolCalls = pgTable(
  "tool_calls",
  {
    id:            uuid("id").defaultRandom().primaryKey(),
    toolKey:       text("tool_key").notNull(),
    callerType:    text("caller_type").notNull(),
    workspaceId:   uuid("workspace_id").references(() => workspaces.id, { onDelete: "restrict" }),
    inputSummary:  text("input_summary"),
    outputSummary: text("output_summary"),
    status:        text("status").notNull(),
    latencyMs:     integer("latency_ms"),
    errorMessage:  text("error_message"),
    createdAt:     timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
  },
  (table) => ({
    keyCreatedIdx:  index("tool_calls_key_created_idx").on(table.toolKey, table.createdAt.desc()),
    workspaceIdx:   index("tool_calls_workspace_idx").on(table.workspaceId),
    statusIdx:      index("tool_calls_status_idx").on(table.status),
    createdAtIdx:   index("tool_calls_created_at_idx").on(table.createdAt.desc())
  })
);

// -- EventLog Phase B Outbox -- migration 0039_eventlog_outbox.sql
// Transactional outbox table: written atomically with el_events INSERT.
// Background poller drains el_outbox rows → SSE broadcast → marks delivered.
// Prevents event loss if worker crashes between DB write and in-process broadcast.
export const elOutbox = pgTable(
  "el_outbox",
  {
    id:          uuid("id").defaultRandom().primaryKey(),
    // event_id: FK to el_events (written in same TX as the event row)
    eventId:     uuid("event_id").notNull().references(() => elEvents.id, { onDelete: "cascade" }),
    // stream_id: denormalized for fast poller query
    streamId:    uuid("stream_id").notNull().references(() => elEventStreams.id, { onDelete: "cascade" }),
    // event_type: denormalized for SSE routing
    eventType:   text("event_type").notNull(),
    // payload: denormalized snapshot avoids JOIN on broadcast
    payload:     jsonb("payload").notNull().default({}),
    // seq: denormalized for ordered delivery
    seq:         bigint("seq", { mode: "number" }).notNull(),
    createdAt:   timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    // delivered_at: NULL = pending; set to NOW() on success; 1970-01-01 = fatally failed
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    // error_count: >= 5 => mark as fatally failed (deliveredAt = epoch)
    errorCount:  integer("error_count").notNull().default(0)
  },
  (table) => ({
    // partial index on pending rows only (poller uses this exclusively)
    pendingIdx: index("el_outbox_pending_idx").on(table.createdAt)
  })
);

// -- Brain ReAct Phase A -- migration 0040_brain_decisions.sql
// brain_decisions: one row per Brain ReAct invocation.
// react_trace: JSONB array of {round, thought, toolName, toolInput, observation, tokensUsed}
// Phase A scope: read-only tools only. No write-ops, no broker side-effects.
export const brainDecisions = pgTable(
  "brain_decisions",
  {
    id:            uuid("id").defaultRandom().primaryKey(),
    // workspace_id: NULL = system-level (Owner-triggered) invocation
    workspaceId:   uuid("workspace_id").references(() => workspaces.id, { onDelete: "restrict" }),
    // run_id: unique per invocation, UUID as text
    runId:         text("run_id").notNull().unique(),
    // prompt: {intent, contextData?, toolWhitelist?}
    prompt:        jsonb("prompt").notNull().default({}),
    // react_trace: [{round, thought, toolName, toolInput, observation, tokensUsed}]
    // Final step has toolName = null (Final Answer round, no tool call)
    reactTrace:    jsonb("react_trace").notNull().default([]),
    // final_report: markdown analysis report produced after loop ends
    finalReport:   text("final_report"),
    totalTokens:   integer("total_tokens").notNull().default(0),
    totalCostUsd:  numeric("total_cost_usd", { precision: 10, scale: 8 }).notNull().default("0"),
    // status: running | complete | failed | budget_exceeded
    status:        text("status").notNull().default("running"),
    createdAt:     timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    completedAt:   timestamp("completed_at", { withTimezone: true })
  },
  (table) => ({
    workspaceCreatedIdx: index("brain_decisions_workspace_created_idx").on(table.workspaceId, table.createdAt.desc()),
    statusIdx:           index("brain_decisions_status_idx").on(table.status, table.createdAt.desc())
  })
);

// -- AI Recommendations v2 -- migration 0041_ai_recommendations_v2.sql
// ai_recommendations_runs: one row per Brain ReAct AI recommendation generation run.
// Pure-AI judgment — no Athena fixture dependency.
// items: JSONB array of StockRecommendation objects.
// react_trace: JSONB array of ReAct steps (same shape as brain_decisions.react_trace).
export const aiRecommendationsRuns = pgTable(
  "ai_recommendations_runs",
  {
    id:                   uuid("id").defaultRandom().primaryKey(),
    // workspace_id: NULL = system-level Owner-triggered run
    workspaceId:          uuid("workspace_id").references(() => workspaces.id, { onDelete: "restrict" }),
    // run_id: unique per invocation, server-generated UUID as text
    runId:                text("run_id").notNull().unique(),
    generatedAt:          timestamp("generated_at", { withTimezone: true }).defaultNow().notNull(),
    model:                text("model").notNull().default("gpt-4o-mini"),
    // status: running | complete | failed | budget_exceeded | market_risk_off | insufficient_tools | synthesis_format_error
    status:               text("status").notNull().default("running"),
    // items: [{id, ticker, companyName, action, confidence, entryPriceRange, tp1, tp2, stopLoss, rationale, bucket}]
    items:                jsonb("items").notNull().default([]),
    // react_trace: [{round, thought, toolName, toolInput, observation, tokensUsed}]
    reactTrace:           jsonb("react_trace").notNull().default([]),
    // final_report_markdown: raw markdown from Brain synthesis step
    finalReportMarkdown:  text("final_report_markdown"),
    costUsd:              numeric("cost_usd", { precision: 10, scale: 8 }).notNull().default("0"),
    totalTokens:          integer("total_tokens").notNull().default(0),
    // trigger: how this run was initiated
    trigger:              text("trigger").notNull().default("manual_refresh"),
    // score_breakdown: run-level 7-axis SOP summary (migration 0043)
    // Shape: {itemCount, incompleteCount, ratingDistribution, avgTotalScore, topRating}
    // DB CHECK constraint: score_breakdown IS NULL OR jsonb_typeof(score_breakdown) = 'object'
    // (constraint name: ai_recommendations_runs_score_breakdown_obj_chk — see migration 0043)
    // Drizzle does not express jsonb_typeof() checks natively; constraint lives in DB only.
    scoreBreakdown:       jsonb("score_breakdown"),
    createdAt:            timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    completedAt:          timestamp("completed_at", { withTimezone: true })
  },
  (table) => ({
    generatedAtIdx:       index("ai_rec_runs_generated_at_idx").on(table.generatedAt.desc()),
    workspaceStatusIdx:   index("ai_rec_runs_workspace_status_idx").on(table.workspaceId, table.status, table.generatedAt.desc())
  })
);

// -- AI Rec Pick Snapshots -- migration 0044_ai_rec_pick_snapshots.sql
// ai_rec_pick_snapshots: one row per (pick_date, ticker) — daily forward-performance tracking.
// Records each v3 pick with entry price at snapshot time, then daily cron fills ret_1d/5d/20d
// and excess returns vs TAIEX.
export const aiRecPickSnapshots = pgTable(
  "ai_rec_pick_snapshots",
  {
    id:             uuid("id").defaultRandom().primaryKey(),
    // pick_date: TST calendar date of the AI pick (YYYY-MM-DD)
    pickDate:       date("pick_date").notNull(),
    // ticker: 4-digit TWSE ticker
    ticker:         text("ticker").notNull(),
    // bucket: A+ / A / B / C per Yang SOP
    bucket:         text("bucket").notNull(),
    // action: v3 action string
    action:         text("action").notNull(),
    // confidence: LLM confidence [0,1]
    confidence:     real("confidence"),
    // total_score: Yang SOP 7-axis composite [0,100]
    totalScore:     real("total_score"),
    // pick_price: closing price at time of snapshot (companies_ohlcv)
    pickPrice:      numeric("pick_price", { precision: 12, scale: 2 }),
    // entry zone from v3 STEP 5
    entryLow:       numeric("entry_low", { precision: 12, scale: 2 }),
    entryHigh:      numeric("entry_high", { precision: 12, scale: 2 }),
    // profit targets and stop from v3 STEP 5
    tp1:            numeric("tp1", { precision: 12, scale: 2 }),
    tp2:            numeric("tp2", { precision: 12, scale: 2 }),
    stopLoss:       numeric("stop_loss", { precision: 12, scale: 2 }),
    // run_id: links back to ai_recommendations_runs.run_id for full trace
    runId:          text("run_id").notNull(),
    // Forward return columns (updated by daily cron after market close)
    ret1d:          real("ret_1d"),
    ret5d:          real("ret_5d"),
    ret20d:         real("ret_20d"),
    // Excess returns vs TAIEX benchmark
    excess1d:       real("excess_1d"),
    excess5d:       real("excess_5d"),
    excess20d:      real("excess_20d"),
    // Last time forward returns were updated (NULL = not yet computed)
    retUpdatedAt:   timestamp("ret_updated_at", { withTimezone: true }),
    createdAt:      timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    pickDateIdx:        index("ai_rec_pick_snaps_pick_date_idx").on(table.pickDate.desc()),
    bucketIdx:          index("ai_rec_pick_snaps_bucket_idx").on(table.bucket, table.pickDate.desc()),
    retUpdatedIdx:      index("ai_rec_pick_snaps_ret_updated_idx").on(table.retUpdatedAt, table.pickDate.desc()),
  })
);

// -- iuf_decisions -- migration 0046_iuf_decisions.sql
// OpenAlice M1 decision layer: orchestrator consumes iuf_events + signals →
// LLM reasoning → decision rows. M1 writes status='proposed' only; M2 executes.
// UNIQUE (trigger_type, trigger_id): same event/signal never produces two decisions.
// DB-side CHECK constraints on action_type, status, confidence, priority, cost_usd,
// and JSONB type guards on trigger_ref / action_payload / outcome (see migration SQL).
export const iufDecisions = pgTable(
  "iuf_decisions",
  {
    id:            uuid("id").defaultRandom().primaryKey(),
    // trigger provenance
    triggerType:   text("trigger_type").notNull(),
    triggerId:     text("trigger_id").notNull(),
    triggerRef:    jsonb("trigger_ref").$type<Record<string, unknown>>().notNull().default({}),
    // LLM reasoning output
    reasoning:     text("reasoning").notNull().default(""),
    actionType:    text("action_type").notNull(),
    actionPayload: jsonb("action_payload").$type<Record<string, unknown>>().notNull().default({}),
    confidence:    real("confidence").notNull().default(0),
    priority:      integer("priority").notNull().default(3),
    // lifecycle — M1 always 'proposed'; M2 updates to executing/done/skipped
    status:        text("status").notNull().default("proposed"),
    // M4 outcome (nullable, filled post-hoc by performance tracking cron)
    outcome:       jsonb("outcome").$type<Record<string, unknown>>(),
    // cost tracking
    modelKey:      text("model_key"),
    costUsd:       numeric("cost_usd", { precision: 10, scale: 8 }).notNull().default("0"),
    createdAt:     timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    statusCreatedIdx:     index("iuf_decisions_status_created_idx").on(table.status, table.createdAt.desc()),
    actionTypeCreatedIdx: index("iuf_decisions_action_type_created_idx").on(table.actionType, table.createdAt.desc()),
    createdAtIdx:         index("iuf_decisions_created_at_idx").on(table.createdAt.desc()),
    triggerUidx:          uniqueIndex("iuf_decisions_trigger_uidx").on(table.triggerType, table.triggerId),
  })
);

// -- quote_last_close -- migration 0048_quote_last_close.sql
// Last-good EOD closing price per symbol per trading day — persisted for
// mark-to-market fallback after restart or 盤後 data-supplier gaps.
// Write path: buildS1PositionsSnapshot (TWSE+TPEX+MIS official/post-session close)
//             and server.ts TWSE-EOD-QUOTE-CRON (full ~1400 TWSE universe).
// Read path:  getLastCloses() in quote-last-close-store.ts, called as last fallback
//             after TWSE/TPEX/MIS live fetches all miss.
// PRIMARY KEY (symbol, trade_date): one authoritative row per symbol per day.
// source CHECK: 'twse_eod' | 'tpex_eod' | 'mis_close' (DB-side enforcement).
export const quoteLastClose = pgTable(
  "quote_last_close",
  {
    symbol:     text("symbol").notNull(),
    closePrice: numeric("close_price", { precision: 12, scale: 2 }).notNull(),
    tradeDate:  date("trade_date").notNull(),
    source:     text("source").notNull(),
    updatedAt:  timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    symbolTradeDatePk: primaryKey({ columns: [table.symbol, table.tradeDate] }),
    tradeDateIdx:      index("quote_last_close_trade_date_idx").on(table.tradeDate),
    symbolDateIdx:     index("quote_last_close_symbol_date_idx").on(table.symbol, table.tradeDate),
  })
);
