import { and, asc, eq } from "drizzle-orm";
import {
  getDb,
  getPersistenceMode,
  isDatabaseMode,
  openAliceDevices,
  openAliceJobs
} from "@iuf-trading-room/db";

type OpenAliceLeaseSnapshot = {
  status: string;
  leaseExpiresAt: Date | null;
  attemptCount: number;
  maxAttempts: number;
};

type OpenAliceDeviceSnapshot = {
  status: string;
  lastSeenAt: Date;
};

export type OpenAliceMaintenanceMetrics = {
  mode: "memory" | "database";
  sweepAt: string;
  expiredJobsRequeued: number;
  expiredJobsFailed: number;
  staleRunningJobs: number;
  queuedJobs: number;
  runningJobs: number;
  terminalJobs: number;
  activeDevices: number;
  staleDevices: number;
};

export const defaultOpenAliceSweepIntervalSeconds = getPositiveIntegerFromEnv(
  "OPENALICE_SWEEP_INTERVAL_SECONDS",
  60,
  15,
  3_600
);

export const defaultOpenAliceDeviceStaleSeconds = getPositiveIntegerFromEnv(
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

export function resolveExpiredJobTransition(job: OpenAliceLeaseSnapshot, now = new Date()) {
  if (job.status !== "running" || !job.leaseExpiresAt || job.leaseExpiresAt.getTime() > now.getTime()) {
    return null;
  }

  if (job.attemptCount >= job.maxAttempts) {
    return {
      status: "failed" as const,
      error: `OpenAlice job lease expired after ${job.attemptCount} attempts.`
    };
  }

  return {
    status: "queued" as const,
    error: null
  };
}

export function collectOpenAliceMaintenanceMetrics(input: {
  jobs: OpenAliceLeaseSnapshot[];
  devices: OpenAliceDeviceSnapshot[];
  now?: Date;
  deviceStaleSeconds?: number;
  expiredJobsRequeued?: number;
  expiredJobsFailed?: number;
  mode?: "memory" | "database";
}): OpenAliceMaintenanceMetrics {
  const now = input.now ?? new Date();
  const deviceStaleSeconds = input.deviceStaleSeconds ?? defaultOpenAliceDeviceStaleSeconds;
  const staleCutoff = new Date(now.getTime() - deviceStaleSeconds * 1_000);

  const queuedJobs = input.jobs.filter((job) => job.status === "queued").length;
  const runningJobs = input.jobs.filter((job) => job.status === "running").length;
  const staleRunningJobs = input.jobs.filter(
    (job) => job.status === "running" && !!job.leaseExpiresAt && job.leaseExpiresAt.getTime() <= now.getTime()
  ).length;
  const terminalJobs = input.jobs.filter(
    (job) => job.status !== "queued" && job.status !== "running"
  ).length;
  const activeDevices = input.devices.filter((device) => device.status === "active").length;
  const staleDevices = input.devices.filter(
    (device) => device.status === "active" && device.lastSeenAt.getTime() <= staleCutoff.getTime()
  ).length;

  return {
    mode: input.mode ?? getPersistenceMode(),
    sweepAt: now.toISOString(),
    expiredJobsRequeued: input.expiredJobsRequeued ?? 0,
    expiredJobsFailed: input.expiredJobsFailed ?? 0,
    staleRunningJobs,
    queuedJobs,
    runningJobs,
    terminalJobs,
    activeDevices,
    staleDevices
  };
}

export async function runOpenAliceMaintenanceSweep(input?: {
  now?: Date;
  deviceStaleSeconds?: number;
}): Promise<OpenAliceMaintenanceMetrics> {
  const now = input?.now ?? new Date();

  if (!isDatabaseMode()) {
    return collectOpenAliceMaintenanceMetrics({
      jobs: [],
      devices: [],
      now,
      deviceStaleSeconds: input?.deviceStaleSeconds,
      mode: "memory"
    });
  }

  const db = getDb();
  if (!db) {
    return collectOpenAliceMaintenanceMetrics({
      jobs: [],
      devices: [],
      now,
      deviceStaleSeconds: input?.deviceStaleSeconds,
      mode: "database"
    });
  }

  let expiredJobsRequeued = 0;
  let expiredJobsFailed = 0;

  const runningJobs = await db
    .select({
      id: openAliceJobs.id,
      status: openAliceJobs.status,
      attemptCount: openAliceJobs.attemptCount,
      maxAttempts: openAliceJobs.maxAttempts,
      leaseExpiresAt: openAliceJobs.leaseExpiresAt
    })
    .from(openAliceJobs)
    .where(eq(openAliceJobs.status, "running"))
    .orderBy(asc(openAliceJobs.createdAt));

  for (const job of runningJobs) {
    const transition = resolveExpiredJobTransition(
      {
        status: job.status,
        leaseExpiresAt: job.leaseExpiresAt,
        attemptCount: job.attemptCount,
        maxAttempts: job.maxAttempts
      },
      now
    );

    if (!transition) {
      continue;
    }

    if (transition.status === "failed") {
      expiredJobsFailed += 1;
      await db
        .update(openAliceJobs)
        .set({
          status: "failed",
          claimedByDeviceId: null,
          lastHeartbeatAt: now,
          leaseExpiresAt: null,
          completedAt: now,
          error: transition.error
        })
        .where(and(eq(openAliceJobs.id, job.id), eq(openAliceJobs.status, "running")));
      continue;
    }

    expiredJobsRequeued += 1;
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
      .where(and(eq(openAliceJobs.id, job.id), eq(openAliceJobs.status, "running")));
  }

  const [jobs, devices] = await Promise.all([
    db
      .select({
        status: openAliceJobs.status,
        leaseExpiresAt: openAliceJobs.leaseExpiresAt,
        attemptCount: openAliceJobs.attemptCount,
        maxAttempts: openAliceJobs.maxAttempts
      })
      .from(openAliceJobs),
    db
      .select({
        status: openAliceDevices.status,
        lastSeenAt: openAliceDevices.lastSeenAt
      })
      .from(openAliceDevices)
  ]);

  return collectOpenAliceMaintenanceMetrics({
    jobs,
    devices,
    now,
    deviceStaleSeconds: input?.deviceStaleSeconds,
    expiredJobsRequeued,
    expiredJobsFailed,
    mode: "database"
  });
}
