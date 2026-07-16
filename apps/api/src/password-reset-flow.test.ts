// password-reset-flow.test.ts — 2026-07-16
//
// HTTP-boundary regression lock for the admin-mediated "forgot password"
// flow. Spawns the real server (same harness pattern as
// __tests__/alerts-audience-auth.test.ts / auth/role-matrix.test.ts) and
// drives it over real fetch() calls, so this proves the exact behavior a
// caller sees — not a re-implementation of password-reset-store.ts's logic
// (that's covered directly in password-reset-store.test.ts).
//
// Covers the two properties that can only be observed at the HTTP boundary:
//   1. Account-enumeration protection: POST /api/v1/auth/request-password-reset
//      must return byte-identical status+body for an existing vs a
//      non-existent email.
//   2. Session invalidation: after a successful reset, a cookie issued
//      *before* the reset must be rejected by the real /api/v1/* auth
//      middleware on the very next request (not just "the store bumped a
//      column" — the middleware has to actually enforce it).
//
// Wired into `pnpm run test:db` (package.json), not `pnpm test`.

import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import net from "node:net";
import path from "node:path";
import test, { after, before } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { eq } from "drizzle-orm";
import { getDb, passwordResetTokens, users, workspaces } from "@iuf-trading-room/db";

import { hashPassword } from "./auth-store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..", "..");
const serverEntry = path.join(repoRoot, "apps", "api", "src", "server.ts");

let baseUrl = "";
let server: ChildProcess | undefined;
let serverOutput = "";
let workspaceId = "";
let ownerCookie = "";
let ownerEmail = "";
let ownerId = "";

const TEST_PASSWORD = "PasswordResetFlowTest0riginal!";

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      if (!address || typeof address === "string") {
        reject(new Error("Could not resolve a free port for password-reset-flow.test.ts."));
        return;
      }
      const { port } = address;
      probe.close((err) => (err ? reject(err) : resolve(port)));
    });
    probe.on("error", reject);
  });
}

async function waitForHealth(url: string, attempts = 240): Promise<void> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await fetch(`${url}/health`);
      if (res.ok) return;
      lastError = new Error(`/health returned ${res.status}`);
    } catch (err) {
      lastError = err;
    }
    await delay(500);
  }
  const tail = serverOutput.slice(-4000);
  throw new Error(
    `password-reset-flow.test.ts: API did not become healthy in time.\n--- spawned server stdout/stderr tail ---\n${tail}`,
    { cause: lastError }
  );
}

async function ensureWorkspace(): Promise<string> {
  const db = getDb();
  if (!db) throw new Error("requires PERSISTENCE_MODE=database — run via `pnpm run test:db`");
  const [created] = await db
    .insert(workspaces)
    .values({ name: "Password Reset Flow Test", slug: `password-reset-flow-${randomUUID()}` })
    .returning();
  return created!.id;
}

async function ensureUser(role: "Owner", wsId: string): Promise<{ id: string; email: string }> {
  const db = getDb();
  if (!db) throw new Error("requires PERSISTENCE_MODE=database");
  const email = `password-reset-flow-${role.toLowerCase()}-${randomUUID()}@test.iuf.local`;
  const passwordHash = await hashPassword(TEST_PASSWORD);
  const [row] = await db
    .insert(users)
    .values({ email, name: `Test ${role}`, passwordHash, role, workspaceId: wsId, isActive: true })
    .returning();
  return { id: row!.id, email };
}

async function loginAs(email: string): Promise<string> {
  const res = await fetch(`${baseUrl}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: TEST_PASSWORD })
  });
  assert.equal(res.status, 200, `login as ${email} should succeed, got ${res.status}`);
  const setCookie = res.headers.get("set-cookie");
  assert.ok(setCookie, `login as ${email} should set a session cookie`);
  return setCookie!.split(";")[0]!;
}

before(async () => {
  const port = await getFreePort();
  baseUrl = `http://127.0.0.1:${port}`;

  const proc = spawn(process.execPath, ["--import", "tsx", serverEntry], {
    cwd: repoRoot,
    env: {
      ...process.env,
      PORT: String(port),
      HOST: "127.0.0.1",
      NODE_ENV: "test",
      IUF_ALLOW_TEST_SERVER_BOOT: "1",
      SCHEDULER_STARTUP_DELAY_MS: "600000",
      DEFAULT_WORKSPACE_SLUG: `password-reset-flow-${Date.now()}`
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  server = proc;
  proc.stdout?.on("data", (chunk: Buffer) => { serverOutput += chunk.toString(); });
  proc.stderr?.on("data", (chunk: Buffer) => { serverOutput += chunk.toString(); });
  proc.once("exit", (code, signal) => {
    serverOutput += `\n[spawned server exited: code=${code} signal=${signal}]\n`;
  });

  await waitForHealth(baseUrl);

  workspaceId = await ensureWorkspace();
  const owner = await ensureUser("Owner", workspaceId);
  ownerId = owner.id;
  ownerEmail = owner.email;
  ownerCookie = await loginAs(ownerEmail);
});

after(async () => {
  const proc = server;
  if (!proc) return;
  proc.kill();
  await new Promise<void>((resolve) => {
    proc.once("exit", () => resolve());
    setTimeout(resolve, 5_000).unref?.();
  });
});

test("PRF-1: POST /api/v1/auth/request-password-reset returns identical status+body for an existing account vs a non-existent email", async () => {
  const resExisting = await fetch(`${baseUrl}/api/v1/auth/request-password-reset`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: ownerEmail })
  });
  const bodyExisting = await resExisting.json();

  const resBogus = await fetch(`${baseUrl}/api/v1/auth/request-password-reset`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: `nobody-${randomUUID()}@test.iuf.local` })
  });
  const bodyBogus = await resBogus.json();

  assert.equal(resExisting.status, resBogus.status);
  assert.deepEqual(bodyExisting, bodyBogus, "response body must not leak whether the account exists");
  assert.equal(resExisting.status, 200);
  assert.doesNotMatch(
    JSON.stringify(bodyExisting),
    /寄出|已寄送|email.*sent|sent.*email/i,
    "copy must not claim an email was sent — this flow has no mailer"
  );
});

test("PRF-2: full self-service -> admin-generate -> reset-password flow issues a working token, and it invalidates the pre-reset session cookie", async () => {
  const target = await ensureUser("Owner", workspaceId); // any role works; Owner keeps the admin-generate call simple

  // 1. Target logs in and holds a valid session before the reset.
  const preResetCookie = await loginAs(target.email);
  const meBefore = await fetch(`${baseUrl}/auth/me`, { headers: { cookie: preResetCookie } });
  assert.equal(meBefore.status, 200, "session must be valid before the reset");

  // 2. Target self-submits a reset request.
  const reqRes = await fetch(`${baseUrl}/api/v1/auth/request-password-reset`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: target.email })
  });
  assert.equal(reqRes.status, 200);

  // 3. Admin (owner) sees it in the pending queue and generates a link.
  const listRes = await fetch(`${baseUrl}/api/v1/admin/password-reset-requests`, {
    headers: { cookie: ownerCookie }
  });
  assert.equal(listRes.status, 200);
  const listBody = await listRes.json();
  const pendingRow = (listBody.data as Array<{ id: string; email: string }>).find((r) => r.email === target.email);
  assert.ok(pendingRow, "target's request must appear in the pending admin queue");

  const genRes = await fetch(`${baseUrl}/api/v1/admin/password-reset-requests/${pendingRow!.id}/generate-link`, {
    method: "POST",
    headers: { cookie: ownerCookie }
  });
  assert.equal(genRes.status, 201);
  const genBody = await genRes.json();
  const token = genBody.data.token as string;
  assert.ok(token && token.length > 20);

  // 4. Target resets the password with the token.
  const resetRes = await fetch(`${baseUrl}/api/v1/auth/reset-password`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token, newPassword: "BrandNewFlowPassw0rd777!" })
  });
  assert.equal(resetRes.status, 200);

  // 5. The pre-reset cookie must now be rejected by the real auth middleware.
  const meAfter = await fetch(`${baseUrl}/auth/me`, { headers: { cookie: preResetCookie } });
  assert.equal(meAfter.status, 401, "session cookie issued before the reset must be invalidated");

  // 6. Logging in with the NEW password must work.
  const reloginRes = await fetch(`${baseUrl}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: target.email, password: "BrandNewFlowPassw0rd777!" })
  });
  assert.equal(reloginRes.status, 200, "new password must actually work for login");

  // 7. The old password must no longer work.
  const oldLoginRes = await fetch(`${baseUrl}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: target.email, password: TEST_PASSWORD })
  });
  assert.equal(oldLoginRes.status, 401, "old password must be rejected after reset");
});

test("PRF-3: POST /api/v1/auth/reset-password rejects a garbage token with the same error code as any other invalid state", async () => {
  const res = await fetch(`${baseUrl}/api/v1/auth/reset-password`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: "not-a-real-token", newPassword: "SomeValidPassw0rd888!" })
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error, "invalid_or_expired");
});

test("PRF-4: non-admin roles cannot list or resolve the password-reset admin queue", async () => {
  const viewer = await ensureUser("Owner", workspaceId); // reuse helper; downgrade role directly for this test
  const db = getDb();
  assert.ok(db);
  await db.update(users).set({ role: "Viewer" }).where(eq(users.id, viewer.id));
  const viewerCookie = await loginAs(viewer.email);

  const listRes = await fetch(`${baseUrl}/api/v1/admin/password-reset-requests`, {
    headers: { cookie: viewerCookie }
  });
  assert.equal(listRes.status, 403);

  const genRes = await fetch(`${baseUrl}/api/v1/admin/password-reset-requests/${randomUUID()}/generate-link`, {
    method: "POST",
    headers: { cookie: viewerCookie }
  });
  assert.equal(genRes.status, 403);
});
