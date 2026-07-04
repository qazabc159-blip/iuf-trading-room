import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const gateSource = readFileSync(new URL("./admin-owner-gate.tsx", import.meta.url), "utf8");
const adminLayoutSource = readFileSync(new URL("../app/admin/layout.tsx", import.meta.url), "utf8");

describe("admin owner route gate", () => {
  it("wraps every /admin page in the owner gate layout", () => {
    expect(adminLayoutSource).toContain("AdminOwnerGate");
    expect(adminLayoutSource).toContain("<AdminOwnerGate>{children}</AdminOwnerGate>");
  });

  it("keeps AdminOwnerGate as a zero-call-site-break Owner wrapper around the generic RoleGate", () => {
    expect(gateSource).toContain("export function RoleGate({ children, minRole = \"Owner\" }");
    expect(gateSource).toContain("export function AdminOwnerGate({ children }: { children: ReactNode }) {");
    expect(gateSource).toContain('return <RoleGate minRole="Owner">{children}</RoleGate>;');
  });

  it("does not render gated children until /auth/me confirms the required role rank", () => {
    expect(gateSource).toContain("apiGetMe");
    expect(gateSource).toContain("meetsMinRole(result.user.role, minRole)");
    expect(gateSource).toContain('if (state.status !== "ready") return <GateShell state={state} minRole={minRole} />');
    expect(gateSource).toContain("return <>{children}</>");
  });

  it("redirects under-ranked accounts away from the gated route", () => {
    expect(gateSource).toContain('reason: result.ok ? "not_owner"');
    expect(gateSource).toContain('state.reason === "unauthenticated"');
    expect(gateSource).toContain("router.replace(target)");
  });
});
