import { z } from "zod";

// ── W7 Market Agent Envelope ──────────────────────────────────────────────────
//
// MarketEvent is the wire format pushed from the Market Agent (Windows KGI
// gateway or mock) to the Cloud API ingest endpoint.
//
// Hard lines:
//   - HMAC signature field is a hex string; never contains raw secret
//   - seq is strictly-ordered per (symbol, type); rejections on replay / regression
//   - stale data → reject or warn, never silent fill (W7 hard line #11)

export const marketEventTypeSchema = z.enum(["quote", "tick", "bidask", "kbar"]);

// ── Quote payload (one snapshot per symbol) ───────────────────────────────────
export const marketEventQuoteDataSchema = z.object({
  last: z.number().nullable(),
  bid: z.number().nullable(),
  ask: z.number().nullable(),
  open: z.number().nullable(),
  high: z.number().nullable(),
  low: z.number().nullable(),
  prevClose: z.number().nullable(),
  volume: z.number().nonnegative().nullable(),
  changePct: z.number().nullable()
});

// ── Tick payload (individual trade print) ─────────────────────────────────────
export const marketEventTickDataSchema = z.object({
  price: z.number(),
  size: z.number().nonnegative(),
  side: z.enum(["buy", "sell", "unknown"]).default("unknown")
});

// ── Bid/Ask payload (best-of-book snapshot) ───────────────────────────────────
export const marketEventBidAskDataSchema = z.object({
  bid: z.number().nullable(),
  ask: z.number().nullable(),
  bidSize: z.number().nonnegative().nullable(),
  askSize: z.number().nonnegative().nullable()
});

// ── K-bar payload (OHLCV per interval) ────────────────────────────────────────
export const marketEventKbarDataSchema = z.object({
  interval: z.string().min(1).max(10),   // e.g. "1m", "5m", "1d"
  openTime: z.string(),
  closeTime: z.string(),
  open: z.number(),
  high: z.number(),
  low: z.number(),
  close: z.number(),
  volume: z.number().nonnegative(),
  turnover: z.number().nonnegative().default(0),
  isClosed: z.boolean().default(false)   // true = bar is finalised
});

// ── Envelope ──────────────────────────────────────────────────────────────────
//
// All event types share the same envelope. `data` is discriminated by `type`.
// The agent signs: HMAC-SHA256(secret, `${type}:${symbol}:${ts}:${seq}:${JSON.stringify(data)}`)
export const marketEventSchema = z.object({
  type: marketEventTypeSchema,
  symbol: z.string().min(1).max(20),

  // ISO-8601 UTC timestamp emitted by the agent (not server-receive time)
  ts: z.string().datetime(),

  // Monotonically increasing sequence per (symbol, type); server rejects
  // replays (seq ≤ lastSeq stored) and out-of-order regression (seq < lastSeq)
  seq: z.number().int().nonnegative(),

  // HMAC-SHA256 hex signature.  Server verifies before processing.
  // Format: hex string (64 chars for SHA-256)
  hmac: z.string().min(64).max(64),

  // Discriminated union payload — validated by `type` at ingest time
  data: z.union([
    marketEventQuoteDataSchema,
    marketEventTickDataSchema,
    marketEventBidAskDataSchema,
    marketEventKbarDataSchema
  ])
});

// ── Heartbeat payload ─────────────────────────────────────────────────────────
export const marketAgentHeartbeatSchema = z.object({
  agentId: z.string().min(1).max(64),
  ts: z.string().datetime(),
  symbols: z.array(z.string().min(1).max(20)).default([]),
  version: z.string().max(32).optional()
});

// ── Ingest response ───────────────────────────────────────────────────────────
export const marketIngestResultSchema = z.object({
  ok: z.boolean(),
  eventId: z.string().optional(),        // assigned by server on write
  cached: z.boolean(),                   // true = Redis hot cache updated
  persisted: z.boolean(),                // true = Postgres row written
  rejectedReason: z.string().optional()  // set when ok=false
});

// ── Agent health snapshot ─────────────────────────────────────────────────────
export const marketAgentHealthSchema = z.object({
  agentId: z.string(),
  lastSeenAt: z.string().nullable(),    // ISO-8601 or null if never seen
  isStale: z.boolean(),                  // true if lastSeen > 30s ago
  staleThresholdMs: z.number().int().positive().default(30_000)
});

export type MarketEventType = z.infer<typeof marketEventTypeSchema>;
export type MarketEventQuoteData = z.infer<typeof marketEventQuoteDataSchema>;
export type MarketEventTickData = z.infer<typeof marketEventTickDataSchema>;
export type MarketEventBidAskData = z.infer<typeof marketEventBidAskDataSchema>;
export type MarketEventKbarData = z.infer<typeof marketEventKbarDataSchema>;
export type MarketEvent = z.infer<typeof marketEventSchema>;
export type MarketAgentHeartbeat = z.infer<typeof marketAgentHeartbeatSchema>;
export type MarketIngestResult = z.infer<typeof marketIngestResultSchema>;
export type MarketAgentHealth = z.infer<typeof marketAgentHealthSchema>;
