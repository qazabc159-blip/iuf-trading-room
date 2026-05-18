/**
 * admin-themes-manual-update.ts
 *
 * Handler for:
 *   POST /api/v1/admin/themes/manual-update
 *
 * Owner-only admin endpoint to write correct UTF-8 content into themes rows
 * whose name / thesis / whyNow / bottleneck were corrupted by CP950 mojibake
 * and could not be auto-fixed by the re-encode-mojibake endpoint (tryReencode ok=false).
 *
 * Root cause (2026-05-18 Bruce audit):
 *   Themes "5G 通訊" and "低軌衛星" have bytes too broken for iconv-lite CP950 decode.
 *   Manual UPDATE SQL is the only path. This endpoint provides that path without
 *   requiring direct DB access from Bruce's shell.
 *
 * Request body:
 *   {
 *     themeKey: string,      // matches slug column in themes table
 *     name?: string,
 *     thesis?: string,
 *     whyNow?: string,
 *     bottleneck?: string
 *   }
 *
 * At least one of name/thesis/whyNow/bottleneck must be provided.
 *
 * Response:
 *   { data: { ok, themeKey, themeId, fieldsUpdated, updatedAt } }
 *
 * Hard lines:
 *   - Owner-only.
 *   - Writes audit_log action="admin.themes.manual_update".
 *   - No field is cleared to empty string — omitted fields are left unchanged.
 *   - Theme must exist in the current workspace; 404 if not found.
 */

import type { Context } from "hono";
import { getDb, isDatabaseMode, themes, auditLogs } from "@iuf-trading-room/db";
import type { AppSession } from "@iuf-trading-room/contracts";
import { eq, and } from "drizzle-orm";

export interface ThemeManualUpdateRequest {
  themeKey: string;
  name?: string;
  thesis?: string;
  whyNow?: string;
  bottleneck?: string;
}

export interface ThemeManualUpdateResult {
  ok: boolean;
  themeKey: string;
  themeId: string | null;
  fieldsUpdated: string[];
  updatedAt: string | null;
  error?: string;
}

/**
 * Core logic — exported so tests can call it directly.
 */
export async function applyThemeManualUpdate(
  workspaceId: string,
  input: ThemeManualUpdateRequest
): Promise<ThemeManualUpdateResult> {
  const result: ThemeManualUpdateResult = {
    ok: false,
    themeKey: input.themeKey,
    themeId: null,
    fieldsUpdated: [],
    updatedAt: null
  };

  if (!isDatabaseMode()) {
    result.error = "not_database_mode";
    return result;
  }

  const db = getDb();
  if (!db) {
    result.error = "db_unavailable";
    return result;
  }

  // ── Validate at least one field provided ────────────────────────────────────
  const fieldsProvided = (["name", "thesis", "whyNow", "bottleneck"] as const).filter(
    (f) => typeof input[f] === "string" && input[f]!.length > 0
  );

  if (fieldsProvided.length === 0) {
    result.error = "no_fields_provided";
    return result;
  }

  // ── Look up theme by slug (theme_key maps to slug column) ──────────────────
  let themeRow: { id: string } | undefined;
  try {
    const rows = await db
      .select({ id: themes.id })
      .from(themes)
      .where(
        and(
          eq(themes.workspaceId, workspaceId),
          eq(themes.slug, input.themeKey)
        )
      )
      .limit(1);
    themeRow = rows[0];
  } catch (err) {
    result.error = `lookup_failed: ${err instanceof Error ? err.message : String(err)}`;
    return result;
  }

  if (!themeRow) {
    result.error = "theme_not_found";
    return result;
  }

  result.themeId = themeRow.id;

  // ── Build update payload ────────────────────────────────────────────────────
  const updatePayload: Partial<{
    name: string;
    thesis: string;
    whyNow: string;
    bottleneck: string;
    updatedAt: Date;
  }> = { updatedAt: new Date() };

  for (const field of fieldsProvided) {
    const val = input[field];
    if (typeof val === "string" && val.length > 0) {
      (updatePayload as Record<string, unknown>)[field] = val;
      result.fieldsUpdated.push(field);
    }
  }

  // ── Apply UPDATE ────────────────────────────────────────────────────────────
  try {
    await db
      .update(themes)
      .set(updatePayload)
      .where(eq(themes.id, themeRow.id));
  } catch (err) {
    result.error = `update_failed: ${err instanceof Error ? err.message : String(err)}`;
    return result;
  }

  result.ok = true;
  result.updatedAt = updatePayload.updatedAt?.toISOString() ?? null;
  return result;
}

/**
 * POST /api/v1/admin/themes/manual-update
 * Auth: Owner-only
 */
export async function handleAdminThemesManualUpdate(
  c: Context
): Promise<Response> {
  const session = c.get("session") as AppSession | undefined;
  if (!session || session.user.role !== "Owner") {
    return c.json({ error: "OWNER_ONLY" }, 403);
  }

  const workspaceId = session.workspace.id;

  // Parse body
  let body: ThemeManualUpdateRequest;
  try {
    const raw = await c.req.json() as Record<string, unknown>;
    if (!raw || typeof raw["themeKey"] !== "string" || raw["themeKey"].length === 0) {
      return c.json({ error: "MISSING_THEME_KEY" }, 400);
    }
    body = {
      themeKey: raw["themeKey"] as string,
      name: typeof raw["name"] === "string" ? raw["name"] : undefined,
      thesis: typeof raw["thesis"] === "string" ? raw["thesis"] : undefined,
      whyNow: typeof raw["whyNow"] === "string" ? raw["whyNow"] : undefined,
      bottleneck: typeof raw["bottleneck"] === "string" ? raw["bottleneck"] : undefined
    };
  } catch {
    return c.json({ error: "INVALID_BODY" }, 400);
  }

  const result = await applyThemeManualUpdate(workspaceId, body);

  if (result.error === "theme_not_found") {
    return c.json({ data: result }, 404);
  }

  if (result.error === "no_fields_provided") {
    return c.json({ error: result.error }, 400);
  }

  if (!result.ok) {
    return c.json({ data: result }, 500);
  }

  // Write audit log
  if (isDatabaseMode()) {
    const db = getDb();
    if (db && result.themeId) {
      await db
        .insert(auditLogs)
        .values({
          workspaceId,
          actorId: session.user.id,
          action: "admin.themes.manual_update",
          entityType: "theme",
          entityId: result.themeId,
          payload: {
            themeKey: body.themeKey,
            themeId: result.themeId,
            fieldsUpdated: result.fieldsUpdated,
            triggeredAt: new Date().toISOString()
          }
        })
        .catch((err: unknown) => {
          console.error("[admin-themes-manual-update] audit log write failed:", err);
        });
    }
  }

  return c.json({ data: result });
}

// ── Canonical content for 5G 通訊 theme (Bruce call: themeKey="5g") ───────────
//
// Bruce should POST:
// {
//   "themeKey": "5g",
//   "name": "5G 通訊",
//   "thesis": "5G 基礎建設進入規模部署階段，台灣供應鏈掌握射頻元件、天線模組及網通設備核心產能。隨各國加速 Open RAN 佈建與企業專網需求，台系廠商出貨能見度延伸至 2026 下半年。",
//   "whyNow": "美系電信商 CapEx 上修 + 印度 5G 第二波頻段釋出 + 台廠 mmWave 模組通過 Tier-1 認證，短期出貨急單效應明顯。",
//   "bottleneck": "PA/RF 元件料況偏緊；Open RAN 軟體整合工期不確定；大陸廠商低價競爭壓縮 ASP。"
// }
//
// ── Canonical content for 低軌衛星 theme (Bruce call: themeKey="low_orbit_satellite") ──
//
// Bruce should POST:
// {
//   "themeKey": "low_orbit_satellite",
//   "name": "低軌衛星",
//   "thesis": "LEO 星系（Starlink、OneWeb、Telesat）快速擴軌帶動地面終端、衛星酬載與關鍵零組件需求。台灣廠商在相位陣列天線、功率放大器及衛星零組件具比較優勢，受益於全球直連手機（D2D）商轉時程提前。",
//   "whyNow": "Starlink 直連手機服務於 2025 Q4 正式商轉，T-Mobile 合作效應擴大訂單；SpaceX 年發射頻次提升帶動備份星需求；台廠接獲 Tier-1 衛星廠 NPI 訂單能見度至 2026H2。",
//   "bottleneck": "衛星發射頻率受制於 SpaceX 排程；D2D 標準（NTN NR）仍在 3GPP Rel-18/19 迭代中；功率消耗與熱管理在終端小型化方面尚有工程挑戰。"
// }
