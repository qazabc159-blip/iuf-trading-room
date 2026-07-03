/**
 * Unit tests for invite-team UI helpers (register page password policy
 * + auth-client error message coverage for new invite error codes).
 */

import { describe, expect, it } from "vitest";
import { authErrorMessage } from "./auth-client";

// ── Password policy (inlined from register/page.tsx for testability) ──────────

type PolicyHint = { label: string; met: boolean };

function passwordPolicyHints(p: string): PolicyHint[] {
  return [
    { label: "至少 12 個字元", met: p.length >= 12 },
    { label: "至少 1 個大寫字母", met: /[A-Z]/.test(p) },
    { label: "至少 1 個小寫字母", met: /[a-z]/.test(p) },
    { label: "至少 1 個數字", met: /[0-9]/.test(p) },
  ];
}

function policyPassed(p: string): boolean {
  return passwordPolicyHints(p).every((h) => h.met);
}

describe("passwordPolicyHints", () => {
  it("rejects empty password", () => {
    expect(policyPassed("")).toBe(false);
  });

  it("rejects password under 12 chars", () => {
    expect(policyPassed("Abcdefg1")).toBe(false);
    expect(policyPassed("Abcde12345A")).toBe(false); // 11 chars
  });

  it("rejects password without uppercase", () => {
    expect(policyPassed("abcdefghij12")).toBe(false);
  });

  it("rejects password without lowercase", () => {
    expect(policyPassed("ABCDEFGHIJ12")).toBe(false);
  });

  it("rejects password without digit", () => {
    expect(policyPassed("AbcdefghijKL")).toBe(false);
  });

  it("passes a valid password meeting all rules", () => {
    expect(policyPassed("Abcde12345fg")).toBe(true);   // 12 chars, upper, lower, digit
    expect(policyPassed("MyPassword123!")).toBe(true);  // 14 chars, all rules
  });

  it("returns 4 hints", () => {
    const hints = passwordPolicyHints("x");
    expect(hints).toHaveLength(4);
  });

  it("marks correct hints met for a valid password", () => {
    const hints = passwordPolicyHints("Abcdefgh1234");
    expect(hints.every((h) => h.met)).toBe(true);
  });
});

// ── authErrorMessage: new invite error codes ──────────────────────────────────

describe("authErrorMessage — invite error codes", () => {
  it("maps invalid_or_expired to the invite-link error message", () => {
    const msg = authErrorMessage("invalid_or_expired");
    expect(msg).toContain("邀請連結無效或已過期");
    expect(msg).toContain("聯繫邀請人");
  });

  it("maps invalid_invite_code to the same message as invalid_or_expired", () => {
    const msg1 = authErrorMessage("invalid_or_expired");
    const msg2 = authErrorMessage("invalid_invite_code");
    expect(msg1).toBe(msg2);
  });

  it("maps invite_already_used to a used-invite message", () => {
    const msg = authErrorMessage("invite_already_used");
    expect(msg).toContain("已經使用過");
  });

  it("maps invite_expired to an expiry message", () => {
    const msg = authErrorMessage("invite_expired");
    expect(msg).toContain("過期");
  });

  it("maps email_already_registered", () => {
    const msg = authErrorMessage("email_already_registered");
    expect(msg).toContain("信箱");
    expect(msg).toContain("註冊");
  });

  it("maps network_error", () => {
    const msg = authErrorMessage("network_error");
    expect(msg).toContain("連線");
  });

  it("maps server_error_ prefix generically", () => {
    const msg = authErrorMessage("server_error_500");
    expect(msg).toContain("伺服器");
  });
});

// ── Role label vocabulary (static check) ─────────────────────────────────────

describe("role label consistency", () => {
  const ROLE_LABEL: Record<string, string> = {
    Owner:   "擁有者",
    Admin:   "管理員",
    Analyst: "分析師",
    Trader:  "交易員",
    Viewer:  "檢視者",
  };

  it("all 5 roles have Chinese labels", () => {
    const roles = ["Owner", "Admin", "Analyst", "Trader", "Viewer"];
    for (const role of roles) {
      expect(ROLE_LABEL[role], `${role} must have a Chinese label`).toBeTruthy();
    }
  });

  it("no role label contains English enum value", () => {
    for (const [key, label] of Object.entries(ROLE_LABEL)) {
      expect(label, `${key} label must not expose the raw enum value`).not.toContain(key);
    }
  });
});
