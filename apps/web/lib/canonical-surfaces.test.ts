import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  ALL_WEB_SURFACES,
  CANONICAL_PRODUCT_SURFACES,
  INTERNAL_ADMIN_SURFACES,
  LEGACY_WEB_SURFACES,
  OWNER_PRODUCT_SURFACES,
  PRODUCT_COMMAND_SURFACES,
  ROLE_RANK,
  SECONDARY_ADMIN_SURFACES,
  SUPPORT_WEB_SURFACES,
  meetsMinRole,
  type WorkspaceRole,
} from "./canonical-surfaces";
import { primaryNavigation } from "../../../packages/ui/src/index";

const sidebarSource = readFileSync(new URL("../components/Sidebar.tsx", import.meta.url), "utf8");
const commandPaletteSource = readFileSync(new URL("../components/CommandPalette.tsx", import.meta.url), "utf8");
const uiNavigationSource = readFileSync(new URL("../../../packages/ui/src/index.ts", import.meta.url), "utf8");
const roleGateSource = readFileSync(new URL("../components/admin-owner-gate.tsx", import.meta.url), "utf8");

const ROLES_LOWEST_TO_HIGHEST: readonly WorkspaceRole[] = ["Viewer", "Trader", "Analyst", "Admin", "Owner"];

const canonicalProductPaths = [
  "/",
  "/market-intel",
  "/ai-recommendations",
  "/portfolio",
  "/companies",
  "/quant-strategies",
] as const;

const legacySprawlPaths = [
  "/ideas",
  "/runs",
  "/signals",
  "/plans",
  "/themes",
  "/quote",
  "/reviews",
  "/drafts",
  "/lab",
  "/ops",
] as const;

describe("canonical web surfaces", () => {
  it("defines the formal customer product entry points as the only command pages", () => {
    expect(CANONICAL_PRODUCT_SURFACES.map((surface) => surface.path)).toEqual([...canonicalProductPaths]);
    expect(PRODUCT_COMMAND_SURFACES.map((surface) => surface.path)).toEqual([...canonicalProductPaths]);
    expect(CANONICAL_PRODUCT_SURFACES.every((surface) => surface.kind === "external")).toBe(true);
    expect(CANONICAL_PRODUCT_SURFACES.every((surface) => surface.disposition === "canonical")).toBe(true);
  });

  it("keeps sprawl and legacy routes out of public navigation", () => {
    const canonicalPaths = new Set<string>(CANONICAL_PRODUCT_SURFACES.map((surface) => surface.path));
    const legacyPaths = LEGACY_WEB_SURFACES.map((surface) => surface.path);

    expect(legacyPaths).toEqual(expect.arrayContaining([...legacySprawlPaths]));
    for (const path of legacySprawlPaths) {
      expect(canonicalPaths.has(path)).toBe(false);
    }
    expect(LEGACY_WEB_SURFACES.filter((surface) => !surface.replacementPath)).toEqual([]);
  });

  it("classifies account and broker settings as support surfaces instead of legacy pages", () => {
    expect(SUPPORT_WEB_SURFACES.find((surface) => surface.path === "/settings/broker")).toMatchObject({
      title: "券商連線",
      disposition: "secondary",
    });
    expect(SUPPORT_WEB_SURFACES.find((surface) => surface.path === "/settings/subscription")).toMatchObject({
      title: "方案與權限",
      disposition: "secondary",
    });
  });

  it("has no duplicated top-level registry paths", () => {
    const paths = ALL_WEB_SURFACES.map((surface) => surface.path);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("makes Sidebar and CommandPalette consume the canonical registry", () => {
    expect(sidebarSource).toContain("CANONICAL_PRODUCT_SURFACES");
    expect(sidebarSource).toContain("OWNER_PRODUCT_SURFACES");
    expect(sidebarSource).toContain("INTERNAL_ADMIN_SURFACES");
    expect(sidebarSource).not.toContain("const NAV");

    expect(commandPaletteSource).toContain("PRODUCT_COMMAND_SURFACES");
    expect(commandPaletteSource).not.toContain('code: "08"');
    expect(commandPaletteSource).not.toContain('href: "/signals"');
    expect(commandPaletteSource).not.toContain('href: "/plans"');
    expect(commandPaletteSource).not.toContain('href: "/briefs"');
  });

  it("keeps the shared UI navigation aligned with the formal web product surfaces", () => {
    expect(primaryNavigation.map((item) => item.href)).toEqual([...canonicalProductPaths]);
    expect(uiNavigationSource).not.toContain('href: "/signals"');
    expect(uiNavigationSource).not.toContain('href: "/ideas"');
    expect(uiNavigationSource).not.toContain('href: "/runs"');
    expect(uiNavigationSource).not.toContain('href: "/plans"');
    expect(uiNavigationSource).not.toContain('href: "/quote"');
  });
});

describe("permission matrix v1 D4 — surface minRole", () => {
  it("gives every registered surface a minRole value from the D1 ladder", () => {
    for (const surface of ALL_WEB_SURFACES) {
      expect(ROLES_LOWEST_TO_HIGHEST).toContain(surface.minRole);
    }
  });

  it("keeps the front-end rank table numerically identical to the D1 ladder (Viewer<Trader<Analyst<Admin<Owner)", () => {
    expect(ROLE_RANK).toEqual({ Viewer: 0, Trader: 1, Analyst: 2, Admin: 3, Owner: 4 });
  });

  it("marks the 6 formal product surfaces as Viewer-visible", () => {
    expect(CANONICAL_PRODUCT_SURFACES.every((surface) => surface.minRole === "Viewer")).toBe(true);
  });

  it("keeps G-OWNER surfaces (F-AUTO SIM, brain/themes governance) at Owner", () => {
    expect(OWNER_PRODUCT_SURFACES.every((surface) => surface.minRole === "Owner")).toBe(true);
    expect(
      INTERNAL_ADMIN_SURFACES.filter((surface) => surface.path !== "/admin/team").every(
        (surface) => surface.minRole === "Owner"
      )
    ).toBe(true);
  });

  it("carves out /admin/team (invites/user management) to Admin per PM-O3", () => {
    expect(INTERNAL_ADMIN_SURFACES.find((surface) => surface.path === "/admin/team")?.minRole).toBe("Admin");
    expect(SECONDARY_ADMIN_SURFACES.find((surface) => surface.path === "/admin/invites")?.minRole).toBe("Admin");
  });

  it("keeps content-drafts read access at Analyst (original READ_DRAFT_ROLES intent)", () => {
    expect(SECONDARY_ADMIN_SURFACES.find((surface) => surface.path === "/admin/content-drafts")?.minRole).toBe(
      "Analyst"
    );
  });

  it("meetsMinRole implements the strict ladder and fails closed on unknown/missing role", () => {
    expect(meetsMinRole("Owner", "Owner")).toBe(true);
    expect(meetsMinRole("Admin", "Owner")).toBe(false);
    expect(meetsMinRole("Admin", "Admin")).toBe(true);
    expect(meetsMinRole("Analyst", "Admin")).toBe(false);
    expect(meetsMinRole("Viewer", "Viewer")).toBe(true);
    expect(meetsMinRole(null, "Viewer")).toBe(false);
    expect(meetsMinRole(undefined, "Viewer")).toBe(false);
    expect(meetsMinRole("not_a_role", "Viewer")).toBe(false);
  });

  it("Sidebar and CommandPalette gate nav/search visibility through meetsMinRole (not a hardcoded Owner boolean)", () => {
    expect(sidebarSource).toContain("meetsMinRole");
    expect(sidebarSource).toContain("filter((item) => meetsMinRole(userRole, item.minRole))");
    expect(commandPaletteSource).toContain("meetsMinRole");
    expect(commandPaletteSource).toContain("ROUTES_ALL.filter((route) => meetsMinRole(userRole, route.minRole))");
  });

  it("admin-owner-gate.tsx exposes a generic RoleGate and gates via meetsMinRole", () => {
    expect(roleGateSource).toContain("export function RoleGate(");
    expect(roleGateSource).toContain("meetsMinRole(result.user.role, minRole)");
  });
});

describe("permission matrix v1 D4 — per-role visible surface sets (mocked-role behavior)", () => {
  // These exercise the exact function (meetsMinRole) and exact data (canonical-surfaces.ts arrays)
  // that Sidebar.tsx / CommandPalette.tsx call after `apiGetMe()` resolves — i.e. this is the
  // real per-role filtering behavior, not just a source-string assertion.
  function visiblePaths(surfaces: readonly { path: string; minRole: WorkspaceRole }[], role: WorkspaceRole | null) {
    return surfaces.filter((surface) => meetsMinRole(role, surface.minRole)).map((surface) => surface.path);
  }

  it("Viewer sees the 6 canonical product surfaces and zero internal admin surfaces", () => {
    expect(visiblePaths(CANONICAL_PRODUCT_SURFACES, "Viewer")).toEqual(
      CANONICAL_PRODUCT_SURFACES.map((surface) => surface.path)
    );
    expect(visiblePaths(OWNER_PRODUCT_SURFACES, "Viewer")).toEqual([]);
    expect(visiblePaths(INTERNAL_ADMIN_SURFACES, "Viewer")).toEqual([]);
  });

  it("Trader sees canonical surfaces plus /settings/broker, still zero internal admin surfaces", () => {
    expect(visiblePaths(CANONICAL_PRODUCT_SURFACES, "Trader")).toEqual(
      CANONICAL_PRODUCT_SURFACES.map((surface) => surface.path)
    );
    expect(visiblePaths(SUPPORT_WEB_SURFACES, "Trader")).toContain("/settings/broker");
    expect(visiblePaths(INTERNAL_ADMIN_SURFACES, "Trader")).toEqual([]);
  });

  it("Analyst additionally sees /admin/content-drafts but not /admin/team or /admin/invites", () => {
    expect(visiblePaths(SECONDARY_ADMIN_SURFACES, "Analyst")).toEqual(["/admin/content-drafts"]);
    expect(visiblePaths(INTERNAL_ADMIN_SURFACES, "Analyst")).toEqual([]);
  });

  it("Admin sees /admin/team and /admin/invites but not brain/themes/UTA/tools/events/strategies/snapshots", () => {
    expect(visiblePaths(INTERNAL_ADMIN_SURFACES, "Admin")).toEqual(["/admin/team"]);
    expect(visiblePaths(SECONDARY_ADMIN_SURFACES, "Admin")).toEqual(["/admin/content-drafts", "/admin/invites"]);
    expect(visiblePaths(OWNER_PRODUCT_SURFACES, "Admin")).toEqual([]);
  });

  it("Owner sees every surface in the registry (superset of every lower role)", () => {
    expect(visiblePaths(ALL_WEB_SURFACES, "Owner")).toEqual(ALL_WEB_SURFACES.map((surface) => surface.path));
  });

  it("null/unauthenticated role sees nothing beyond nothing (fail-closed)", () => {
    expect(visiblePaths(CANONICAL_PRODUCT_SURFACES, null)).toEqual([]);
    expect(visiblePaths(ALL_WEB_SURFACES, null)).toEqual([]);
  });
});
