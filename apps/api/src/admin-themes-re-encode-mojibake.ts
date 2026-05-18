/**
 * admin-themes-re-encode-mojibake.ts
 *
 * Handler for:
 *   POST /api/v1/admin/themes/re-encode-mojibake
 *
 * Owner-only admin endpoint that scans the themes table for rows whose
 * name / thesis / whyNow / bottleneck columns contain CP950 mojibake
 * (bytes stored as Latin-1 that should have been UTF-8 Chinese text),
 * and optionally repairs them in-place.
 *
 * Root cause (2026-05-18 Bruce audit):
 *   On Windows / PowerShell environments with system codepage CP950, HTTP
 *   clients (curl, PowerShell Invoke-WebRequest) may encode the request body
 *   with CP950 bytes. If the HTTP transport passes through without re-encoding
 *   (e.g. a raw buffer mode) the Node.js string layer interprets the bytes as
 *   Latin-1 characters, resulting in gibberish like "­ô»ú¾m¬P" instead of
 *   "低軌衛星". These garbled strings are then persisted to the DB.
 *
 * Detection:
 *   A column value is suspected mojibake when it contains codepoints in the
 *   \x80–\xff range AND reinterpreting those bytes as CP950 yields valid CJK
 *   text (no U+FFFD replacement chars after decode).
 *
 * Dry-run mode (default: dryRun=true):
 *   Returns a preview of what would be changed, without writing to the DB.
 *   Set dryRun=false to apply the fix.
 *
 * Safety:
 *   - UPSERT-style UPDATE per row (no TRUNCATE / no bulk DELETE).
 *   - If any field cannot be cleanly decoded (introduces U+FFFD), that field
 *     is left unchanged and flagged in the per-row audit log.
 *   - Idempotent: already-correct UTF-8 rows are skipped (no high bytes).
 */

import type { Context } from "hono";
import { decode as iconvDecode } from "iconv-lite";
import { getDb, isDatabaseMode } from "@iuf-trading-room/db";
import { themes, auditLogs } from "@iuf-trading-room/db";
import type { AppSession } from "@iuf-trading-room/contracts";
import { eq } from "drizzle-orm";

// ── Mojibake detection ─────────────────────────────────────────────────────────

/**
 * Return true when `s` contains at least one byte in \x80–\xff (Latin-1
 * high range). Pure ASCII strings cannot be CP950 mojibake.
 * Exported for unit testing.
 */
export function hasMojibakeCandidate(s: string | null | undefined): boolean {
  if (s == null || s.length === 0) return false;
  return /[\x80-\xff]/.test(s);
}

/**
 * Attempt CP950 → UTF-8 re-encoding.
 * Returns { fixed: string, ok: true } when decode succeeds without replacement chars.
 * Returns { fixed: null, ok: false } when decode introduces U+FFFD or throws.
 * Exported for unit testing.
 */
export function tryReencode(s: string): { fixed: string; ok: true } | { fixed: null; ok: false } {
  try {
    const buf = Buffer.from(s, "latin1");
    const decoded = iconvDecode(buf, "cp950");
    if (decoded.includes("�") || decoded.includes("?")) {
      return { fixed: null, ok: false };
    }
    return { fixed: decoded, ok: true };
  } catch {
    return { fixed: null, ok: false };
  }
}

// ── Per-row result shape ───────────────────────────────────────────────────────

export type MojibakeRowAudit = {
  themeId: string;
  themeName: string;
  fields: {
    name?: { before: string; after: string | null; fixed: boolean };
    thesis?: { before: string; after: string | null; fixed: boolean };
    whyNow?: { before: string; after: string | null; fixed: boolean };
    bottleneck?: { before: string; after: string | null; fixed: boolean };
  };
  anyFixed: boolean;
  anyFailed: boolean;
};

export type ReEncodeMojibakeResponse = {
  ok: boolean;
  dryRun: boolean;
  scannedRows: number;
  affectedRows: number;
  fixedRows: number;
  partialRows: number;
  skippedRows: number;
  audit: MojibakeRowAudit[];
  errors: string[];
};

// ── Handler ───────────────────────────────────────────────────────────────────

/**
 * POST /api/v1/admin/themes/re-encode-mojibake
 * Body: { dryRun?: boolean } (default: dryRun=true — preview only)
 */
export async function handleAdminThemesReEncodeMojibake(
  c: Context
): Promise<Response> {
  const session = c.get("session") as AppSession | undefined;
  if (!session || session.user.role !== "Owner") {
    return c.json({ error: "OWNER_ONLY" }, 403);
  }

  // Parse body — default dryRun=true for safety
  let dryRun = true;
  try {
    const body = await c.req.json() as Record<string, unknown>;
    if (typeof body["dryRun"] === "boolean") {
      dryRun = body["dryRun"];
    }
  } catch {
    // No body or non-JSON — use dryRun=true default
  }

  const result: ReEncodeMojibakeResponse = {
    ok: true,
    dryRun,
    scannedRows: 0,
    affectedRows: 0,
    fixedRows: 0,
    partialRows: 0,
    skippedRows: 0,
    audit: [],
    errors: []
  };

  // ── Memory mode: scan in-memory store not available → return empty ──────────
  if (!isDatabaseMode()) {
    result.errors.push("not_database_mode");
    return c.json({ data: result });
  }

  const db = getDb();
  if (!db) {
    result.errors.push("db_unavailable");
    return c.json({ data: result }, 503);
  }

  const workspaceId = session.workspace.id;

  // ── Load all themes for this workspace ──────────────────────────────────────
  let themeRows: Array<{
    id: string;
    name: string;
    thesis: string | null;
    whyNow: string | null;
    bottleneck: string | null;
  }>;

  try {
    themeRows = await db
      .select({
        id: themes.id,
        name: themes.name,
        thesis: themes.thesis,
        whyNow: themes.whyNow,
        bottleneck: themes.bottleneck
      })
      .from(themes)
      .where(eq(themes.workspaceId, workspaceId));
  } catch (err) {
    result.errors.push(`themes_load_failed: ${err instanceof Error ? err.message : String(err)}`);
    result.ok = false;
    return c.json({ data: result }, 500);
  }

  result.scannedRows = themeRows.length;

  // ── Scan each row ──────────────────────────────────────────────────────────
  for (const row of themeRows) {
    const fieldsToCheck: Array<keyof typeof row & ("name" | "thesis" | "whyNow" | "bottleneck")> = [
      "name",
      "thesis",
      "whyNow",
      "bottleneck"
    ];

    let anyMojibake = false;
    for (const field of fieldsToCheck) {
      const val = row[field];
      if (typeof val === "string" && hasMojibakeCandidate(val)) {
        anyMojibake = true;
        break;
      }
    }

    if (!anyMojibake) {
      result.skippedRows++;
      continue;
    }

    result.affectedRows++;

    const rowAudit: MojibakeRowAudit = {
      themeId: row.id,
      themeName: row.name,
      fields: {},
      anyFixed: false,
      anyFailed: false
    };

    const updatePayload: Partial<{
      name: string;
      thesis: string;
      whyNow: string;
      bottleneck: string;
    }> = {};

    for (const field of fieldsToCheck) {
      const val = row[field];
      if (typeof val !== "string" || !hasMojibakeCandidate(val)) continue;

      const attempt = tryReencode(val);
      if (attempt.ok) {
        rowAudit.fields[field] = { before: val, after: attempt.fixed, fixed: true };
        rowAudit.anyFixed = true;
        // Only add to update payload if value actually changed
        if (attempt.fixed !== val) {
          (updatePayload as Record<string, string>)[field] = attempt.fixed;
        }
      } else {
        rowAudit.fields[field] = { before: val, after: null, fixed: false };
        rowAudit.anyFailed = true;
      }
    }

    result.audit.push(rowAudit);

    if (rowAudit.anyFixed && !rowAudit.anyFailed) {
      result.fixedRows++;
    } else if (rowAudit.anyFailed) {
      result.partialRows++;
    }

    // ── Apply fix (if not dry-run and there are fields to update) ─────────────
    if (!dryRun && Object.keys(updatePayload).length > 0) {
      try {
        await db
          .update(themes)
          .set(updatePayload)
          .where(eq(themes.id, row.id));
      } catch (err) {
        result.errors.push(
          `update_failed theme_id=${row.id}: ${err instanceof Error ? err.message : String(err)}`
        );
        result.ok = false;
      }
    }
  }

  // ── Audit log (write-mode only, non-dry-run) ───────────────────────────────
  if (!dryRun && result.affectedRows > 0) {
    try {
      await db.insert(auditLogs).values({
        workspaceId,
        actorId: session.user.id,
        action: "admin.themes.re_encode_mojibake",
        entityType: "theme",
        entityId: workspaceId,
        payload: {
          scannedRows: result.scannedRows,
          affectedRows: result.affectedRows,
          fixedRows: result.fixedRows,
          partialRows: result.partialRows,
          errorCount: result.errors.length,
          triggeredAt: new Date().toISOString()
        }
      });
    } catch (err) {
      console.error("[admin-themes-re-encode-mojibake] audit log write failed:", err);
    }
  }

  const status = result.errors.length > 0 ? 207 : 200;
  return c.json({ data: result }, status as 200 | 207);
}
