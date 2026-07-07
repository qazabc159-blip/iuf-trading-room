import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const gateSource = readFileSync(new URL("./admin-owner-gate.tsx", import.meta.url), "utf8");
const adminLayoutSource = readFileSync(new URL("../app/admin/layout.tsx", import.meta.url), "utf8");

// Nested per-route-group layouts — permission matrix v1 D3/D4
// (`reports/permission_matrix/PERMISSION_MATRIX_v1.md`). The blanket
// Owner-only `app/admin/layout.tsx` gate was replaced (2026-07-07) because it
// blocked Admin/Analyst accounts from surfaces the registry says they should
// reach (e.g. /admin/team is Admin+, /admin/content-drafts is Analyst+).
const NESTED_ADMIN_LAYOUTS = [
  { dir: "team", usesGenericRoleGate: true },
  { dir: "content-drafts", usesGenericRoleGate: true },
  { dir: "brain", usesGenericRoleGate: false },
  { dir: "events", usesGenericRoleGate: false },
  { dir: "portfolio", usesGenericRoleGate: false },
  { dir: "tools", usesGenericRoleGate: false },
  { dir: "uta", usesGenericRoleGate: false },
  { dir: "strategies", usesGenericRoleGate: false },
] as const;

describe("admin owner route gate", () => {
  it("no longer blanket-gates every /admin page at the root layout", () => {
    expect(adminLayoutSource).not.toContain("AdminOwnerGate");
    expect(adminLayoutSource).toContain("return <>{children}</>;");
  });

  for (const { dir, usesGenericRoleGate } of NESTED_ADMIN_LAYOUTS) {
    it(`app/admin/${dir}/layout.tsx gates via ${usesGenericRoleGate ? "RoleGate (registry minRole)" : "AdminOwnerGate (Owner)"}`, () => {
      const src = readFileSync(new URL(`../app/admin/${dir}/layout.tsx`, import.meta.url), "utf8");
      if (usesGenericRoleGate) {
        expect(src).toContain("RoleGate");
        expect(src).toContain("canonical-surfaces");
      } else {
        expect(src).toContain("AdminOwnerGate");
      }
    });
  }

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
