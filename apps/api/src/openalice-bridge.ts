import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

import { and, asc, eq } from "drizzle-orm";
import {
  getDb,
  isDatabaseMode,
  openAliceDevices,
  openAliceJobs,
  openAliceJobStatusEnum,
  workspaces
} from "@iuf-trading-room/db";
import type {
  DeviceRegistration,
  OpenAliceBridgeArtifact,
  OpenAliceBridgeContextRef,
  OpenAliceBridgeJob,
  OpenAliceBridgeResult,
  OpenAliceBridgeTaskType
} from "@iuf-trading-room/integrations";
import { z } from "zod";

const openAliceTaskTypes = [
  "daily_brief",
  "theme_summary",
  "company_note",
  "signal_cluster",
  "trade_plan_draft",
  "review_summary"
] as const;

export const openAliceTaskTypeSchema = z.enum(openAliceTaskTypes);

export const openAliceContextRefSchema = z.object({
  type: z.string().min(1),
  id: z.string().min(1).optional(),
  path: z.string().min(1).optional(),
  url: z.string().url().optional()
});

export const openAliceArtifactSchema: z.ZodType<OpenAliceBridgeArtifact> = z.object({
  label: z.string().min(1),
  path: z.string().min(1).optional(),
  mimeType: z.string().min(1).optional()
});

export const openAliceRegisterSchema = z.object({
  deviceId: z.string().min(1),
  deviceName: z.string().min(1),
  capabilities: z.array(z.string().min(1)).default([])
});

export const openAliceEnqueueJobSchema = z.object({
  taskType: openAliceTaskTypeSchema,
  schemaName: z.string().min(1).max(120),
  instructions: z.string().min(1).max(10_000),
  contextRefs: z.array(openAliceContextRefSchema).default([]),
  parameters: z.record(z.string(), z.unknown()).default({}),
  timeoutSeconds: z.number().int().positive().max(86_400).optional()
});

export const openAliceClaimJobSchema = z.object({
  deviceId: z.string().min(1)
});

export const openAliceJobResultSchema: z.ZodType<OpenAliceBridgeResult> = z.object({
  jobId: z.string().uuid(),
  status: z.enum(["draft_ready", "validation_failed", "failed"]),
  schemaName: z.string().min(1),
  structured: z.unknown().optional(),
  rawText: z.string().optional(),
  warnings: z.array(z.string()).default([]),
  artifacts: z.array(openAliceArtifactSchema).default([])
});

export type OpenAliceAuthenticatedDevice = {
  internalId?: string;
  deviceId: string;
  deviceName: string;
  workspaceId?: string;
  workspaceSlug: string;
  capabilities: string[];
};

export type OpenAliceBridgeSnapshot = {
  mode: "memory" | "database";
  queuedJobs: number;
  runningJobs: number;
  staleRunningJobs: number;
  terminalJobs: number;
  activeDevices: number;
  staleDevices: number;
};

type MemoryDevice = DeviceRegistration & {
  deviceName: string;
  capabilities: string[];
  status: "active" | "revoked";
  tokenHash: string;
  lastSeenAt: string;
};

type MemoryJob = OpenAliceBridgeJob & {
  status:
    | "queued"
    | "running"
    | "draft_ready"
    | "validation_failed"
    | "failed"
    | "published"
    | "rejected";
  deviceId?: string;
  parameters: Record<string, unknown>;
  result?: OpenAliceBridgeResult;
  claimedAt?: string;
  lastHeartbeatAt?: string;
  leaseExpiresAt?: string;
  completedAt?: string;
  attemptCount: number;
  maxAttempts: number;
  error?: string;
};

const memoryDevices = new Map<string, MemoryDevice>();
const memoryJobs = new Map<string, MemoryJob>();

const openAliceJobStatuses = openAliceJobStatusEnum.enumValues;
const defaultOpenAliceTimeoutSeconds = getPositiveIntegerFromEnv(
  "OPENALICE_DEFAULT_TIMEOUT_SECONDS",
  900,
  60,
  86_400
);
const defaultOpenAliceMaxAttempts = getPositiveIntegerFromEnv(
  "OPENALICE_MAX_ATTEMPTS",
  3,
  1,
  10
);
const defaultOpenAliceDeviceStaleSeconds = getPositiveIntegerFromEnv(
  "OPENALICE_DEVICE_STALE_SECONDS",
  21_600,
  300,
  604_800
);

function getPositiveIntegerFromEnv(
  key: string,
  fallback: number,
  min: number,
  max: number
) {
  const raw = Number(process.env[key]);
  if (!Number.isInteger(raw) || raw < min || raw > max) {
    return fallback;
  }

  return raw;
}

function issueDeviceToken() {
  return randomBytes(24).toString("base64url");
}

function hashDeviceToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function tokenMatches(token: string, tokenHash: string) {
  const input = Buffer.from(hashDeviceToken(token), "utf8");
  const stored = Buffer.from(tokenHash, "utf8");
  return input.length === stored.length && timingSafeEqual(input, stored);
}

function normalizeContextRefs(value: unknown): OpenAliceBridgeContextRef[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => openAliceContextRefSchema.safeParse(item))
    .filter((result) => result.success)
    .map((result) => result.data);
}

function normalizeArtifacts(value: unknown): OpenAliceBridgeArtifact[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => openAliceArtifactSchema.safeParse(item))
    .filter((result) => result.success)
    .map((result) => result.data);
}

function normalizeResult(value: unknown): OpenAliceBridgeResult | undefined {
  const parsed = openAliceJobResultSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function resolveTimeoutSeconds(timeoutSeconds?: number) {
  return timeoutSeconds ?? defaultOpenAliceTimeoutSeconds;
}

function resolveMaxAttempts() {
  return defaultOpenAliceMaxAttempts;
}

function calculateLeaseExpiry(timeoutSeconds?: number, from = new Date()) {
  return new Date(from.getTime() + resolveTimeoutSeconds(timeoutSeconds) * 1000);
}

function leaseIsExpired(leaseExpiresAt?: string | Date | null, now = new Date()) {
  if (!leaseExpiresAt) {
    return false;
  }

  const value = leaseExpiresAt instanceof Date ? leaseExpiresAt : new Date(leaseExpiresAt);
  return value.getTime() <= now.getTime();
}

function collectOpenAliceBridgeSnapshot(input: {
  mode: "memory" | "database";
  jobs: Array<{
    status: string;
    leaseExpiresAt?: string | Date | null;
  }>;
  devices: Array<{
    status: string;
    lastSeenAt?: string | Date | null;
  }>;
  now?: Date;
  deviceStaleSeconds?: number;
}): OpenAliceBridgeSnapshot {
  const now = input.now ?? new Date();
  const deviceStaleSeconds = input.deviceStaleSeconds ?? defaultOpenAliceDeviceStaleSeconds;
  const staleCutoff = new Date(now.getTime() - deviceStaleSeconds * 1000);

  const queuedJobs = input.jobs.filter((job) => job.status === "queued").length;
  const runningJobs = input.jobs.filter((job) => job.status === "running").length;
  const staleRunningJobs = input.jobs.filter(
    (job) => job.status === "running" && leaseIsExpired(job.leaseExpiresAt, now)
  ).length;
  const terminalJobs = input.jobs.filter(
    (job) => job.status !== "queued" && job.status !== "running"
  ).length;
  const activeDevices = input.devices.filter((device) => device.status === "active").length;
  const staleDevices = input.devices.filter((device) => {
    if (device.status !== "active" || !device.lastSeenAt) {
      return false;
    }

    const value =
      device.lastSeenAt instanceof Date ? device.lastSeenAt : new Date(device.lastSeenAt);
    return value.getTime() <= staleCutoff.getTime();
  }).length;

  return {
    mode: input.mode,
    queuedJobs,
    runningJobs,
    staleRunningJobs,
    terminalJobs,
    activeDevices,
    staleDevices
  };
}

function toBridgeJobPayload(job: MemoryJob): OpenAliceBridgeJob & { parameters: Record<string, unknown> } {
  return {
    jobId: job.jobId,
    workspaceSlug: job.workspaceSlug,
    taskType: job.taskType,
    schemaName: job.schemaName,
    instructions: job.instructions,
    contextRefs: [...job.contextRefs],
    createdAt: job.createdAt,
    timeoutSeconds: job.timeoutSeconds,
    attemptCount: job.attemptCount,
    maxAttempts: job.maxAttempts,
    leaseExpiresAt: job.leaseExpiresAt,
    parameters: { ...job.parameters }
  };
}

function markMemoryJobExpired(job: MemoryJob, now: Date) {
  const nowIso = now.toISOString();

  if (job.attemptCount >= job.maxAttempts) {
    job.status = "failed";
    job.error = `OpenAlice job lease expired after ${job.attemptCount} attempts.`;
    job.deviceId = undefined;
    job.claimedAt = undefined;
    job.lastHeartbeatAt = nowIso;
    job.leaseExpiresAt = undefined;
    job.completedAt = nowIso;
    return;
  }

  job.status = "queued";
  job.error = undefined;
  job.deviceId = undefined;
  job.claimedAt = undefined;
  job.lastHeartbeatAt = undefined;
  job.leaseExpiresAt = undefined;
}

async function loadWorkspaceBySlug(workspaceSlug: string) {
  const db = getDb();
  if (!db) {
    return null;
  }

  const [workspace] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.slug, workspaceSlug))
    .limit(1);

  return workspace ?? null;
}

async function requeueExpiredOpenAliceJobs(input: {
  workspaceSlug: string;
  workspaceId?: string;
}) {
  const now = new Date();

  if (!isDatabaseMode()) {
    for (const job of memoryJobs.values()) {
      if (job.workspaceSlug !== input.workspaceSlug || job.status !== "running") {
        continue;
      }

      if (!leaseIsExpired(job.leaseExpiresAt, now)) {
        continue;
      }

      markMemoryJobExpired(job, now);
    }
    return;
  }

  const db = getDb();
  if (!db || !input.workspaceId) {
    return;
  }

  const rows = await db
    .select()
    .from(openAliceJobs)
    .where(and(eq(openAliceJobs.workspaceId, input.workspaceId), eq(openAliceJobs.status, "running")))
    .orderBy(asc(openAliceJobs.createdAt));

  for (const row of rows) {
    if (!leaseIsExpired(row.leaseExpiresAt, now)) {
      continue;
    }

    if (row.attemptCount >= row.maxAttempts) {
      await db
        .update(openAliceJobs)
        .set({
          status: "failed",
          claimedByDeviceId: null,
          lastHeartbeatAt: now,
          leaseExpiresAt: null,
          completedAt: now,
          error: `OpenAlice job lease expired after ${row.attemptCount} attempts.`
        })
        .where(eq(openAliceJobs.id, row.id));
      continue;
    }

    await db
      .update(openAliceJobs)
      .set({
        status: "queued",
        claimedByDeviceId: null,
        claimedAt: null,
        lastHeartbeatAt: null,
        leaseExpiresAt: null,
        error: null
      })
      .where(eq(openAliceJobs.id, row.id));
  }
}

export async function registerOpenAliceDevice(input: {
  workspaceSlug: string;
  deviceId: string;
  deviceName: string;
  capabilities: string[];
}): Promise<DeviceRegistration & { deviceName: string; capabilities: string[]; status: "active" }> {
  const now = new Date().toISOString();
  const deviceToken = issueDeviceToken();
  const tokenHash = hashDeviceToken(deviceToken);

  if (!isDatabaseMode()) {
    const record: MemoryDevice = {
      deviceId: input.deviceId,
      deviceName: input.deviceName,
      capabilities: [...input.capabilities],
      workspaceSlug: input.workspaceSlug,
      deviceToken,
      tokenHash,
      registeredAt: now,
      lastSeenAt: now,
      status: "active"
    };
    memoryDevices.set(input.deviceId, record);
    return {
      deviceId: record.deviceId,
      deviceName: record.deviceName,
      capabilities: [...record.capabilities],
      workspaceSlug: record.workspaceSlug,
      deviceToken: record.deviceToken,
      registeredAt: record.registeredAt,
      status: "active"
    };
  }

  const db = getDb();
  const workspace = await loadWorkspaceBySlug(input.workspaceSlug);
  if (!db || !workspace) {
    throw new Error("Workspace must exist before registering an OpenAlice device.");
  }

  const [existing] = await db
    .select()
    .from(openAliceDevices)
    .where(eq(openAliceDevices.externalDeviceId, input.deviceId))
    .limit(1);

  if (existing) {
    await db
      .update(openAliceDevices)
      .set({
        workspaceId: workspace.id,
        deviceName: input.deviceName,
        capabilities: input.capabilities,
        tokenHash,
        status: "active",
        lastSeenAt: new Date(),
        updatedAt: new Date()
      })
      .where(eq(openAliceDevices.id, existing.id));
  } else {
    await db.insert(openAliceDevices).values({
      workspaceId: workspace.id,
      externalDeviceId: input.deviceId,
      deviceName: input.deviceName,
      capabilities: input.capabilities,
      tokenHash,
      status: "active",
      registeredAt: new Date(),
      lastSeenAt: new Date(),
      updatedAt: new Date()
    });
  }

  return {
    deviceId: input.deviceId,
    deviceName: input.deviceName,
    capabilities: [...input.capabilities],
    workspaceSlug: input.workspaceSlug,
    deviceToken,
    registeredAt: now,
    status: "active"
  };
}

export async function authenticateOpenAliceDevice(input: {
  deviceId: string;
  token: string;
}): Promise<OpenAliceAuthenticatedDevice | null> {
  if (!isDatabaseMode()) {
    const device = memoryDevices.get(input.deviceId);
    if (!device || device.status !== "active" || !tokenMatches(input.token, device.tokenHash)) {
      return null;
    }

    device.lastSeenAt = new Date().toISOString();
    return {
      deviceId: device.deviceId,
      deviceName: device.deviceName,
      workspaceSlug: device.workspaceSlug,
      capabilities: [...device.capabilities]
    };
  }

  const db = getDb();
  if (!db) {
    return null;
  }

  const [device] = await db
    .select({
      id: openAliceDevices.id,
      externalDeviceId: openAliceDevices.externalDeviceId,
      deviceName: openAliceDevices.deviceName,
      workspaceId: openAliceDevices.workspaceId,
      capabilities: openAliceDevices.capabilities,
      tokenHash: openAliceDevices.tokenHash,
      status: openAliceDevices.status,
      workspaceSlug: workspaces.slug
    })
    .from(openAliceDevices)
    .innerJoin(workspaces, eq(openAliceDevices.workspaceId, workspaces.id))
    .where(eq(openAliceDevices.externalDeviceId, input.deviceId))
    .limit(1);

  if (!device || device.status !== "active" || !tokenMatches(input.token, device.tokenHash)) {
    return null;
  }

  await db
    .update(openAliceDevices)
    .set({
      lastSeenAt: new Date(),
      updatedAt: new Date()
    })
    .where(eq(openAliceDevices.id, device.id));

  return {
    internalId: device.id,
    deviceId: device.externalDeviceId,
    deviceName: device.deviceName,
    workspaceId: device.workspaceId,
    workspaceSlug: device.workspaceSlug,
    capabilities: Array.isArray(device.capabilities)
      ? device.capabilities.filter((item): item is string => typeof item === "string")
      : []
  };
}

export async function enqueueOpenAliceJob(input: {
  workspaceSlug: string;
  taskType: OpenAliceBridgeTaskType;
  schemaName: string;
  instructions: string;
  contextRefs: OpenAliceBridgeContextRef[];
  parameters: Record<string, unknown>;
  timeoutSeconds?: number;
}): Promise<OpenAliceBridgeJob & { parameters: Record<string, unknown>; status: typeof openAliceJobStatuses[number] }> {
  const createdAt = new Date().toISOString();

  if (!isDatabaseMode()) {
    const job: MemoryJob = {
      jobId: randomUUID(),
      workspaceSlug: input.workspaceSlug,
      taskType: input.taskType,
      schemaName: input.schemaName,
      instructions: input.instructions,
      contextRefs: [...input.contextRefs],
      parameters: { ...input.parameters },
      status: "queued",
      createdAt,
      timeoutSeconds: resolveTimeoutSeconds(input.timeoutSeconds),
      attemptCount: 0,
      maxAttempts: resolveMaxAttempts()
    };
    memoryJobs.set(job.jobId, job);
    return { ...toBridgeJobPayload(job), status: job.status };
  }

  const db = getDb();
  const workspace = await loadWorkspaceBySlug(input.workspaceSlug);
  if (!db || !workspace) {
    throw new Error("Workspace must exist before queuing an OpenAlice job.");
  }

  const [row] = await db
    .insert(openAliceJobs)
    .values({
      workspaceId: workspace.id,
      status: "queued",
      taskType: input.taskType,
      schemaName: input.schemaName,
      instructions: input.instructions,
      contextRefs: input.contextRefs,
      parameters: input.parameters,
      timeoutSeconds: resolveTimeoutSeconds(input.timeoutSeconds),
      maxAttempts: resolveMaxAttempts()
    })
    .returning();

  return {
    jobId: row.id,
    workspaceSlug: input.workspaceSlug,
    taskType: row.taskType as OpenAliceBridgeTaskType,
    schemaName: row.schemaName,
    instructions: row.instructions,
    contextRefs: normalizeContextRefs(row.contextRefs),
    createdAt: row.createdAt.toISOString(),
    timeoutSeconds: row.timeoutSeconds ?? undefined,
    attemptCount: row.attemptCount,
    maxAttempts: row.maxAttempts,
    leaseExpiresAt: row.leaseExpiresAt?.toISOString(),
    parameters: typeof row.parameters === "object" && row.parameters ? row.parameters as Record<string, unknown> : {},
    status: row.status
  };
}

export async function claimOpenAliceJob(
  device: OpenAliceAuthenticatedDevice
): Promise<(OpenAliceBridgeJob & { parameters: Record<string, unknown> }) | null> {
  await requeueExpiredOpenAliceJobs({
    workspaceSlug: device.workspaceSlug,
    workspaceId: device.workspaceId
  });

  if (!isDatabaseMode()) {
    const nextJob = [...memoryJobs.values()]
      .filter((job) => job.workspaceSlug === device.workspaceSlug && job.status === "queued")
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))[0];

    if (!nextJob) {
      return null;
    }

    const claimedAt = new Date();
    nextJob.status = "running";
    nextJob.deviceId = device.deviceId;
    nextJob.claimedAt = claimedAt.toISOString();
    nextJob.lastHeartbeatAt = nextJob.claimedAt;
    nextJob.leaseExpiresAt = calculateLeaseExpiry(nextJob.timeoutSeconds, claimedAt).toISOString();
    nextJob.attemptCount += 1;
    nextJob.error = undefined;
    nextJob.completedAt = undefined;
    return toBridgeJobPayload(nextJob);
  }

  const db = getDb();
  if (!db || !device.workspaceId) {
    return null;
  }

  const [queuedJob] = await db
    .select()
    .from(openAliceJobs)
    .where(and(eq(openAliceJobs.workspaceId, device.workspaceId), eq(openAliceJobs.status, "queued")))
    .orderBy(asc(openAliceJobs.createdAt))
    .limit(1);

  if (!queuedJob) {
    return null;
  }

  const [claimedJob] = await db
    .update(openAliceJobs)
    .set({
      claimedByDeviceId: device.internalId,
      status: "running",
      claimedAt: new Date(),
      lastHeartbeatAt: new Date(),
      leaseExpiresAt: calculateLeaseExpiry(queuedJob.timeoutSeconds ?? undefined),
      attemptCount: queuedJob.attemptCount + 1,
      error: null,
      completedAt: null
    })
    .where(eq(openAliceJobs.id, queuedJob.id))
    .returning();

  return {
    jobId: claimedJob.id,
    workspaceSlug: device.workspaceSlug,
    taskType: claimedJob.taskType as OpenAliceBridgeTaskType,
    schemaName: claimedJob.schemaName,
    instructions: claimedJob.instructions,
    contextRefs: normalizeContextRefs(claimedJob.contextRefs),
    createdAt: claimedJob.createdAt.toISOString(),
    timeoutSeconds: claimedJob.timeoutSeconds ?? undefined,
    attemptCount: claimedJob.attemptCount,
    maxAttempts: claimedJob.maxAttempts,
    leaseExpiresAt: claimedJob.leaseExpiresAt?.toISOString(),
    parameters:
      typeof claimedJob.parameters === "object" && claimedJob.parameters
        ? claimedJob.parameters as Record<string, unknown>
        : {}
  };
}

export async function heartbeatOpenAliceDevice(device: OpenAliceAuthenticatedDevice, jobId?: string) {
  const now = new Date();
  const nowIso = now.toISOString();

  if (!isDatabaseMode()) {
    const current = memoryDevices.get(device.deviceId);
    if (current) {
      current.lastSeenAt = nowIso;
    }

    if (jobId) {
      await requeueExpiredOpenAliceJobs({
        workspaceSlug: device.workspaceSlug
      });

      const job = memoryJobs.get(jobId);
      if (job && job.status === "running" && job.deviceId === device.deviceId) {
        job.lastHeartbeatAt = nowIso;
        job.leaseExpiresAt = calculateLeaseExpiry(job.timeoutSeconds, now).toISOString();
      }
    }
    return { ok: true, heartbeatAt: nowIso, jobId };
  }

  const db = getDb();
  if (db && device.internalId) {
    await db
      .update(openAliceDevices)
      .set({
        lastSeenAt: now,
        updatedAt: now
      })
      .where(eq(openAliceDevices.id, device.internalId));

    if (jobId && device.workspaceId) {
      await requeueExpiredOpenAliceJobs({
        workspaceSlug: device.workspaceSlug,
        workspaceId: device.workspaceId
      });

      const [job] = await db
        .select({
          id: openAliceJobs.id,
          timeoutSeconds: openAliceJobs.timeoutSeconds
        })
        .from(openAliceJobs)
        .where(
          and(
            eq(openAliceJobs.id, jobId),
            eq(openAliceJobs.workspaceId, device.workspaceId),
            eq(openAliceJobs.claimedByDeviceId, device.internalId),
            eq(openAliceJobs.status, "running")
          )
        )
        .limit(1);

      if (!job) {
        return { ok: true, heartbeatAt: nowIso, jobId };
      }

      await db
        .update(openAliceJobs)
        .set({
          lastHeartbeatAt: now,
          leaseExpiresAt: calculateLeaseExpiry(job.timeoutSeconds ?? undefined, now)
        })
        .where(
          and(
            eq(openAliceJobs.id, job.id),
            eq(openAliceJobs.workspaceId, device.workspaceId),
            eq(openAliceJobs.claimedByDeviceId, device.internalId),
            eq(openAliceJobs.status, "running")
          )
        );
    }
  }

  return { ok: true, heartbeatAt: nowIso, jobId };
}

export async function submitOpenAliceResult(input: {
  device: OpenAliceAuthenticatedDevice;
  result: OpenAliceBridgeResult;
}): Promise<OpenAliceBridgeResult | null> {
  const submittedAt = new Date();
  const submittedAtIso = submittedAt.toISOString();

  await requeueExpiredOpenAliceJobs({
    workspaceSlug: input.device.workspaceSlug,
    workspaceId: input.device.workspaceId
  });

  if (!isDatabaseMode()) {
    const job = memoryJobs.get(input.result.jobId);
    if (
      !job ||
      job.workspaceSlug !== input.device.workspaceSlug ||
      job.status !== "running" ||
      job.deviceId !== input.device.deviceId
    ) {
      return null;
    }

    job.deviceId = input.device.deviceId;
    job.status = input.result.status;
    job.result = input.result;
    job.error = input.result.status === "failed" ? input.result.rawText ?? "OpenAlice job failed" : undefined;
    job.completedAt = submittedAtIso;
    job.lastHeartbeatAt = submittedAtIso;
    job.leaseExpiresAt = undefined;
    return { ...input.result, artifacts: [...(input.result.artifacts ?? [])] };
  }

  const db = getDb();
  if (!db || !input.device.workspaceId) {
    return null;
  }

  const [job] = await db
    .select()
    .from(openAliceJobs)
    .where(and(eq(openAliceJobs.id, input.result.jobId), eq(openAliceJobs.workspaceId, input.device.workspaceId)))
    .limit(1);

  if (!job) {
    return null;
  }

  if (job.status !== "running" || job.claimedByDeviceId !== input.device.internalId) {
    return null;
  }

  await db
    .update(openAliceJobs)
    .set({
      claimedByDeviceId: input.device.internalId,
      status: input.result.status,
      result: input.result,
      error: input.result.status === "failed" ? input.result.rawText ?? "OpenAlice job failed" : null,
      lastHeartbeatAt: submittedAt,
      leaseExpiresAt: null,
      completedAt: submittedAt
    })
    .where(eq(openAliceJobs.id, job.id));

  return {
    ...input.result,
    warnings: [...(input.result.warnings ?? [])],
    artifacts: [...(input.result.artifacts ?? [])]
  };
}

export async function listOpenAliceJobs(workspaceSlug: string) {
  await requeueExpiredOpenAliceJobs({ workspaceSlug });

  if (!isDatabaseMode()) {
    return [...memoryJobs.values()]
      .filter((job) => job.workspaceSlug === workspaceSlug)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .map((job) => ({
        id: job.jobId,
        workspaceSlug: job.workspaceSlug,
        deviceId: job.deviceId,
        status: job.status,
        taskType: job.taskType,
        instructions: job.instructions,
        contextRefs: [...job.contextRefs],
        result: job.result ? { ...job.result } : undefined,
        createdAt: job.createdAt,
        claimedAt: job.claimedAt,
        lastHeartbeatAt: job.lastHeartbeatAt,
        leaseExpiresAt: job.leaseExpiresAt,
        completedAt: job.completedAt,
        attemptCount: job.attemptCount,
        maxAttempts: job.maxAttempts,
        error: job.error
      }));
  }

  const db = getDb();
  const workspace = await loadWorkspaceBySlug(workspaceSlug);
  if (!db || !workspace) {
    return [];
  }

  await requeueExpiredOpenAliceJobs({
    workspaceSlug,
    workspaceId: workspace.id
  });

  const rows = await db
    .select()
    .from(openAliceJobs)
    .where(eq(openAliceJobs.workspaceId, workspace.id))
    .orderBy(asc(openAliceJobs.createdAt));

  return rows.map((row) => ({
    id: row.id,
    workspaceSlug,
    deviceId: row.claimedByDeviceId ?? undefined,
    status: row.status,
    taskType: row.taskType as OpenAliceBridgeTaskType,
    instructions: row.instructions,
    contextRefs: normalizeContextRefs(row.contextRefs),
    result: normalizeResult(row.result),
    createdAt: row.createdAt.toISOString(),
    claimedAt: row.claimedAt?.toISOString(),
    lastHeartbeatAt: row.lastHeartbeatAt?.toISOString(),
    leaseExpiresAt: row.leaseExpiresAt?.toISOString(),
    completedAt: row.completedAt?.toISOString(),
    attemptCount: row.attemptCount,
    maxAttempts: row.maxAttempts,
    error: row.error ?? undefined
  }));
}

export async function getOpenAliceBridgeSnapshot(
  workspaceSlug: string
): Promise<OpenAliceBridgeSnapshot> {
  const now = new Date();

  if (!isDatabaseMode()) {
    const jobs = [...memoryJobs.values()].filter((job) => job.workspaceSlug === workspaceSlug);
    const devices = [...memoryDevices.values()].filter(
      (device) => device.workspaceSlug === workspaceSlug
    );

    return collectOpenAliceBridgeSnapshot({
      mode: "memory",
      jobs,
      devices,
      now
    });
  }

  const db = getDb();
  const workspace = await loadWorkspaceBySlug(workspaceSlug);
  if (!db || !workspace) {
    return collectOpenAliceBridgeSnapshot({
      mode: "database",
      jobs: [],
      devices: [],
      now
    });
  }

  await requeueExpiredOpenAliceJobs({
    workspaceSlug,
    workspaceId: workspace.id
  });

  const [jobs, devices] = await Promise.all([
    db
      .select({
        status: openAliceJobs.status,
        leaseExpiresAt: openAliceJobs.leaseExpiresAt
      })
      .from(openAliceJobs)
      .where(eq(openAliceJobs.workspaceId, workspace.id)),
    db
      .select({
        status: openAliceDevices.status,
        lastSeenAt: openAliceDevices.lastSeenAt
      })
      .from(openAliceDevices)
      .where(eq(openAliceDevices.workspaceId, workspace.id))
  ]);

  return collectOpenAliceBridgeSnapshot({
    mode: "database",
    jobs,
    devices,
    now
  });
}
