import { createHash } from "node:crypto";

import { createClient } from "redis";

type TradingViewWebhookSignalRecord = {
  id: string;
  title: string;
  direction: string;
};

type MemoryEventRecord = {
  expiresAt: number;
  value: "pending" | string;
};

type MemoryRateLimitRecord = {
  count: number;
  expiresAt: number;
};

export type TradingViewTimestampValidation =
  | {
      ok: true;
      normalizedTimestamp: string | null;
    }
  | {
      ok: false;
      error: "timestamp_required" | "timestamp_invalid" | "timestamp_out_of_range";
    };

export type TradingViewWebhookClaimResult =
  | {
      status: "new";
      eventKey: string;
      duplicate: false;
    }
  | {
      status: "duplicate";
      eventKey: string;
      duplicate: true;
      signal: TradingViewWebhookSignalRecord;
    }
  | {
      status: "pending";
      eventKey: string;
      duplicate: true;
    };

export type TradingViewRateLimitResult = {
  ok: boolean;
  limit: number;
  count: number;
  retryAfterSeconds: number;
};

const memoryEventCache = new Map<string, MemoryEventRecord>();
const memoryRateLimitCache = new Map<string, MemoryRateLimitRecord>();

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

function getBooleanFromEnv(key: string, fallback: boolean) {
  const raw = process.env[key];
  if (!raw) {
    return fallback;
  }

  if (["1", "true", "yes", "on"].includes(raw.toLowerCase())) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(raw.toLowerCase())) {
    return false;
  }

  return fallback;
}

export function getTradingViewWebhookConfig() {
  return {
    dedupTtlSeconds: getPositiveIntegerFromEnv(
      "TV_WEBHOOK_DEDUP_TTL_SECONDS",
      300,
      30,
      86_400
    ),
    timestampToleranceSeconds: getPositiveIntegerFromEnv(
      "TV_WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS",
      300,
      5,
      86_400
    ),
    rateLimitPerMinute: getPositiveIntegerFromEnv(
      "TV_WEBHOOK_RATE_LIMIT_PER_MINUTE",
      120,
      1,
      10_000
    ),
    enforceTimestamp: getBooleanFromEnv("TV_WEBHOOK_ENFORCE_TIMESTAMP", false)
  };
}

function cleanupExpiredMemoryEntries(now = Date.now()) {
  for (const [key, value] of memoryEventCache.entries()) {
    if (value.expiresAt <= now) {
      memoryEventCache.delete(key);
    }
  }

  for (const [key, value] of memoryRateLimitCache.entries()) {
    if (value.expiresAt <= now) {
      memoryRateLimitCache.delete(key);
    }
  }
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
      console.error("[api] TradingView webhook guard Redis error", error);
    });

    await client.connect();
    redisClient = client;
    redisConnectPromise = null;
    return client;
  })().catch((error) => {
    console.error("[api] Failed to connect TradingView webhook guard Redis client", error);
    redisConnectPromise = null;
    return null;
  });

  return redisConnectPromise;
}

export function validateTradingViewTimestamp(
  value: string | number | null | undefined,
  now = new Date(),
  options = getTradingViewWebhookConfig()
): TradingViewTimestampValidation {
  if (value === null || value === undefined || value === "") {
    return options.enforceTimestamp
      ? { ok: false, error: "timestamp_required" }
      : { ok: true, normalizedTimestamp: null };
  }

  const parsed =
    typeof value === "number"
      ? new Date(value > 1_000_000_000_000 ? value : value * 1000)
      : new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return { ok: false, error: "timestamp_invalid" };
  }

  const deltaSeconds = Math.abs(parsed.getTime() - now.getTime()) / 1000;
  if (deltaSeconds > options.timestampToleranceSeconds) {
    return { ok: false, error: "timestamp_out_of_range" };
  }

  return { ok: true, normalizedTimestamp: parsed.toISOString() };
}

export function buildTradingViewEventKey(input: {
  ticker: string;
  exchange?: string;
  price?: string;
  interval?: string;
  title?: string;
  direction?: string;
  category?: string;
  confidence?: number;
  summary?: string;
  themeIds?: string[];
  companyIds?: string[];
  eventKey?: string;
  timestamp?: string | number | null;
}) {
  if (input.eventKey?.trim()) {
    return input.eventKey.trim();
  }

  const payload = {
    ticker: input.ticker,
    exchange: input.exchange ?? null,
    price: input.price ?? null,
    interval: input.interval ?? null,
    title: input.title ?? null,
    direction: input.direction ?? null,
    category: input.category ?? null,
    confidence: input.confidence ?? null,
    summary: input.summary ?? null,
    timestamp: input.timestamp ?? null,
    themeIds: [...(input.themeIds ?? [])].sort(),
    companyIds: [...(input.companyIds ?? [])].sort()
  };

  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export async function checkTradingViewRateLimit(input: {
  clientIp: string;
  now?: Date;
  options?: ReturnType<typeof getTradingViewWebhookConfig>;
}): Promise<TradingViewRateLimitResult> {
  const options = input.options ?? getTradingViewWebhookConfig();
  const now = input.now ?? new Date();
  const bucket = Math.floor(now.getTime() / 60_000);
  const retryAfterSeconds = 60 - now.getUTCSeconds();
  const key = `tv:webhook:rate:${input.clientIp}:${bucket}`;

  const client = await getRedisClient();
  if (!client) {
    cleanupExpiredMemoryEntries(now.getTime());
    const existing = memoryRateLimitCache.get(key);
    const nextCount = (existing?.count ?? 0) + 1;
    memoryRateLimitCache.set(key, {
      count: nextCount,
      expiresAt: now.getTime() + retryAfterSeconds * 1000
    });

    return {
      ok: nextCount <= options.rateLimitPerMinute,
      limit: options.rateLimitPerMinute,
      count: nextCount,
      retryAfterSeconds
    };
  }

  const count = await client.incr(key);
  if (count === 1) {
    await client.expire(key, retryAfterSeconds);
  }

  return {
    ok: count <= options.rateLimitPerMinute,
    limit: options.rateLimitPerMinute,
    count,
    retryAfterSeconds
  };
}

export async function claimTradingViewEvent(input: {
  eventKey: string;
  ttlSeconds?: number;
}): Promise<TradingViewWebhookClaimResult> {
  const ttlSeconds = input.ttlSeconds ?? getTradingViewWebhookConfig().dedupTtlSeconds;
  const redisKey = `tv:webhook:event:${input.eventKey}`;
  const client = await getRedisClient();

  if (!client) {
    const now = Date.now();
    cleanupExpiredMemoryEntries(now);
    const existing = memoryEventCache.get(redisKey);
    if (!existing) {
      memoryEventCache.set(redisKey, {
        value: "pending",
        expiresAt: now + ttlSeconds * 1000
      });
      return { status: "new", eventKey: input.eventKey, duplicate: false };
    }

    if (existing.value === "pending") {
      return { status: "pending", eventKey: input.eventKey, duplicate: true };
    }

    try {
      return {
        status: "duplicate",
        eventKey: input.eventKey,
        duplicate: true,
        signal: JSON.parse(existing.value) as TradingViewWebhookSignalRecord
      };
    } catch {
      return { status: "pending", eventKey: input.eventKey, duplicate: true };
    }
  }

  const claimed = await client.set(redisKey, "pending", {
    NX: true,
    EX: ttlSeconds
  });

  if (claimed) {
    return { status: "new", eventKey: input.eventKey, duplicate: false };
  }

  const existing = await client.get(redisKey);
  if (!existing || existing === "pending") {
    return { status: "pending", eventKey: input.eventKey, duplicate: true };
  }

  try {
    return {
      status: "duplicate",
      eventKey: input.eventKey,
      duplicate: true,
      signal: JSON.parse(existing) as TradingViewWebhookSignalRecord
    };
  } catch {
    return { status: "pending", eventKey: input.eventKey, duplicate: true };
  }
}

export async function markTradingViewEventComplete(input: {
  eventKey: string;
  signal: TradingViewWebhookSignalRecord;
  ttlSeconds?: number;
}) {
  const ttlSeconds = input.ttlSeconds ?? getTradingViewWebhookConfig().dedupTtlSeconds;
  const redisKey = `tv:webhook:event:${input.eventKey}`;
  const serialized = JSON.stringify(input.signal);
  const client = await getRedisClient();

  if (!client) {
    cleanupExpiredMemoryEntries();
    memoryEventCache.set(redisKey, {
      value: serialized,
      expiresAt: Date.now() + ttlSeconds * 1000
    });
    return;
  }

  await client.set(redisKey, serialized, {
    EX: ttlSeconds
  });
}

export async function clearTradingViewEventClaim(eventKey: string) {
  const redisKey = `tv:webhook:event:${eventKey}`;
  const client = await getRedisClient();

  if (!client) {
    memoryEventCache.delete(redisKey);
    return;
  }

  await client.del(redisKey);
}
