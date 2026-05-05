# SourceStatusEnvelope Backend Draft — 2026-05-05

**Owner:** Jason (backend-strategy)
**Priority:** P0-4
**Status:** DRAFT TYPE + HELPER SKELETON (no route impl)
**Counterpart:** Athena schema spec (parallel track)

---

## Rationale

We need a single canonical envelope shape for any data source status surface
(FinMind OHLCV, KGI quote, daily brief, k-bar, etc.) that:
1. Distinguishes WHAT the data state is (enum) from WHY it is degraded
2. Hard-gates usability: mock/fallback NEVER crosses into paper/live lanes
3. Separates "data available" from "usable for trading decision"

---

## TS Type Sketch

```typescript
// packages/contracts/src/source-state.ts
// (or apps/api/src/source-status.ts if contracts scope is too broad)

/**
 * Canonical status enum for any IUF data source.
 *
 * LIVE     — source is reachable, data is fresh, meets quality threshold
 * STALE    — source was reachable but last fetch is outside freshness window
 * EMPTY    — source returned 0 rows / no data at all
 * BLOCKED  — source is intentionally disabled (env flag, kill-switch, gate)
 * DEGRADED — source is partially available (high error rate, partial rows)
 * ERROR    — last fetch threw an unrecoverable error
 * MOCK     — data is synthetic / seeded placeholder
 * FALLBACK — data from a secondary source substituting the primary
 */
export type SourceStatusCode =
  | "LIVE"
  | "STALE"
  | "EMPTY"
  | "BLOCKED"
  | "DEGRADED"
  | "ERROR"
  | "MOCK"
  | "FALLBACK";

/**
 * Canonical envelope for a single data source's current status.
 * Produced by evaluateSourceStatus() and surfaced by diagnostics routes.
 */
export type SourceStatusEnvelope = {
  /** Which source this envelope describes (e.g. "finmind_ohlcv", "kgi_quote", "daily_brief") */
  source: string;

  /** Current status code */
  sourceStatus: SourceStatusCode;

  /** ISO-8601 timestamp of the last successful data write / fetch */
  updatedAt: string | null;

  /** Number of rows / records available for this source */
  rowCount: number | null;

  /**
   * Coverage ratio 0.0-1.0. For k-bar: fraction of expected trading days
   * covered. For OHLCV: fraction of tickers with data. Null if not applicable.
   */
  coverage: number | null;

  /**
   * Human-readable reason when sourceStatus is EMPTY, BLOCKED, or DEGRADED.
   * Must not contain secrets or PII. Null otherwise.
   */
  missingReason: string | null;

  /**
   * Human-readable reason when sourceStatus is DEGRADED or ERROR.
   * Null otherwise.
   */
  degradedReason: string | null;

  /**
   * True if data was fetched within the freshness window for this source type.
   * Always false when sourceStatus is STALE / EMPTY / BLOCKED / ERROR.
   */
  isFresh: boolean;

  /**
   * True if this source is considered usable for research / analysis display.
   * MOCK and FALLBACK may still be usable for research (with caveats).
   * EMPTY, ERROR, BLOCKED → false.
   */
  isUsableForResearch: boolean;

  /**
   * True only if source is LIVE or DEGRADED-but-above-threshold AND
   * NOT mock/fallback. Paper trading requires real data.
   *
   * Hard rule: MOCK | FALLBACK → always false.
   */
  isUsableForPaper: boolean;

  /**
   * True only if source is LIVE AND meets live-trading quality bar.
   * Stricter than paper: no tolerance for DEGRADED.
   *
   * Hard rule: MOCK | FALLBACK | DEGRADED | STALE → always false.
   */
  isUsableForLive: boolean;
};
```

---

## evaluateSourceStatus() Skeleton

```typescript
export type SourceStatusInput = {
  source: string;
  lastFetchAt: Date | null;
  rowCount: number | null;
  coverage?: number | null;
  errorMessage?: string | null;
  isMock?: boolean;
  isFallback?: boolean;
  isBlocked?: boolean;
  freshnessWindowMs: number;         // e.g. 6h for OHLCV, 26h for daily brief
  degradedThreshold?: number;        // error rate 0.0-1.0 above which = DEGRADED
  currentErrorRate?: number | null;
};

/**
 * Derives a SourceStatusEnvelope from raw source metrics.
 *
 * Usability hard rules (enforced here, not left to caller):
 *   MOCK    → isUsableForPaper=false, isUsableForLive=false (always)
 *   FALLBACK → isUsableForPaper=false, isUsableForLive=false (always)
 *   FinMind data (real) ≠ usableForPaper/Live automatically — caller must
 *     explicitly set isMock=false AND ensure exchange-feed quality checks pass.
 */
export function evaluateSourceStatus(input: SourceStatusInput): SourceStatusEnvelope {
  const now = Date.now();
  const ageMs = input.lastFetchAt ? now - input.lastFetchAt.getTime() : null;
  const isFresh = ageMs !== null && ageMs <= input.freshnessWindowMs;

  // Determine primary status code
  let sourceStatus: SourceStatusCode;
  if (input.isBlocked) {
    sourceStatus = "BLOCKED";
  } else if (input.isMock) {
    sourceStatus = "MOCK";
  } else if (input.isFallback) {
    sourceStatus = "FALLBACK";
  } else if (input.errorMessage && !input.lastFetchAt) {
    sourceStatus = "ERROR";
  } else if (input.rowCount === 0 || input.rowCount === null) {
    sourceStatus = "EMPTY";
  } else if (
    input.degradedThreshold !== undefined &&
    input.currentErrorRate !== null &&
    input.currentErrorRate !== undefined &&
    input.currentErrorRate >= input.degradedThreshold
  ) {
    sourceStatus = "DEGRADED";
  } else if (!isFresh) {
    sourceStatus = "STALE";
  } else {
    sourceStatus = "LIVE";
  }

  // Hard usability rules — not negotiable
  const isMockOrFallback = input.isMock || input.isFallback;
  const isUsableForResearch =
    !input.isBlocked && sourceStatus !== "ERROR" && sourceStatus !== "EMPTY";
  const isUsableForPaper =
    !isMockOrFallback &&
    (sourceStatus === "LIVE" || sourceStatus === "DEGRADED") &&
    isFresh;
  const isUsableForLive =
    !isMockOrFallback &&
    sourceStatus === "LIVE" &&
    isFresh;

  return {
    source: input.source,
    sourceStatus,
    updatedAt: input.lastFetchAt?.toISOString() ?? null,
    rowCount: input.rowCount,
    coverage: input.coverage ?? null,
    missingReason:
      sourceStatus === "EMPTY"  ? (input.errorMessage ?? "No data available") :
      sourceStatus === "BLOCKED" ? "Source disabled by configuration" :
      null,
    degradedReason:
      sourceStatus === "DEGRADED" ? `Error rate ${((input.currentErrorRate ?? 0) * 100).toFixed(1)}% above threshold` :
      sourceStatus === "ERROR"    ? (input.errorMessage ?? "Unknown error") :
      null,
    isFresh,
    isUsableForResearch,
    isUsableForPaper,
    isUsableForLive,
  };
}
```

---

## Usage Examples

```typescript
// FinMind OHLCV — real data, not mock
const finmindStatus = evaluateSourceStatus({
  source: "finmind_ohlcv",
  lastFetchAt: new Date("2026-05-05T10:00:00Z"),
  rowCount: 726,
  isMock: false,
  isFallback: false,
  freshnessWindowMs: 6 * 60 * 60 * 1000,  // 6h
  currentErrorRate: 0.02,
  degradedThreshold: 0.1,
});
// → sourceStatus=LIVE, isUsableForPaper=true (if within window)

// Mock OHLCV — never crosses paper/live gate
const mockStatus = evaluateSourceStatus({
  source: "finmind_ohlcv",
  lastFetchAt: new Date(),
  rowCount: 500,
  isMock: true,         // ← hard-gates paper/live
  freshnessWindowMs: 6 * 60 * 60 * 1000,
});
// → sourceStatus=MOCK, isUsableForPaper=false, isUsableForLive=false
```

---

## Open Questions for Athena Schema Alignment

1. Does Athena schema use `sourceStatus` (camelCase) or `source_status` (snake_case)?
2. Should `coverage` be 0-1 or 0-100 in the wire format?
3. Is `degradedThreshold` a per-source config or global env var?
4. Where does `SourceStatusEnvelope` live — `packages/contracts` or api-internal?
5. Does Athena spec include a `lastCheckedAt` separate from `updatedAt`?

---

**Lane:** Only types + pure function. No route changes, no DB touch, no migration.
**Next:** Wire into `/api/v1/diagnostics/kbar` and `/api/v1/data-sources/finmind/status`
response shapes once Athena schema alignment confirmed.
