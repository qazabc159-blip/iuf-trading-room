/**
 * realtime.ts — Canonical quote schema for IUF Trading Room
 *
 * Permanent contract. All quote sources (Fubon Neo WS, TWSE MIS, EOD cache)
 * map into this schema before leaving the API. Consumers bind to this shape;
 * swapping the underlying source adapter does NOT change this contract.
 *
 * Freshness model:
 *   live      — sub-second feed (Fubon Neo WS / KGI tick) during market hours
 *   intraday  — TWSE MIS sweep (<30s delayed, trading hours only)
 *   stale     — known quote but exceeded freshness threshold
 *   eod       — official end-of-day close from TWSE/TPEx
 *
 * Not-yet-available fields (e.g. 5-level bid/ask, serial from stream)
 * are nullable and will remain null until the corresponding adapter is wired.
 * Never fabricate data — always null > fake.
 */

import { z } from "zod";

// ── Enum schemas ──────────────────────────────────────────────────────────────

export const quoteExchangeSchema = z.enum(["TWSE", "TPEx"]);

export const quoteMarketSchema = z.enum(["TSE", "OTC", "EMERGING"]);

export const quoteChannelSchema = z.enum(["quote", "tick", "depth"]);

/** Source of the quote data */
export const realtimeQuoteSourceSchema = z.enum([
  "fubon_ws",  // Fubon Neo WebSocket (future live source)
  "shioaji",   // Shioaji / Sinopac SDK (future)
  "twse_mis",  // TWSE MIS intraday sweep (~30s delayed, trading hours)
  "eod"        // TWSE/TPEx end-of-day official close
]);

export const freshnessModeSchema = z.enum([
  "live",       // sub-second from a live stream
  "intraday",   // MIS or near-realtime: seconds to ~30s delay
  "stale",      // data present but older than freshness threshold
  "eod"         // official EOD close; no intraday price available
]);

// ── Flags on a single quote ───────────────────────────────────────────────────

export const quoteFlagsSchema = z.object({
  isTrial: z.boolean().default(false),       // 試撮 / pre-open auction
  isContinuous: z.boolean().default(false),   // 盤中連續撮合
  isOpen: z.boolean().default(false),         // 開盤集合競價
  isClose: z.boolean().default(false),        // 收盤集合競價
  isAfterHours: z.boolean().default(false),   // 盤後定價
  isHalt: z.boolean().default(false)          // 停牌
});

// ── Core quote event (single point-in-time tick from a live stream) ───────────

export const quoteEventSchema = z.object({
  /** Stock code e.g. "2330", "0050" */
  symbol: z.string().min(1),
  /** Primary exchange listing */
  exchange: quoteExchangeSchema,
  /** Market segment */
  market: quoteMarketSchema,
  /** Channel this event arrived on */
  channel: quoteChannelSchema,
  /** Source adapter that produced this event */
  source: realtimeQuoteSourceSchema,
  /** ISO 8601 — timestamp from the source feed (provider time) */
  source_time: z.string(),
  /** ISO 8601 — wall-clock time when this server ingested the event */
  ingest_time: z.string(),
  /** Source-provided serial / sequence number (null when unavailable) */
  serial: z.string().nullable().default(null),
  /** Last traded price */
  last_price: z.number().nullable(),
  /** Size of the last trade (shares). null when source does not provide. */
  last_size: z.number().nonnegative().nullable().default(null),
  /** Cumulative volume for the session. null when source does not provide. */
  total_volume: z.number().nonnegative().nullable().default(null),
  /**
   * Best 5 bid prices (index 0 = best bid).
   * null array when source does not provide depth data.
   */
  bid: z.array(z.number().nullable()).length(5).nullable().default(null),
  /** Best 5 ask prices (index 0 = best ask). null when unavailable. */
  ask: z.array(z.number().nullable()).length(5).nullable().default(null),
  /** Bid sizes matching bid[]. null when unavailable. */
  bid_size: z.array(z.number().nonnegative().nullable()).length(5).nullable().default(null),
  /** Ask sizes matching ask[]. null when unavailable. */
  ask_size: z.array(z.number().nonnegative().nullable()).length(5).nullable().default(null),
  /** Trade session flags */
  flags: quoteFlagsSchema.default({}),
  /** Freshness classification computed at response time */
  freshness_mode: freshnessModeSchema,
  /**
   * Milliseconds elapsed since source_time, computed at response time.
   * Consumers use this to dim/warn stale data.
   */
  freshness_ms: z.number().int().nonnegative(),
  /** Schema version — bump when breaking changes are introduced */
  version: z.literal("1").default("1")
});

// ── Snapshot: latest known state per symbol ───────────────────────────────────
// A snapshot extends QuoteEvent with reference data from EOD (prev_close,
// change_pct) and intraday OHLC. Source of these extra fields may differ
// from `source` when a live feed is blended with EOD reference data.

export const quoteSnapshotSchema = quoteEventSchema.extend({
  /** Previous session close price */
  prev_close: z.number().nullable().default(null),
  /** Absolute price change from prev_close */
  change: z.number().nullable().default(null),
  /** Percent change from prev_close (e.g. 1.23 = +1.23%) */
  change_pct: z.number().nullable().default(null),
  /** Opening price for the current session */
  open: z.number().nullable().default(null),
  /** Intraday high */
  high: z.number().nullable().default(null),
  /** Intraday low */
  low: z.number().nullable().default(null)
});

// ── Snapshot endpoint response wrapper ────────────────────────────────────────

export const quoteSnapshotResponseSchema = z.object({
  /** ISO 8601 — server time when this response was generated */
  generated_at: z.string(),
  /** Symbols for which a snapshot was found */
  symbols_found: z.array(z.string()),
  /** Requested symbols with no data available */
  symbols_missing: z.array(z.string()),
  snapshots: z.array(quoteSnapshotSchema)
});

// ── TypeScript types ──────────────────────────────────────────────────────────

export type QuoteExchange = z.infer<typeof quoteExchangeSchema>;
export type QuoteMarket = z.infer<typeof quoteMarketSchema>;
export type QuoteChannel = z.infer<typeof quoteChannelSchema>;
export type RealtimeQuoteSource = z.infer<typeof realtimeQuoteSourceSchema>;
export type FreshnessMode = z.infer<typeof freshnessModeSchema>;
export type QuoteFlags = z.infer<typeof quoteFlagsSchema>;
export type QuoteEvent = z.infer<typeof quoteEventSchema>;
export type QuoteSnapshot = z.infer<typeof quoteSnapshotSchema>;
export type QuoteSnapshotResponse = z.infer<typeof quoteSnapshotResponseSchema>;
