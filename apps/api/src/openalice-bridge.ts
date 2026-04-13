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
  completedAt?: string;
};

const memoryDevices = new Map<string, MemoryDevice>();
const memoryJobs = new Map<string, MemoryJob>();

const openAliceJobStatuses = openAliceJobStatusEnum.enumValues;

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
    parameters: { ...job.parameters }
  };
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
      timeoutSeconds: input.timeoutSeconds
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
      timeoutSeconds: input.timeoutSeconds
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
    parameters: typeof row.parameters === "object" && row.parameters ? row.parameters as Record<string, unknown> : {},
    status: row.status
  };
}

export async function claimOpenAliceJob(
  device: OpenAliceAuthenticatedDevice
): Promise<(OpenAliceBridgeJob & { parameters: Record<string, unknown> }) | null> {
  if (!isDatabaseMode()) {
    const nextJob = [...memoryJobs.values()]
      .filter((job) => job.workspaceSlug === device.workspaceSlug && job.status === "queued")
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))[0];

    if (!nextJob) {
      return null;
    }

    nextJob.status = "running";
    nextJob.deviceId = device.deviceId;
    nextJob.claimedAt = new Date().toISOString();
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
      claimedAt: new Date()
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
    parameters:
      typeof claimedJob.parameters === "object" && claimedJob.parameters
        ? claimedJob.parameters as Record<string, unknown>
        : {}
  };
}

export async function heartbeatOpenAliceDevice(device: OpenAliceAuthenticatedDevice, jobId?: string) {
  const now = new Date().toISOString();

  if (!isDatabaseMode()) {
    const current = memoryDevices.get(device.deviceId);
    if (current) {
      current.lastSeenAt = now;
    }
    return { ok: true, heartbeatAt: now, jobId };
  }

  const db = getDb();
  if (db && device.internalId) {
    await db
      .update(openAliceDevices)
      .set({
        lastSeenAt: new Date(),
        updatedAt: new Date()
      })
      .where(eq(openAliceDevices.id, device.internalId));
  }

  return { ok: true, heartbeatAt: now, jobId };
}

export async function submitOpenAliceResult(input: {
  device: OpenAliceAuthenticatedDevice;
  result: OpenAliceBridgeResult;
}): Promise<OpenAliceBridgeResult | null> {
  const submittedAt = new Date().toISOString();

  if (!isDatabaseMode()) {
    const job = memoryJobs.get(input.result.jobId);
    if (!job || job.workspaceSlug !== input.device.workspaceSlug) {
      return null;
    }

    job.deviceId = input.device.deviceId;
    job.status = input.result.status;
    job.result = input.result;
    job.completedAt = submittedAt;
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

  await db
    .update(openAliceJobs)
    .set({
      claimedByDeviceId: input.device.internalId,
      status: input.result.status,
      result: input.result,
      error: input.result.status === "failed" ? input.result.rawText ?? "OpenAlice job failed" : null,
      completedAt: new Date()
    })
    .where(eq(openAliceJobs.id, job.id));

  return {
    ...input.result,
    warnings: [...(input.result.warnings ?? [])],
    artifacts: [...(input.result.artifacts ?? [])]
  };
}

export async function listOpenAliceJobs(workspaceSlug: string) {
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
        completedAt: job.completedAt
      }));
  }

  const db = getDb();
  const workspace = await loadWorkspaceBySlug(workspaceSlug);
  if (!db || !workspace) {
    return [];
  }

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
    completedAt: row.completedAt?.toISOString()
  }));
}
