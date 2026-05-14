# Jason — Notifications Auth Gate Fix 2026-05-15

## Pete Round 2 Red: notifications stub missing Owner-only auth gate

**Branch**: fix/api-notifications-auth-gate-2026-05-15  
**File**: apps/api/src/server.ts (lines 13762–13772)

## Change

Added identical Owner-only auth gate to both endpoints:

```ts
const session = c.get("session");
if (!session || session.user.role !== "Owner") {
  return c.json({ error: "OWNER_ONLY" }, 403);
}
```

- `GET /api/v1/notifications` — gate added before stub return
- `POST /api/v1/notifications/:id/mark-read` — gate added before 204 return

Stub logic unchanged (empty list / 204). No DB changes. No contract changes.

## Pattern match

Same pattern as `/themes/wiki/:token` alias (PR #496) and all other Owner-only endpoints in server.ts.

## Lane boundary

Only touched strategy-lane-permitted file `apps/api/src/server.ts` (notifications endpoint block only). No cross-lane changes.
