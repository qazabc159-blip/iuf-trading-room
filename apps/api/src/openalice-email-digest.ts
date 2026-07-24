/**
 * openalice-email-digest.ts
 *
 * Daily email digest worker for OpenAlice alert events.
 * Runs at 17:00 TST (post-market close) via cron scheduler in server.ts.
 *
 * Collects today's iuf_events → formats summary → sends via Resend REST API.
 * Safe-default: RESEND_API_KEY not set → logs intended digest, no actual send.
 * iuf_events table absent (DRAFT migration not promoted) → skips gracefully.
 *
 * Recipient: DIGEST_EMAIL env (must be set in Railway; empty → dry-run mode)
 * From: noreply@eycvector.com (verified domain on Railway)
 *
 * No new package dependencies — uses native fetch.
 */

import { sql as drizzleSql, gte, and } from "drizzle-orm";
import { getDb, isDatabaseMode, execRows } from "@iuf-trading-room/db";
import { resolvePrimaryWorkspaceId } from "./workspace-scope.js";

// ── Constants ──────────────────────────────────────────────────────────────────

const RESEND_API_URL = "https://api.resend.com/emails";
const DIGEST_FROM = process.env["DIGEST_FROM"] ?? "IUF Trading Room <onboarding@resend.dev>";
const DIGEST_EMAIL = process.env["DIGEST_EMAIL"] ?? "";

// ── Types ──────────────────────────────────────────────────────────────────────

type DigestEvent = {
  ruleId: string;
  ruleName: string;
  severity: "info" | "warning" | "critical";
  ticker: string | null;
  payload: Record<string, unknown>;
  triggeredAt: string;
};

export type DigestResult = {
  sent: boolean;
  eventCount: number;
  criticalCount: number;
  warningCount: number;
  infoCount: number;
  recipient: string;
  reason: string | null; // null if sent OK, otherwise skip/error reason
};

// ── Digest state (in-memory, for observability) ────────────────────────────────

let _lastDigestAt: string | null = null;
let _lastDigestResult: DigestResult | null = null;
let _lastDigestWorkspaceId: string | null = null;

export function getDigestState(workspaceId?: string): { lastDigestAt: string | null; lastResult: DigestResult | null } {
  if (workspaceId && workspaceId !== _lastDigestWorkspaceId) {
    return { lastDigestAt: null, lastResult: null };
  }
  return { lastDigestAt: _lastDigestAt, lastResult: _lastDigestResult };
}

// ── Taipei time helpers ────────────────────────────────────────────────────────

function getTaipeiDate(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function getTaipeiHHMM(): number {
  const formatted = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(new Date());
  return parseInt(formatted.replace(":", ""), 10);
}

// ── Event collector ────────────────────────────────────────────────────────────

// Exported (not just internal) so tests can seed real iuf_events rows and
// call this directly — see the R1/#1352 audit fix 2026-07-23: this used to
// read `rows.rows` off db.execute()'s bare-array result, which is always
// `undefined` on drizzle-orm/postgres-js (silent zero), which would have
// made every daily digest report 0 events regardless of what fired.
export async function collectTodayEvents(workspaceId: string): Promise<DigestEvent[]> {
  if (!isDatabaseMode()) return [];
  const db = getDb();
  if (!db) return [];

  const todayStart = `${getTaipeiDate()}T00:00:00+08:00`;

  try {
    const rawRows = await db.execute(
      drizzleSql`
        SELECT rule_id, rule_name, severity, ticker, payload, triggered_at
        FROM iuf_events
        WHERE workspace_id = ${workspaceId}
          AND triggered_at >= ${todayStart}::timestamptz
        ORDER BY
          CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
          triggered_at DESC
        LIMIT 100
      `
    );

    return execRows<{
      rule_id?: string;
      rule_name?: string;
      severity?: string;
      ticker?: string | null;
      payload?: unknown;
      triggered_at?: string;
    }>(rawRows)
      .filter((r) => r.rule_id && r.severity)
      .map((r) => ({
        ruleId: r.rule_id!,
        ruleName: r.rule_name ?? r.rule_id!,
        severity: (r.severity ?? "info") as DigestEvent["severity"],
        ticker: r.ticker ?? null,
        payload: (typeof r.payload === "object" && r.payload !== null)
          ? (r.payload as Record<string, unknown>)
          : {},
        triggeredAt: r.triggered_at ?? new Date().toISOString()
      }));
  } catch {
    // Table not migrated (DRAFT) — skip gracefully
    return [];
  }
}

// ── Email formatter ────────────────────────────────────────────────────────────

const SEVERITY_EMOJI: Record<DigestEvent["severity"], string> = {
  critical: "[CRITICAL]",
  warning:  "[WARNING]",
  info:     "[INFO]"
};

function formatDigestHtml(events: DigestEvent[], date: string): string {
  const critical = events.filter((e) => e.severity === "critical");
  const warnings = events.filter((e) => e.severity === "warning");
  const infos = events.filter((e) => e.severity === "info");

  const renderGroup = (label: string, items: DigestEvent[]): string => {
    if (items.length === 0) return "";
    const rows = items
      .map((e) => {
        const ticker = e.ticker ? `<strong>${e.ticker}</strong>` : "(system)";
        const payloadStr = Object.entries(e.payload)
          .map(([k, v]) => `${k}: ${String(v)}`)
          .join(", ");
        return `<tr>
          <td style="padding:4px 8px">${ticker}</td>
          <td style="padding:4px 8px">${e.ruleName}</td>
          <td style="padding:4px 8px;font-size:11px;color:#666">${payloadStr}</td>
          <td style="padding:4px 8px;font-size:11px;color:#888">${e.triggeredAt.slice(0, 16).replace("T", " ")}</td>
        </tr>`;
      })
      .join("\n");
    return `
      <h3 style="margin:16px 0 8px;color:${label === "CRITICAL" ? "#c0392b" : label === "WARNING" ? "#e67e22" : "#27ae60"}">${label} (${items.length})</h3>
      <table style="border-collapse:collapse;width:100%;font-size:13px">
        <thead>
          <tr style="background:#f8f8f8">
            <th style="padding:4px 8px;text-align:left">Ticker</th>
            <th style="padding:4px 8px;text-align:left">Rule</th>
            <th style="padding:4px 8px;text-align:left">Details</th>
            <th style="padding:4px 8px;text-align:left">Time (UTC)</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>`;
  };

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>OpenAlice Daily Alert Digest — ${date}</title></head>
<body style="font-family:sans-serif;max-width:800px;margin:0 auto;padding:24px;color:#333">
  <h1 style="font-size:20px;margin-bottom:4px">OpenAlice Daily Alert Digest</h1>
  <p style="color:#888;margin-top:0">${date} | ${events.length} events today (critical: ${critical.length}, warning: ${warnings.length}, info: ${infos.length})</p>
  <hr style="border:none;border-top:1px solid #eee;margin:16px 0">
  ${critical.length === 0 && warnings.length === 0 && infos.length === 0
    ? "<p>No events triggered today.</p>"
    : renderGroup("CRITICAL", critical) + renderGroup("WARNING", warnings) + renderGroup("INFO", infos)
  }
  <hr style="border:none;border-top:1px solid #eee;margin:24px 0 8px">
  <p style="font-size:11px;color:#aaa">
    IUF Trading Room — OpenAlice v1 | Auto-generated at 17:00 TST<br>
    To adjust notification preferences, update DIGEST_EMAIL env var.
  </p>
</body>
</html>`.trim();
}

function formatDigestText(events: DigestEvent[], date: string): string {
  if (events.length === 0) {
    return `OpenAlice Daily Alert Digest — ${date}\n\nNo events triggered today.\n`;
  }

  const lines = [
    `OpenAlice Daily Alert Digest — ${date}`,
    `${events.length} events (critical: ${events.filter((e) => e.severity === "critical").length}, warning: ${events.filter((e) => e.severity === "warning").length}, info: ${events.filter((e) => e.severity === "info").length})`,
    "",
    ...events.map((e) => {
      const tag = SEVERITY_EMOJI[e.severity];
      const ticker = e.ticker ?? "system";
      const payloadStr = Object.entries(e.payload)
        .map(([k, v]) => `${k}=${String(v)}`)
        .join(" ");
      return `${tag} [${ticker}] ${e.ruleName} | ${payloadStr} | ${e.triggeredAt.slice(0, 16)}`;
    })
  ];
  return lines.join("\n");
}

// ── Resend email sender ────────────────────────────────────────────────────────

async function sendDigestEmail(
  subject: string,
  html: string,
  text: string
): Promise<{ ok: boolean; reason?: string }> {
  const apiKey = process.env["RESEND_API_KEY"];
  if (!apiKey) {
    console.info("[email-digest] RESEND_API_KEY not set — digest not sent (dry-run mode)");
    return { ok: false, reason: "no_resend_api_key" };
  }

  try {
    const res = await fetch(RESEND_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        from: DIGEST_FROM,
        to: [DIGEST_EMAIL],
        subject,
        html,
        text
      }),
      signal: AbortSignal.timeout(15_000)
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "(no body)");
      console.warn(`[email-digest] Resend HTTP ${res.status}: ${body.slice(0, 200)}`);
      return { ok: false, reason: `resend_http_${res.status}` };
    }

    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[email-digest] Resend call failed: ${msg}`);
    return { ok: false, reason: `resend_error:${msg}` };
  }
}

// ── Main digest function ───────────────────────────────────────────────────────

/**
 * Run the daily email digest.
 * Called from server.ts scheduler at 17:00 TST (post-market close).
 *
 * Window check: only fires between 17:00–17:30 TST to prevent duplicate sends
 * across process restarts. Callers may also call directly (e.g., internal trigger).
 *
 * Never throws — all errors are logged and contained.
 */
export async function runEmailDigestTick(force = false, workspaceIdOverride?: string): Promise<DigestResult> {
  const hhmm = getTaipeiHHMM();
  if (!force && (hhmm < 1700 || hhmm >= 1730)) {
    // Outside 17:00–17:30 window — skip silently
    return {
      sent: false,
      eventCount: 0,
      criticalCount: 0,
      warningCount: 0,
      infoCount: 0,
      recipient: DIGEST_EMAIL,
      reason: "outside_window"
    };
  }

  const date = getTaipeiDate();

  // Dedup: skip if already sent today
  if (_lastDigestAt && _lastDigestAt.startsWith(date)) {
    return {
      sent: false,
      eventCount: 0,
      criticalCount: 0,
      warningCount: 0,
      infoCount: 0,
      recipient: DIGEST_EMAIL,
      reason: "already_sent_today"
    };
  }

  // Guard: DIGEST_EMAIL must be configured — no fallback to personal address
  if (!DIGEST_EMAIL) {
    console.info("[email-digest] DIGEST_EMAIL not set — dry-run mode (no recipient configured)");
    return {
      sent: false,
      eventCount: 0,
      criticalCount: 0,
      warningCount: 0,
      infoCount: 0,
      recipient: "",
      reason: "no_digest_email"
    };
  }

  let activeWorkspaceId: string | null = null;
  try {
    const primaryWorkspaceId = await resolvePrimaryWorkspaceId();
    if (!primaryWorkspaceId) throw new Error("primary_workspace_unavailable");
    if (workspaceIdOverride && workspaceIdOverride !== primaryWorkspaceId) {
      return {
        sent: false,
        eventCount: 0,
        criticalCount: 0,
        warningCount: 0,
        infoCount: 0,
        recipient: DIGEST_EMAIL,
        reason: "workspace_digest_not_configured"
      };
    }
    activeWorkspaceId = primaryWorkspaceId;
    const events = await collectTodayEvents(primaryWorkspaceId);

    const criticalCount = events.filter((e) => e.severity === "critical").length;
    const warningCount = events.filter((e) => e.severity === "warning").length;
    const infoCount = events.filter((e) => e.severity === "info").length;

    const subject = `[OpenAlice] ${date} Daily Digest — ${events.length} event${events.length !== 1 ? "s" : ""}${criticalCount > 0 ? ` ⚠ ${criticalCount} CRITICAL` : ""}`;
    const html = formatDigestHtml(events, date);
    const text = formatDigestText(events, date);

    const { ok, reason } = await sendDigestEmail(subject, html, text);

    const result: DigestResult = {
      sent: ok,
      eventCount: events.length,
      criticalCount,
      warningCount,
      infoCount,
      recipient: DIGEST_EMAIL,
      reason: reason ?? null
    };

    _lastDigestAt = new Date().toISOString();
    _lastDigestResult = result;
    _lastDigestWorkspaceId = activeWorkspaceId;

    if (ok) {
      console.info(
        `[email-digest] Sent to ${DIGEST_EMAIL}: events=${events.length} critical=${criticalCount} warning=${warningCount} info=${infoCount}`
      );
    } else {
      // Log the text digest to stdout so operator can see it even without email
      console.info(`[email-digest] Dry-run digest (reason=${reason}):\n${text}`);
    }

    return result;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[email-digest] Error: ${msg}`);

    const result: DigestResult = {
      sent: false,
      eventCount: 0,
      criticalCount: 0,
      warningCount: 0,
      infoCount: 0,
      recipient: DIGEST_EMAIL,
      reason: `error:${msg}`
    };
    _lastDigestResult = result;
    _lastDigestWorkspaceId = activeWorkspaceId;
    return result;
  }
}
