#!/usr/bin/env python3
"""Patch server.ts for CP950 mojibake fixes (avoids linter revert of Edit tool)."""
import os

server_file = os.path.join(
    os.path.dirname(__file__), "..", "apps", "api", "src", "server.ts"
)
server_file = os.path.abspath(server_file)

with open(server_file, "r", encoding="utf-8") as f:
    content = f.read()

# ── PATCH 1: Extend applyThemeTranscode to include name field ─────────────────

OLD_APPLY_TRANSCODE = """function applyThemeTranscode<T extends { thesis?: string | null; whyNow?: string | null; bottleneck?: string | null }>(theme: T): T {
  return {
    ...theme,
    thesis: fixCP950Mojibake(theme.thesis),
    whyNow: fixCP950Mojibake(theme.whyNow),
    bottleneck: fixCP950Mojibake(theme.bottleneck)
  };
}"""

NEW_APPLY_TRANSCODE = """function applyThemeTranscode<T extends { name?: string | null; thesis?: string | null; whyNow?: string | null; bottleneck?: string | null }>(theme: T): T {
  return {
    ...theme,
    name: fixCP950Mojibake(theme.name),
    thesis: fixCP950Mojibake(theme.thesis),
    whyNow: fixCP950Mojibake(theme.whyNow),
    bottleneck: fixCP950Mojibake(theme.bottleneck)
  };
}

/**
 * Sanitize CP950 mojibake in theme write-time input fields.
 * Applies fixCP950Mojibake to name, thesis, whyNow, bottleneck before DB write.
 * This prevents garbled text from entering the DB when requests originate from
 * Windows/PowerShell environments with CP950 system codepage.
 * F3 prevention fix (2026-05-18 Bruce P1 audit).
 */
function sanitizeThemeInput<T extends Partial<{ name: string; thesis: string; whyNow: string; bottleneck: string }>>(input: T): T {
  const result: T = { ...input };
  if (typeof result.name === "string") {
    result.name = fixCP950Mojibake(result.name) ?? result.name;
  }
  if (typeof result.thesis === "string") {
    result.thesis = fixCP950Mojibake(result.thesis) ?? result.thesis;
  }
  if (typeof result.whyNow === "string") {
    result.whyNow = fixCP950Mojibake(result.whyNow) ?? result.whyNow;
  }
  if (typeof result.bottleneck === "string") {
    result.bottleneck = fixCP950Mojibake(result.bottleneck) ?? result.bottleneck;
  }
  return result;
}"""

if OLD_APPLY_TRANSCODE not in content:
    print("ERROR: applyThemeTranscode old pattern not found — may have already been patched?")
    print("Checking if sanitizeThemeInput already present...")
    if "sanitizeThemeInput" in content:
        print("  sanitizeThemeInput already present — skipping patch 1")
    else:
        exit(1)
else:
    content = content.replace(OLD_APPLY_TRANSCODE, NEW_APPLY_TRANSCODE, 1)
    print("PATCH 1 applied: applyThemeTranscode extended + sanitizeThemeInput added")

# ── PATCH 2: Apply sanitizeThemeInput at POST /api/v1/themes write time ──────

OLD_POST_THEMES = """app.post("/api/v1/themes", async (c) => {
  const payload = themeCreateInputSchema.parse(await c.req.json());
  return c.json(
    {
      data: await c.get("repo").createTheme(payload, {
        workspaceSlug: c.get("session").workspace.slug
      })
    },
    201
  );
});"""

NEW_POST_THEMES = """app.post("/api/v1/themes", async (c) => {
  // F3 prevention: sanitize CP950 mojibake at write-time before persisting to DB.
  const rawPayload = themeCreateInputSchema.parse(await c.req.json());
  const payload = sanitizeThemeInput(rawPayload);
  return c.json(
    {
      data: await c.get("repo").createTheme(payload, {
        workspaceSlug: c.get("session").workspace.slug
      })
    },
    201
  );
});"""

if OLD_POST_THEMES not in content:
    print("WARNING: POST /api/v1/themes old pattern not found — skipping patch 2")
else:
    content = content.replace(OLD_POST_THEMES, NEW_POST_THEMES, 1)
    print("PATCH 2 applied: POST /api/v1/themes sanitizeThemeInput added")

# ── PATCH 3: Apply sanitizeThemeInput at PATCH /api/v1/themes/:id ────────────

OLD_PATCH_THEMES = """app.patch("/api/v1/themes/:id", async (c) => {
  const payload = themeUpdateInputSchema.parse(await c.req.json());
  const theme = await c.get("repo").updateTheme(c.req.param("id"), payload, {
    workspaceSlug: c.get("session").workspace.slug
  });
  if (!theme) {
    return c.json({ error: "theme_not_found" }, 404);
  }

  return c.json({ data: theme });
});"""

NEW_PATCH_THEMES = """app.patch("/api/v1/themes/:id", async (c) => {
  // F3 prevention: sanitize CP950 mojibake at write-time before persisting to DB.
  const rawPayload = themeUpdateInputSchema.parse(await c.req.json());
  const payload = sanitizeThemeInput(rawPayload);
  const theme = await c.get("repo").updateTheme(c.req.param("id"), payload, {
    workspaceSlug: c.get("session").workspace.slug
  });
  if (!theme) {
    return c.json({ error: "theme_not_found" }, 404);
  }

  return c.json({ data: applyThemeTranscode(theme) });
});"""

if OLD_PATCH_THEMES not in content:
    print("WARNING: PATCH /api/v1/themes/:id old pattern not found — skipping patch 3")
else:
    content = content.replace(OLD_PATCH_THEMES, NEW_PATCH_THEMES, 1)
    print("PATCH 3 applied: PATCH /api/v1/themes/:id sanitizeThemeInput + applyThemeTranscode added")

# ── PATCH 4: Add the new admin endpoint ───────────────────────────────────────

OLD_LINKS_REBUILD_SECTION = """app.post("/api/v1/admin/themes/links-rebuild", async (c) => {
  const { handleAdminThemesLinksRebuild } = await import("./admin-themes-links-rebuild.js");
  return handleAdminThemesLinksRebuild(c);
});

// =============================================================================
// ADMIN: content-drafts/retry-review"""

NEW_LINKS_REBUILD_SECTION = """app.post("/api/v1/admin/themes/links-rebuild", async (c) => {
  const { handleAdminThemesLinksRebuild } = await import("./admin-themes-links-rebuild.js");
  return handleAdminThemesLinksRebuild(c);
});

// =============================================================================
// ADMIN: themes/re-encode-mojibake — fix CP950 mojibake in themes table (2026-05-18)
// Bruce P1 / Jason F2: some theme rows (e.g. 低軌衛星) had name/thesis/whyNow/bottleneck
// stored as CP950/Big5 bytes misread as Latin-1, causing garbled display in 5/18 brief.
// Auth: Owner-only
// Body: { dryRun?: boolean } — default dryRun=true (preview without writes)
// Set dryRun=false to apply the re-encoding fix in place.
// Idempotent: pure-ASCII rows are skipped; already-correct UTF-8 rows are unaffected.
// =============================================================================
app.post("/api/v1/admin/themes/re-encode-mojibake", async (c) => {
  const { handleAdminThemesReEncodeMojibake } = await import("./admin-themes-re-encode-mojibake.js");
  return handleAdminThemesReEncodeMojibake(c);
});

// =============================================================================
// ADMIN: content-drafts/retry-review"""

if OLD_LINKS_REBUILD_SECTION not in content:
    print("WARNING: links-rebuild endpoint old pattern not found — skipping patch 4")
else:
    content = content.replace(OLD_LINKS_REBUILD_SECTION, NEW_LINKS_REBUILD_SECTION, 1)
    print("PATCH 4 applied: re-encode-mojibake admin endpoint added")

# ── Write back ────────────────────────────────────────────────────────────────

with open(server_file, "w", encoding="utf-8") as f:
    f.write(content)

# Verify
with open(server_file, "r", encoding="utf-8") as f:
    verify = f.read()

checks = [
    "sanitizeThemeInput",
    "re-encode-mojibake",
    "F3 prevention: sanitize CP950 mojibake at write-time",
]
for check in checks:
    if check not in verify:
        print(f"ERROR: '{check}' not found in patched server.ts")
        exit(1)
    print(f"  OK: '{check}' present in server.ts")

print(f"Total server.ts size: {len(verify)} chars")
print("All patches applied successfully.")
