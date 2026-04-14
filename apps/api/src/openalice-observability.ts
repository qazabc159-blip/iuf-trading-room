import { createClient } from "redis";
import { z } from "zod";

import {
  getOpenAliceBridgeSnapshot,
  type OpenAliceBridgeSnapshot
} from "./openalice-bridge.js";

const openAliceMaintenanceMetricsSchema = z.object({
  mode: z.enum(["memory", "database"]),
  sweepAt: z.string().datetime(),
  expiredJobsRequeued: z.number().int().nonnegative(),
  expiredJobsFailed: z.number().int().nonnegative(),
  staleRunningJobs: z.number().int().nonnegative(),
  queuedJobs: z.number().int().nonnegative(),
  runningJobs: z.number().int().nonnegative(),
  terminalJobs: z.number().int().nonnegative(),
  activeDevices: z.number().int().nonnegative(),
  staleDevices: z.number().int().nonnegative()
});

type OpenAliceMaintenanceMetrics = z.infer<typeof openAliceMaintenanceMetricsSchema>;

export type OpenAliceObservabilitySnapshot = {
  source: "redis" | "bridge_fallback";
  workerStatus: "healthy" | "stale" | "missing";
  sweepStatus: "healthy" | "stale" | "missing";
  workerHeartbeatAt: string | null;
  workerHeartbeatAgeSeconds: number | null;
  lastSweepAt: string | null;
  lastSweepAgeSeconds: number | null;
  metrics: OpenAliceBridgeSnapshot & {
    expiredJobsRequeued: number;
    expiredJobsFailed: number;
  };
};

let redisClient: ReturnType<typeof createClient> | null = null;
let redisConnectPromise: Promise<ReturnType<typeof createClient> | null> | null = null;

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

function getAgeSeconds(value: string | null, now: Date) {
  if (!value) {
    return null;
  }

  const at = new Date(value);
  if (Number.isNaN(at.getTime())) {
    return null;
  }

  return Math.max(0, Math.floor((now.getTime() - at.getTime()) / 1000));
}

function resolveFreshnessStatus(
  ageSeconds: number | null,
  thresholdSeconds: number
): "healthy" | "stale" | "missing" {
  if (ageSeconds === null) {
    return "missing";
  }

  return ageSeconds <= thresholdSeconds ? "healthy" : "stale";
}

async function getRedisClient() {
  const redisUrl = process.env.REDIS_URL ?? null;
  if (!redisUrl) {
    return null;
  }

  if (redisClient?.isReady) {
    return redisClient;
  }

  if (redisConnectPromise) {
    return redisConnectPromise;
  }

  redisConnectPromise = (async () => {
    const client = createClient({ url: redisUrl });
    client.on("error", (error) => {
      console.error("[api] Redis observability client error", error);
    });

    await client.connect();
    redisClient = client;
    redisConnectPromise = null;
    return client;
  })().catch((error) => {
    console.error("[api] Failed to connect Redis observability client", error);
    redisConnectPromise = null;
    return null;
  });

  return redisConnectPromise;
}

async function readRedisObservabilitySnapshot() {
  const client = await getRedisClient();
  if (!client) {
    return null;
  }

  const [workerHeartbeatAt, lastSweepAt, metricsRaw] = await Promise.all([
    client.get("iuf:worker:last_heartbeat"),
    client.get("iuf:openalice:last_sweep"),
    client.get("iuf:openalice:metrics")
  ]);

  if (!workerHeartbeatAt && !lastSweepAt && !metricsRaw) {
    return null;
  }

  let metrics: OpenAliceMaintenanceMetrics | null = null;
  if (metricsRaw) {
    try {
      const parsed = JSON.parse(metricsRaw);
      const result = openAliceMaintenanceMetricsSchema.safeParse(parsed);
      if (result.success) {
        metrics = result.data;
      }
    } catch {
      metrics = null;
    }
  }

  return {
    workerHeartbeatAt,
    lastSweepAt: metrics?.sweepAt ?? lastSweepAt,
    metrics
  };
}

export async function getOpenAliceObservabilitySnapshot(
  workspaceSlug: string
): Promise<OpenAliceObservabilitySnapshot> {
  const now = new Date();
  const heartbeatThresholdSeconds = getPositiveIntegerFromEnv(
    "WORKER_HEARTBEAT_SECONDS",
    60,
    5,
    3_600
  ) * 3;
  const sweepThresholdSeconds = getPositiveIntegerFromEnv(
    "OPENALICE_SWEEP_INTERVAL_SECONDS",
    60,
    15,
    3_600
  ) * 3;

  const fallback = await getOpenAliceBridgeSnapshot(workspaceSlug);
  const redisSnapshot = await readRedisObservabilitySnapshot();

  const workerHeartbeatAt = redisSnapshot?.workerHeartbeatAt ?? null;
  const lastSweepAt = redisSnapshot?.lastSweepAt ?? null;
  const workerHeartbeatAgeSeconds = getAgeSeconds(workerHeartbeatAt, now);
  const lastSweepAgeSeconds = getAgeSeconds(lastSweepAt, now);

  if (!redisSnapshot?.metrics) {
    return {
      source: "bridge_fallback",
      workerStatus: resolveFreshnessStatus(workerHeartbeatAgeSeconds, heartbeatThresholdSeconds),
      sweepStatus: resolveFreshnessStatus(lastSweepAgeSeconds, sweepThresholdSeconds),
      workerHeartbeatAt,
      workerHeartbeatAgeSeconds,
      lastSweepAt,
      lastSweepAgeSeconds,
      metrics: {
        ...fallback,
        expiredJobsRequeued: 0,
        expiredJobsFailed: 0
      }
    };
  }

  return {
    source: "redis",
    workerStatus: resolveFreshnessStatus(workerHeartbeatAgeSeconds, heartbeatThresholdSeconds),
    sweepStatus: resolveFreshnessStatus(lastSweepAgeSeconds, sweepThresholdSeconds),
    workerHeartbeatAt,
    workerHeartbeatAgeSeconds,
    lastSweepAt,
    lastSweepAgeSeconds,
    metrics: {
      mode: redisSnapshot.metrics.mode,
      queuedJobs: redisSnapshot.metrics.queuedJobs,
      runningJobs: redisSnapshot.metrics.runningJobs,
      staleRunningJobs: redisSnapshot.metrics.staleRunningJobs,
      terminalJobs: redisSnapshot.metrics.terminalJobs,
      activeDevices: redisSnapshot.metrics.activeDevices,
      staleDevices: redisSnapshot.metrics.staleDevices,
      expiredJobsRequeued: redisSnapshot.metrics.expiredJobsRequeued,
      expiredJobsFailed: redisSnapshot.metrics.expiredJobsFailed
    }
  };
}
