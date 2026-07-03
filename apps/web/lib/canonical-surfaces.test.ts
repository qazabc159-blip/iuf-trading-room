import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  ALL_WEB_SURFACES,
  CANONICAL_PRODUCT_SURFACES,
  LEGACY_WEB_SURFACES,
  PRODUCT_COMMAND_SURFACES,
  SUPPORT_WEB_SURFACES,
} from "./canonical-surfaces";
import { primaryNavigation } from "../../../packages/ui/src/index";

const sidebarSource = readFileSync(new URL("../components/Sidebar.tsx", import.meta.url), "utf8");
const commandPaletteSource = readFileSync(new URL("../components/CommandPalette.tsx", import.meta.url), "utf8");
const uiNavigationSource = readFileSync(new URL("../../../packages/ui/src/index.ts", import.meta.url), "utf8");

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
