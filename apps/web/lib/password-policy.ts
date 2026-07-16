// Shared password policy — real-time hint rules for /register and
// /reset-password (both need the identical 4-rule checklist UI). Extracted
// out of register/page.tsx (2026-07-17) so /reset-password reuses the exact
// same implementation instead of duplicating it.
//
// Frontend enforces 12 chars + complexity; backend minimum is 8 (legacy) for
// /change-password, but 12 for the new admin-mediated reset flow (matches
// this policy exactly — see apps/api/src/auth-store.ts validateNewPassword()).

export type PolicyRule = { key: "len" | "upper" | "lower" | "digit"; label: string; met: boolean };

export function passwordPolicyRules(p: string): PolicyRule[] {
  return [
    { key: "len", label: "至少 12 字元", met: p.length >= 12 },
    { key: "upper", label: "含大寫字母", met: /[A-Z]/.test(p) },
    { key: "lower", label: "含小寫字母", met: /[a-z]/.test(p) },
    { key: "digit", label: "含數字", met: /[0-9]/.test(p) },
  ];
}

export function policyPassed(p: string): boolean {
  return passwordPolicyRules(p).every((r) => r.met);
}
