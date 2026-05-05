# Jason — P1: Dev Login Method for Bruce
# Date: 2026-05-05

---

## Problem

Bruce's production smoke baseline requires authenticated requests to:
- `GET /api/v1/companies/2330`
- `POST /auth/login`
- `POST /auth/register`

No test account credentials have been passed to Bruce (correct — no plaintext password via chat/email/GitHub).

---

## Solution: Operator-Provisioned Test Account + Session Probe

### Step 1 — Operator creates a test account (楊董 must do this once)

The Owner-only `/auth/issue-invite` endpoint can create a time-limited invite code.
楊董 logs into `app.eycvector.com`, opens browser DevTools, and runs:

```javascript
// DevTools console on app.eycvector.com (already logged in as Owner)
const r = await fetch("https://api.eycvector.com/auth/issue-invite", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  credentials: "include",
  body: JSON.stringify({ code: "bruce-smoke-2026-05-05", ttlMinutes: 1440 })
});
const d = await r.json();
console.log(d); // { data: { code: "bruce-smoke-2026-05-05", expiresAt: "..." } }
```

Then share the invite code `bruce-smoke-2026-05-05` with Bruce via Bitwarden shared vault.

### Step 2 — Bruce registers a smoke test account

```bash
# Run from Bruce's machine
curl -s -c /tmp/bruce_session.jar -X POST https://api.eycvector.com/auth/register-with-invite \
  -H "Content-Type: application/json" \
  -d '{
    "email": "bruce-smoke@iuf-internal.local",
    "password": "<from-bitwarden>",
    "inviteCode": "bruce-smoke-2026-05-05"
  }' | jq .
```

The response will include `{ user: { role: "Viewer", ... }, workspace: {...} }`.
The `Set-Cookie: iuf_session=...` header is saved into `/tmp/bruce_session.jar`.

### Step 3 — Verify session with the new probe endpoint

```bash
curl -s -b /tmp/bruce_session.jar https://api.eycvector.com/api/v1/auth/session-probe | jq .
```

Expected response (200):
```json
{
  "data": {
    "userId": "...",
    "email": "bruce-smoke@iuf-internal.local",
    "name": "bruce-smoke",
    "role": "Viewer",
    "workspaceSlug": "primary-desk",
    "persistenceMode": "database"
  }
}
```

If this returns 200 with correct identity, Bruce's session is live.

### Step 4 — Run baseline smoke

```bash
# Protected endpoint smoke
curl -s -b /tmp/bruce_session.jar https://api.eycvector.com/api/v1/companies/2330 | jq .status
```

---

## New endpoint added (server.ts)

`GET /api/v1/auth/session-probe`
- Requires valid `iuf_session` cookie (standard auth gate)
- Returns: `{ data: { userId, email, name, role, workspaceSlug, persistenceMode } }`
- Returns 401 if no valid session
- NEVER returns password, token, or any secret

---

## Hard lines

- Invite code transmitted ONLY via Bitwarden shared vault, never via chat/email/GitHub
- Password chosen by Bruce, never seen by Jason or Elva
- This smoke account has role=Viewer (minimum privilege)
- Smoke account is for dev/verify only — not a production user

---

## What Bruce needs to do

1. Wait for 楊董 to run Step 1 and drop invite code in Bitwarden vault
2. Run Steps 2-3 to register and verify
3. Run Step 4 for baseline smoke
4. Report to Elva: session-probe 200 = GREEN, 401 = BLOCKED

---

## What Jason has delivered

- `GET /api/v1/auth/session-probe` endpoint wired in server.ts (after P1-P4 block)
- This evidence document for Bruce
- No plaintext credentials anywhere in this file or code

## Assumptions

- Bitwarden shared vault is the agreed secret channel (per path_locks L6)
- 楊董 is available to run Step 1 (Owner action, cannot be delegated)
- Bruce's machine can reach `https://api.eycvector.com` directly

---

## Status: DELIVERED — waiting for 楊董 Step 1 (invite code issue)
