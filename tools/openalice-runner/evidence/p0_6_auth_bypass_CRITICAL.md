# 🚨 CRITICAL — /api/v1/* auth bypass (discovered 2026-04-25 during P0.6 viewer 403 verify)

**Severity:** P0 — anonymous internet caller is treated as Owner on every `/api/v1/*` request.
**Discovered:** 2026-04-25 ~12:35 UTC by Elva while running `p0_6_viewer_403_verify.py`.
**Status:** unfixed. Reporting to 楊董 before any code change — auth refactor has high blast radius.

## Symptom

A freshly-registered Viewer-role user (cookie set, role=Viewer in DB)
successfully called `POST /api/v1/content-drafts/{id}/approve` and the draft
flipped to status=approved with `reviewedBy` set to the Viewer's user id.

Evidence: `p0_6_viewer_403_FAIL_20260425_123539.json` — viewer's approve returned
HTTP 200 and approved a real draft (`6cdf7da0-...` company_notes for 6947).

## Anonymous bypass — confirmed

```
$ curl -X POST https://api.eycvector.com/api/v1/content-drafts/<uuid>/approve
HTTP/2 404                              # passed role guard, hit DB lookup, draft not found

$ curl https://api.eycvector.com/api/v1/content-drafts?limit=1
HTTP/2 200                              # returns full draft list including LLM payloads
```

No cookie, no auth header, no Origin gate — the role guard does not fire.

## Root cause

Two cooperating bugs:

### Bug 1 — `/api/v1/*` middleware ignores the auth cookie

`apps/api/src/server.ts:223-237`:

```ts
app.use("/api/v1/*", async (c, next) => {
  const workspaceSlug = c.req.header("x-workspace-slug") ?? process.env.DEFAULT_WORKSPACE_SLUG;
  const roleHeader = c.req.header("x-user-role");          // ← role from header, not cookie
  const allowedRoles = ["Owner", "Admin", "Analyst", "Trader", "Viewer"] as const;
  const roleOverride = allowedRoles.find((role) => role === roleHeader);

  const session = await repository.getSession({ workspaceSlug, roleOverride });
  c.set("session", session);
  await next();
});
```

The middleware never looks at `req.cookies` / the `iuf_session` cookie. The
authenticated identity established by `/auth/login` and `/auth/register-with-invite`
is **never propagated** into the API surface.

### Bug 2 — default role is "Owner"

`packages/domain/src/postgres-repository.ts:139-147`:

```ts
private buildSession(workspace, user, options): AppSession {
  return {
    workspace,
    user: {
      ...user,
      role: options?.roleOverride ?? "Owner"            // ← default-allow-Owner
    },
    persistenceMode: "database"
  };
}
```

Combined: if `x-user-role` header is missing or invalid, the session role
falls back to `"Owner"`. Any anonymous request hitting `/api/v1/*` is treated
as Owner of the default workspace.

## Why the role guard "looks" correct in code

`apps/api/src/server.ts:1942-1948` — `REVIEW_ROLES = new Set(["Owner", "Admin"])`
and the handler returns 403 if the session role isn't in that set. The guard
logic is sound. But the **role it is gating against is attacker-controlled** via
the `x-user-role` header, with `"Owner"` as the default-allow fallback.

Verified locally: when the verify script pins `x-user-role: Viewer` on the
session, the same approve/reject endpoints return 403 forbidden_role as
expected — confirming the guard works when the role is honest.

Evidence: `p0_6_viewer_403_PASS_20260425_123802.json` — guard fires with header pinned.

## Blast radius

- **Read:** every `/api/v1/*` GET is publicly readable by an anonymous caller.
  This includes `content-drafts` (LLM payloads), `themes`, `companies`,
  `signals`, `briefs`, `reviews`, `audit-logs`, `risk-policies`, etc. —
  effectively the entire workspace.
- **Write:** every POST/PATCH/DELETE on `/api/v1/*` is executable by an
  anonymous caller. Approve/reject content drafts, mutate themes, create
  signals, change risk policies, etc.
- **Identity in audit log:** anonymous-driven writes are attributed to the
  default Owner user (`qazabc159@gmail.com`) — log entries do not distinguish
  these from real Owner actions.

The browser frontend works because it sends `x-workspace-slug` (and likely
`x-user-role` for role-switching demo modes); cookie-based auth never had to
hold up the API surface.

## Why I am not fixing this autonomously

1. **Refactor scope:** rewrite `/api/v1/*` middleware to read cookie → fetch
   user → set role from DB. Touches every API request path.
2. **Backwards compat:** the runner client (`tools/openalice-runner`),
   web `apps/web/lib/api.ts`, and any external integrations may rely on the
   header-based behavior. A naive "require cookie or 401" deploy could break
   the runner and the live UI.
3. **Design intent unclear:** the header-based mode reads like dev/demo
   role-switching (no auth in P0 days). I do not know whether 楊董 wants
   header-mode preserved as an Owner-only debug switch, killed entirely, or
   wrapped behind an env flag.
4. **Hard-line:** "destructive" includes "high-blast-radius app-breaking
   changes without 楊董 ack". This qualifies.

## Recommended fix shape (for 楊董's call)

Three options, increasing safety:

**A. Minimum patch (~30 lines).** In `/api/v1/*` middleware: parse
`iuf_session` cookie via `parseSessionCookie` + `getUserById`. If valid,
use that user's DB role. If invalid/missing, return 401. Drop the
`x-user-role` header as auth input entirely (or accept it only when the
authenticated user has role=Owner, as a debug switch).

**B. Plus default-deny role.** Change `buildSession` default from `"Owner"`
to `"Viewer"` (or `"Anonymous"`). Belt-and-suspenders.

**C. Plus audit-log surface fix.** Audit-log entries for anonymous-driven
writes between Wave 0 and 2026-04-25 cannot be retroactively attributed,
but new audit entries should include `userId` from the authenticated
session, not a fall-back default.

Option **A + B** is the minimum I'd ship.

## Evidence artifacts

- `p0_6_viewer_403_FAIL_20260425_123539.json` — viewer cookie alone, approve returned 200, draft approved
- `p0_6_viewer_403_PASS_20260425_123802.json` — viewer cookie + pinned `x-user-role: Viewer` header, approve returned 403
- (live curl above) — anonymous GET /api/v1/content-drafts → 200, anonymous POST approve → 404 (passed role guard)

## What I want from 楊董

Sign-off on fix shape (A / A+B / A+B+C / something else) and any rollout
constraints (window, off-market only, staged behind flag, etc.). Once
ack'd I will draft a plan and verify ladder before touching the
middleware.

— Elva, 2026-04-25T12:42Z
