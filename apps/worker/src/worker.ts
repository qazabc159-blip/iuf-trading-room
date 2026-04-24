import process from "node:process";
import { setInterval } from "node:timers";

import { closeDb, isDatabaseMode } from "@iuf-trading-room/db";
import { createClient } from "redis";

import {
  defaultOpenAliceDeviceStaleSeconds,
  defaultOpenAliceSweepIntervalSeconds,
  runOpenAliceMaintenanceSweep
} from "./openalice-maintenance.js";
import { runThemeSummaryProducer } from "./jobs/theme-summary-producer.js";
import { runCompanyNoteProducer } from "./jobs/company-note-producer.js";
import { runDailyBriefProducer } from "./jobs/daily-brief-producer.js";

const jobs = [
  "ingest.my_tw_coverage",
  "brief.generate_daily",
  "signal.enrich",
  "review.refresh_metrics",
  "openalice.run_task"
];

// producer schedule intervals (ms)
const THEME_SUMMARY_INTERVAL_MS = Number(process.env.THEME_SUMMARY_INTERVAL_MS ?? 15 * 60 * 1000); // 15 min
const COMPANY_NOTE_INTERVAL_MS = Number(process.env.COMPANY_NOTE_INTERVAL_MS ?? 10 * 60 * 1000); // 10 min
const DAILY_BRIEF_INTERVAL_MS = Number(process.env.DAILY_BRIEF_INTERVAL_MS ?? 60 * 60 * 1000); // 1 hour

let producerTimers: NodeJS.Timeout[] = [];

async function runProducer(name: string, fn: () => Promise<unknown>) {
  try {
    const result = await fn();
    console.log(`[worker] producer ${name} ok`, JSON.stringify(result));
  } catch (err) {
    console.error(`[worker] producer ${name} error`, err instanceof Error ? err.message : String(err));
  }
}

function startProducers() {
  if (!isDatabaseMode()) {
    console.log("[worker] Skipping content producers — not in database mode.");
    return;
  }

  console.log("[worker] Starting content producers (theme-summary, company-note, daily-brief).");

  // run immediately on startup then on interval
  void runProducer("theme-summary", runThemeSummaryProducer);
  void runProducer("company-note", runCompanyNoteProducer);
  void runProducer("daily-brief", runDailyBriefProducer);

  producerTimers.push(
    setInterval(() => void runProducer("theme-summary", runThemeSummaryProducer), THEME_SUMMARY_INTERVAL_MS),
    setInterval(() => void runProducer("company-note", runCompanyNoteProducer), COMPANY_NOTE_INTERVAL_MS),
    setInterval(() => void runProducer("daily-brief", runDailyBriefProducer), DAILY_BRIEF_INTERVAL_MS)
  );
}

const heartbeatSeconds = Number(process.env.WORKER_HEARTBEAT_SECONDS ?? 60);
const persistenceMode = process.env.PERSISTENCE_MODE ?? "memory";
const redisUrl = process.env.REDIS_URL ?? null;
const openAliceSweepIntervalSeconds = defaultOpenAliceSweepIntervalSeconds;
const openAliceDeviceStaleSeconds = defaultOpenAliceDeviceStaleSeconds;

type RedisConnection = ReturnType<typeof createClient>;

let redisClient: RedisConnection | null = null;
let heartbeatTimer: NodeJS.Timeout | null = null;
let maintenanceTimer: NodeJS.Timeout | null = null;
let maintenanceInFlight = false;

async function connectRedis() {
  if (!redisUrl) {
    console.log("[worker] REDIS_URL not set, starting without Redis.");
    return null;
  }

  const client = createClient({ url: redisUrl });
  client.on("error", (error) => {
    console.error("[worker] Redis error", error);
  });

  await client.connect();
  const pong = await client.ping();
  console.log(`[worker] Redis connected (${pong}).`);
  return client;
}

async function shutdown(signal: string) {
  console.log(`[worker] Received ${signal}, shutting down.`);

  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }

  if (maintenanceTimer) {
    clearInterval(maintenanceTimer);
    maintenanceTimer = null;
  }

  for (const t of producerTimers) {
    clearInterval(t);
  }
  producerTimers = [];

  if (redisClient) {
    await redisClient.quit().catch((error) => {
      console.error("[worker] Redis shutdown error", error);
    });
    redisClient = null;
  }

  await closeDb().catch((error) => {
    console.error("[worker] Database shutdown error", error);
  });

  process.exit(0);
}

async function runOpenAliceMaintenanceCycle(trigger: "startup" | "interval") {
  if (maintenanceInFlight) {
    console.log(`[worker] Skipping OpenAlice maintenance (${trigger}); previous run still active.`);
    return;
  }

  maintenanceInFlight = true;

  try {
    const metrics = await runOpenAliceMaintenanceSweep({
      deviceStaleSeconds: openAliceDeviceStaleSeconds
    });

    if (redisClient?.isReady) {
      const ttl = Math.max(openAliceSweepIntervalSeconds * 3, 60);
      await Promise.all([
        redisClient.set("iuf:openalice:last_sweep", metrics.sweepAt, {
          expiration: { type: "EX", value: ttl }
        }),
        redisClient.set("iuf:openalice:metrics", JSON.stringify(metrics), {
          expiration: { type: "EX", value: ttl }
        })
      ]);
    }

    console.log(
      `[worker] OpenAlice maintenance (${trigger}) mode=${metrics.mode} queued=${metrics.queuedJobs} running=${metrics.runningJobs} terminal=${metrics.terminalJobs} requeued=${metrics.expiredJobsRequeued} failed=${metrics.expiredJobsFailed} staleRunning=${metrics.staleRunningJobs} staleDevices=${metrics.staleDevices}`
    );
  } catch (error) {
    console.error(`[worker] OpenAlice maintenance (${trigger}) failed`, error);
  } finally {
    maintenanceInFlight = false;
  }
}

async function main() {
  console.log("IUF Trading Room worker booted.");
  console.log(`[worker] Persistence mode: ${persistenceMode}`);
  console.log(
    `[worker] OpenAlice maintenance every ${openAliceSweepIntervalSeconds}s (device stale after ${openAliceDeviceStaleSeconds}s).`
  );
  console.log("[worker] Registered Wave 0 job placeholders:");
  for (const job of jobs) {
    console.log(`- ${job}`);
  }

  redisClient = await connectRedis();
  await runOpenAliceMaintenanceCycle("startup");
  startProducers();

  heartbeatTimer = setInterval(async () => {
    const at = new Date().toISOString();

    if (redisClient?.isReady) {
      try {
        await redisClient.set("iuf:worker:last_heartbeat", at, {
          expiration: { type: "EX", value: heartbeatSeconds * 3 }
        });
      } catch (error) {
        console.error("[worker] Failed to update Redis heartbeat", error);
      }
    }

    console.log(`[worker] heartbeat ${at}`);
  }, heartbeatSeconds * 1000);

  maintenanceTimer = setInterval(() => {
    void runOpenAliceMaintenanceCycle("interval");
  }, openAliceSweepIntervalSeconds * 1000);
}

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});

void main().catch(async (error) => {
  console.error("[worker] Fatal startup error", error);
  if (redisClient) {
    await redisClient.quit().catch(() => undefined);
  }
  await closeDb().catch(() => undefined);
  process.exit(1);
});
