import process from "node:process";
import { setInterval } from "node:timers";

import { createClient } from "redis";

const jobs = [
  "ingest.my_tw_coverage",
  "brief.generate_daily",
  "signal.enrich",
  "review.refresh_metrics",
  "openalice.run_task"
];

const heartbeatSeconds = Number(process.env.WORKER_HEARTBEAT_SECONDS ?? 60);
const persistenceMode = process.env.PERSISTENCE_MODE ?? "memory";
const redisUrl = process.env.REDIS_URL ?? null;

type RedisConnection = ReturnType<typeof createClient>;

let redisClient: RedisConnection | null = null;
let heartbeatTimer: NodeJS.Timeout | null = null;

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

  if (redisClient) {
    await redisClient.quit().catch((error) => {
      console.error("[worker] Redis shutdown error", error);
    });
    redisClient = null;
  }

  process.exit(0);
}

async function main() {
  console.log("IUF Trading Room worker booted.");
  console.log(`[worker] Persistence mode: ${persistenceMode}`);
  console.log("[worker] Registered Wave 0 job placeholders:");
  for (const job of jobs) {
    console.log(`- ${job}`);
  }

  redisClient = await connectRedis();

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
  process.exit(1);
});
