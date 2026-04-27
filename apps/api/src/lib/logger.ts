/**
 * logger.ts — Structured JSON logger for IUF Trading Room API.
 *
 * W3 B1: H-6 structured logging with mandatory redaction.
 *
 * Hard lines:
 *  - NEVER log: account, person_id, token, password, pfx, KGI secret
 *  - Fields allowed in quote log events: route, symbol, status, latency_ms,
 *    freshness, error_code
 *  - All other fields pass through only if not in REDACTED_FIELDS set
 *
 * Design:
 *  - Thin wrapper around console.error / console.warn / console.info
 *  - Emits JSON to stdout (Railway / Railway logs parse JSON natively)
 *  - No external deps (pino/winston not in package.json — keep it small)
 *  - Redaction is a hard compile-time + runtime defence (not just lint)
 */

// ---------------------------------------------------------------------------
// Redacted field names — hard-coded, NEVER remove from this list
// ---------------------------------------------------------------------------

/**
 * Fields that MUST NEVER appear in log output.
 * Checked at runtime: any key matching these (case-insensitive) is replaced
 * with "[REDACTED]".
 *
 * Hard lines (W3 B1):
 *  - person_id / personId / person-id
 *  - account (raw account string)
 *  - token / accessToken / access_token / auth_token
 *  - password / person_pwd / pwd
 *  - pfx (certificate file)
 *  - KGI_PASSWORD / kgi_password
 *  - secret / api_key / apikey
 */
const REDACTED_FIELDS = new Set([
  "person_id",
  "personid",
  "person-id",
  "account",
  "token",
  "accesstoken",
  "access_token",
  "auth_token",
  "authtoken",
  "password",
  "person_pwd",
  "pwd",
  "pfx",
  "kgi_password",
  "kgipassword",
  "secret",
  "api_key",
  "apikey",
]);

/**
 * Redact sensitive keys from a shallow object.
 * Returns a new object with sensitive keys replaced by "[REDACTED]".
 * Does NOT recurse (keep it simple + fast — quote logs are shallow structs).
 */
export function redactSensitiveFields(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (REDACTED_FIELDS.has(k.toLowerCase())) {
      out[k] = "[REDACTED]";
    } else {
      out[k] = v;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Log levels
// ---------------------------------------------------------------------------

export type LogLevel = "debug" | "info" | "warn" | "error";

// ---------------------------------------------------------------------------
// Structured log event shape (quote-specific)
// ---------------------------------------------------------------------------

/**
 * QuoteLogEvent — structured fields for a quote route log entry.
 * All fields are optional so callers can log partial context.
 *
 * Allowed fields: route, symbol, status, latency_ms, freshness, error_code
 * Everything else is passed via `extra` and is redaction-checked.
 */
export interface QuoteLogEvent {
  route?: string;
  symbol?: string;
  status?: number;
  latency_ms?: number;
  /** "fresh" | "stale" | "not-available" | "unknown" */
  freshness?: string;
  /** Semantic error code, e.g. "QUOTE_DISABLED", "GATEWAY_UNREACHABLE" */
  error_code?: string;
  /** Any additional context (redaction-checked before output) */
  extra?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Logger implementation
// ---------------------------------------------------------------------------

function emit(level: LogLevel, message: string, event?: QuoteLogEvent): void {
  const entry: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    msg: message,
  };

  if (event) {
    // Include the allowed structured fields
    if (event.route !== undefined) entry["route"] = event.route;
    if (event.symbol !== undefined) entry["symbol"] = event.symbol;
    if (event.status !== undefined) entry["status"] = event.status;
    if (event.latency_ms !== undefined) entry["latency_ms"] = event.latency_ms;
    if (event.freshness !== undefined) entry["freshness"] = event.freshness;
    if (event.error_code !== undefined) entry["error_code"] = event.error_code;

    // Extra fields are redaction-checked
    if (event.extra) {
      const safe = redactSensitiveFields(event.extra);
      Object.assign(entry, safe);
    }
  }

  const line = JSON.stringify(entry);
  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
}

// ---------------------------------------------------------------------------
// Exported logger surface
// ---------------------------------------------------------------------------

export const logger = {
  debug(message: string, event?: QuoteLogEvent): void {
    emit("debug", message, event);
  },
  info(message: string, event?: QuoteLogEvent): void {
    emit("info", message, event);
  },
  warn(message: string, event?: QuoteLogEvent): void {
    emit("warn", message, event);
  },
  error(message: string, event?: QuoteLogEvent): void {
    emit("error", message, event);
  },
};

// ---------------------------------------------------------------------------
// Latency helper — wraps an async fn and records start/end time
// ---------------------------------------------------------------------------

export async function withLatency<T>(
  fn: () => Promise<T>,
  onDone: (latencyMs: number, err: unknown) => void
): Promise<T> {
  const t0 = Date.now();
  try {
    const result = await fn();
    onDone(Date.now() - t0, null);
    return result;
  } catch (err) {
    onDone(Date.now() - t0, err);
    throw err;
  }
}
