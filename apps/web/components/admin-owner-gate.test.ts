import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const gateSource = readFileSync(new URL("./admin-owner-gate.tsx", import.meta.url), "utf8");
const adminLayoutSource = readFileSync(new URL("../app/admin/layout.tsx", import.meta.url), "utf8");

describe("admin owner route gate", () => {
  it("wraps every /admin page in the owner gate layout", () => {
    expect(adminLayoutSource).toContain("AdminOwnerGate");
    expect(adminLayoutSource).toContain("<AdminOwnerGate>{children}</AdminOwnerGate>");
  });

  it("does not render admin children until /auth/me confirms Owner", () => {
    expect(gateSource).toContain("apiGetMe");
    expect(gateSource).toContain('result.ok && result.user.role === "Owner"');
    expect(gateSource).toContain('if (state.status !== "ready") return <GateShell state={state} />');
    expect(gateSource).toContain("return <>{children}</>");
  });

  it("redirects non-owner accounts away from admin routes", () => {
    expect(gateSource).toContain('reason: result.ok ? "not_owner"');
    expect(gateSource).toContain('state.reason === "unauthenticated"');
    expect(gateSource).toContain('router.replace(target)');
  });
});
