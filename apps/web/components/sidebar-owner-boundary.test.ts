import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sidebarSource = readFileSync(new URL("./Sidebar.tsx", import.meta.url), "utf8");
const homepageSource = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const headerDockSource = readFileSync(new URL("./header-dock.tsx", import.meta.url), "utf8");
const commandPaletteSource = readFileSync(new URL("./CommandPalette.tsx", import.meta.url), "utf8");
const briefsSource = readFileSync(new URL("../app/briefs/page.tsx", import.meta.url), "utf8");
const registerSource = readFileSync(new URL("../app/register/page.tsx", import.meta.url), "utf8");
const entitlementSource = readFileSync(new URL("../lib/subscription-entitlements.ts", import.meta.url), "utf8");
const contractEntitlementSource = readFileSync(
  new URL("../../../packages/contracts/src/entitlements.ts", import.meta.url),
  "utf8"
);

describe("product navigation owner boundary", () => {
  it("shows internal controls only after the current account's role rank is confirmed (minRole filtering, not a hardcoded Owner boolean)", () => {
    expect(sidebarSource).toContain("apiGetMe");
    expect(sidebarSource).toContain("meetsMinRole");
    expect(sidebarSource).toContain("filter((item) => meetsMinRole(userRole, item.minRole))");
    expect(sidebarSource).toContain("visibleInternalAdminNav.length > 0 && (");
    expect(sidebarSource).toContain('const isOwner = userRole === "Owner"');
    expect(sidebarSource).toContain("CANONICAL_PRODUCT_SURFACES");
    expect(sidebarSource).toContain("OWNER_PRODUCT_SURFACES");
    expect(sidebarSource).toContain("INTERNAL_ADMIN_SURFACES");
    expect(sidebarSource).toContain("內部後台");
    expect(sidebarSource).toContain("Paper / SIM 模式 · Real Order 停用");
  });

  it("does not expose internal admin links from the standalone homepage sidebar", () => {
    expect(homepageSource).not.toContain("const internalNav");
    expect(homepageSource).not.toContain('href: "/admin/brain/llm"');
    expect(homepageSource).not.toContain('href: "/admin/tools"');
    expect(homepageSource).not.toContain('href: "/admin/uta/accounts"');
    expect(homepageSource).toContain("IUF Trading Room");
    expect(homepageSource).toContain("v3.0 · Tactical");
    expect(homepageSource).toContain("Paper / SIM 模式 · Real Order 停用");
    expect(homepageSource).toContain('title: "AI 推薦", sub: "推薦股票"');
  });

  it("does not label every signed-in account as Owner in the header account menu", () => {
    expect(headerDockSource).toContain("apiGetMe");
    expect(headerDockSource).toContain('const isOwner = accountUser?.role === "Owner"');
    expect(headerDockSource).toContain("accountRoleLabel");
    expect(headerDockSource).not.toContain("Owner Workspace");
    expect(headerDockSource).toContain('href="/settings/subscription"');
    expect(headerDockSource).toContain('{isOwner ? (');
    expect(headerDockSource).toContain('href="/settings/broker"');
    expect(headerDockSource).toContain("方案與權限");
    expect(headerDockSource).toContain("AI 每日簡報");
    expect(headerDockSource).toContain("Paper / KGI SIM 模式");
    expect(headerDockSource).not.toContain("notifications lane");
  });

  it("keeps owner internal controls outside customer subscription tiers", () => {
    expect(entitlementSource).toContain("@iuf-trading-room/contracts");
    expect(contractEntitlementSource).toContain('owner_internal: "not_included"');
    expect(contractEntitlementSource).toContain('return role === "Owner"');
  });

  it("keeps admin and ops shortcuts out of customer-facing discovery surfaces", () => {
    expect(commandPaletteSource).not.toContain('href: "/ops"');
    expect(registerSource).not.toContain("/admin/invites");
    expect(briefsSource).toContain("getMyEntitlements");
    expect(briefsSource).toContain("const ownerMode = entitlements?.data?.ownerInternal.visible === true");
    expect(briefsSource).toContain("{ownerMode && (");
    expect(briefsSource).toContain("等待 Owner 審核後發布");
    expect(briefsSource).toContain("CustomerBriefReadinessPanel");
    expect(briefsSource).toContain("{ownerMode ? (");
    expect(briefsSource).toContain("{ownerMode && <JobsPanel");
    expect(briefsSource).toContain("{ownerMode && !displayedBrief && <DraftSourceTrailPanel");
    expect(briefsSource).toContain("if (ownerMode) {");
    expect(briefsSource).toContain("loadJobs()");
    expect(briefsSource).toContain("Owner-only internal workflow");
  });
});
