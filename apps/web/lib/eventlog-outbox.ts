export type OutboxDiagInput = {
  pendingCount?: number | null;
  fatalCount?: number | null;
  oldestPendingAt?: string | null;
  isPollerRunning?: boolean | null;
};

export type NormalizedOutboxDiag = {
  pendingCount: number | null;
  fatalCount: number | null;
  oldestPendingAt: string | null;
  isPollerRunning: boolean | null;
  hasInvalidCounts: boolean;
  state: "ok" | "pending" | "fatal" | "degraded";
};

function normalizeCount(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return null;
  }
  return Math.floor(value);
}

export function normalizeOutboxDiag(input: OutboxDiagInput | null | undefined): NormalizedOutboxDiag | null {
  if (!input) return null;

  const pendingCount = normalizeCount(input.pendingCount);
  const fatalCount = normalizeCount(input.fatalCount);
  const hasInvalidCounts = pendingCount === null || fatalCount === null;

  let state: NormalizedOutboxDiag["state"] = "ok";
  if (hasInvalidCounts) {
    state = "degraded";
  } else if (fatalCount > 0) {
    state = "fatal";
  } else if (pendingCount > 0) {
    state = "pending";
  }

  return {
    pendingCount,
    fatalCount,
    oldestPendingAt: input.oldestPendingAt ?? null,
    isPollerRunning: typeof input.isPollerRunning === "boolean" ? input.isPollerRunning : null,
    hasInvalidCounts,
    state,
  };
}

export function outboxPendingLabel(outbox: NormalizedOutboxDiag | null): string {
  if (!outbox) return "讀取中";
  if (outbox.hasInvalidCounts || outbox.pendingCount === null) return "診斷異常";
  return String(outbox.pendingCount);
}
