-- Migration 0053: durable scheduler round-robin cursors.
-- Persists apps/api/src/server.ts's per-job FinMind sync scheduler cursor.
-- Previously an in-memory Map<string, number> (`_finMindSchedulerCursors`)
-- that reset to 0 on every process restart — this repo deploys many times a
-- day, so low-sort-order tickers got refreshed on every reset while
-- high-sort-order tickers were starved between resets (2026-07-12, #1229
-- A5/A6 finding: 8069 日K斷更 / 2634 法人買賣超, traced to this cursor reset).
-- Single global row per job name — matches the existing in-memory Map, which
-- is keyed only by job name (e.g. "ohlcv", "institutional"), not by
-- workspace; there is currently exactly one workspace in production.

CREATE TABLE IF NOT EXISTS scheduler_cursors (
  job        TEXT        PRIMARY KEY,
  cursor     INTEGER     NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
