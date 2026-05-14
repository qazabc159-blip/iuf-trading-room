# Jason — Emergency Password Reset + Change Password
**Date**: 2026-05-14 23:55 TST
**Branch**: feat/api-owner-reset-password-emergency-2026-05-14
**Trigger**: PR #426 plaintext credential leak; no self-service password rotation existed

---

## Files Changed

| File | Change |
|------|--------|
| `apps/api/src/auth-store.ts` | Added `validateNewPassword()` + `updateUserPassword()` |
| `apps/api/src/server.ts` | Added P0 + P1 endpoints |
| `tests/ci.test.ts` | Added PWD1–PWD5 tests |

---

## P0 — POST /api/v1/admin/owner-reset-password

- Owner-only gate (`session.user.role !== "Owner"` → 403)
- Body: `{ newPassword: string (min 12 chars) }`
- Validates: min 12 chars + uppercase + lowercase + digit
- Hashes with existing `hashPassword()` (scrypt, same as all other auth paths)
- Updates `users.password_hash` for current session user
- Clears caller's session cookie in response → forces re-login
- Audit log: `[admin/owner-reset-password] user_id=<id>, action=password_rotated, ip=<ip>`
- **NEVER logs password value**

### Session invalidation caveat
Sessions are stateless HMAC-signed cookies (no sessions table in DB). Full multi-device invalidation requires a `password_version` column migration (deferred — not this sprint). The response clears the caller's own cookie. Other active sessions remain until the old password fails to match the new hash — which means anyone with an old session cookie can still make requests until cookie expiry (30 days). Recommendation:楊董 should also rotate `SEED_OWNER_PASSWORD` env var in Railway if that path was exposed.

---

## P1 — POST /api/v1/auth/change-password

- Any authenticated user
- Body: `{ currentPassword: string, newPassword: string (min 12 chars) }`
- Verifies `currentPassword` against stored hash before allowing update
- Validates new password complexity
- Keeps current session active (caller does not need to re-login)
- Audit log: `[auth/change-password] user_id=<id>, action=password_changed, ip=<ip>`

---

## Password Policy (validateNewPassword)

- min 12 characters
- at least 1 uppercase letter
- at least 1 lowercase letter
- at least 1 digit
- Returns null if valid, error code string if not

---

## Test Results

```
✔ PWD1: validateNewPassword rejects passwords shorter than 12 chars
✔ PWD2: validateNewPassword rejects passwords missing required complexity
✔ PWD3: validateNewPassword accepts a valid complex password
✔ PWD4: hashPassword and verifyPassword round-trip correctly
✔ PWD5: updateUserPassword is exported from auth-store
```

contracts build: GREEN
api typecheck: GREEN
test: 270/271 pass (1 pre-existing failure, baseline was 260/261 before this PR)

---

## Hard Lines Verification

- [x] Password value NEVER logged
- [x] Password NEVER echoed in response
- [x] Plaintext NEVER stored (scrypt hash only)
- [x] No schema migration (uses existing `password_hash` column)
- [x] No contracts change
- [x] Lane boundary maintained (auth-store.ts + server.ts only)

---

## Frontend Note (for Codex)

`/settings/account` page needs a change-password form with:
- `currentPassword` input (type=password)
- `newPassword` input (type=password)
- Submit → `POST /api/v1/auth/change-password`
- On success: show "Password updated." toast
- On `invalid_current_password`: show "Current password is incorrect"
- On policy error: show "Password must be at least 12 characters with uppercase, lowercase, and digit"
