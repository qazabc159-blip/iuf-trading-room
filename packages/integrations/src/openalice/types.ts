export type OpenAliceBridgeTaskType =
  | "daily_brief"
  | "theme_summary"
  | "company_note"
  | "signal_cluster"
  | "trade_plan_draft"
  | "review_summary";

export type OpenAliceBridgeContextRef = {
  type: string;
  id?: string;
  path?: string;
  url?: string;
};

export type OpenAliceBridgeArtifact = {
  label: string;
  path?: string;
  mimeType?: string;
};

export type OpenAliceBridgeJob = {
  jobId: string;
  workspaceSlug: string;
  taskType: OpenAliceBridgeTaskType;
  schemaName: string;
  instructions: string;
  contextRefs: OpenAliceBridgeContextRef[];
  createdAt: string;
  timeoutSeconds?: number;
  attemptCount?: number;
  maxAttempts?: number;
  leaseExpiresAt?: string;
};

export type OpenAliceBridgeResult = {
  jobId: string;
  status: "draft_ready" | "validation_failed" | "failed";
  schemaName: string;
  structured?: unknown;
  rawText?: string;
  warnings?: string[];
  artifacts?: OpenAliceBridgeArtifact[];
};

export type DeviceRegistration = {
  deviceId: string;
  workspaceSlug: string;
  deviceToken: string;
  registeredAt: string;
};

export type BridgeJobRecord = {
  id: string;
  workspaceSlug: string;
  deviceId?: string;
  status:
    | "queued"
    | "running"
    | "draft_ready"
    | "validation_failed"
    | "failed"
    | "published"
    | "rejected";
  taskType: OpenAliceBridgeTaskType;
  instructions: string;
  contextRefs: OpenAliceBridgeContextRef[];
  result?: OpenAliceBridgeResult;
  createdAt: string;
  claimedAt?: string;
  lastHeartbeatAt?: string;
  leaseExpiresAt?: string;
  completedAt?: string;
  attemptCount?: number;
  maxAttempts?: number;
  error?: string;
};
