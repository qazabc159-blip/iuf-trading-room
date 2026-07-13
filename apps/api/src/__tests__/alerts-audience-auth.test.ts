// alerts-audience-auth.test.ts — #1224 P1-2 route-level regression lock
// (Pete review 🟡, 2026-07-11): the alerts feed's role-based audience gate
// (`GET /api/v1/alerts` silently downgrades `?audience=ops_internal|all`
// back to `actionable_market` for any non-Owner session; `GET
// /api/v1/notifications`'s unread badge excludes ops_internal iuf_events)
// had zero route-level coverage anywhere in the repo — only the pure
// `ruleAudience()` classifier was tested (openalice-event-rule-engine.test.ts).
//
// This is a genuine HTTP-boundary test: spawns the real server as a child
// process (same harness pattern as apps/api/src/auth/role-matrix.test.ts) and
// drives it over real fetch() calls, so the exact `session.user.role !==
// "Owner"` check in server.ts's GET /api/v1/alerts handler is what's under
// test — not a re-implementation of that check in the test file.
//
// Runs in DB mode (real Postgres), not memory mode, for two reasons the
// memory-mode role-matrix.test.ts harness can't cover:
//   1. `listEvents()` short-circuits to `[]` when `isDatabaseMode()` is
//      false, so the "does the ops_internal event actually leak" assertion
//      needs real iuf_events rows.
//   2. Distinguishing real per-user roles (Owner/Admin/Analyst/Viewer) needs
//      real DB users + real /auth/login sessions — the memory-mode
//      `x-user-role` header shortcut doesn't exercise the DB-mode auth
//      middleware branch this route actually runs under in production.
//
// Wired into `pnpm run test:db` (package.json), not `pnpm test` — same lane
// as idempotency-race.test.ts / paper-executor.test.ts / strategy-ideas.test.ts.

import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import net from "node:net";
import path from "node:path";
import test, { after, before, describe } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { eq, sql as drizzleSql } from "drizzle-orm";
import { getDb, users, workspaces } from "@iuf-trading-room/db";

import { hashPassword } from "../auth-store.js";
import { _eventEngineInternals } from "../openalice-event-rule-engine.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..", "..", "..");
const serverEntry = path.join(repoRoot, "apps", "api", "src", "server.ts");

type Role = "Owner" | "Admin" | "Analyst" | "Trader" | "Viewer";

const TEST_PASSWORD = "alerts-audience-auth-test-pw-1224";
// R01/R13 are the exact rule ids openalice-event-rule-engine.test.ts already
// pins as actionable_market / ops_internal respectively (see "ruleAudience:"
// tests there) — reusing them keeps this file's assumptions in sync with that
// classification instead of inventing a parallel set of "believed" rule ids.
const ACTIONABLE_RULE_ID = "R01_REVENUE_SURGE_YOY50";
const OPS_INTERNAL_RULE_ID = "R13_DAILY_SMOKE_FAILED";

let baseUrl = "";
let server: ChildProcess | undefined;
let serverOutput = "";
let ownerCookie = "";
let adminCookie = "";
let analystCookie = "";
let viewerCookie = "";
let secondaryOwnerCookie = "";
let primaryWorkspaceId = "";
let secondaryWorkspaceId = "";

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      if (!address || typeof address === "string") {
        reject(new Error("Could not resolve a free port for alerts-audience-auth.test.ts."));
        return;
      }
      const { port } = address;
      probe.close((err) => (err ? reject(err) : resolve(port)));
    });
    probe.on("error", reject);
  });
}

// 240 attempts * 500ms = 120s. role-matrix.test.ts (memory mode, no DB round
// trips at boot, runs on the warm self-hosted "validate" runner) gets away
// with 60 attempts/30s. This file boots the same server.ts via tsx but in DB
// mode on the GH-hosted ubuntu-latest "db-tests" runner — a real CI run
// (2026-07-11, PR #1228) timed out at exactly the old 30s budget
// (`hookFailed`/`fetch failed`, duration_ms: 30132) purely from cold
// tsx-transpile + DB-mode boot latency, before the server ever became
// reachable — not a server or #1224 bug. Widened with margin; the job's own
// timeout-minutes is 15, so this budget cannot itself cause a slow suite to
// look "hung" from the outside.
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
  // Include the spawned server's own stdout/stderr tail so a boot failure is
  // diagnosable from CI logs alone — role-matrix.test.ts's harness (which
  // this was based on) silently swallows both streams, which made a real
  // boot-failure investigation (2026-07-12, PR #1228) impossible from the CI
  // log alone.
  const tail = serverOutput.slice(-4000);
  const base =
    lastError instanceof Error
      ? lastError.message
      : "alerts-audience-auth.test.ts: API did not become healthy in time.";
  throw new Error(`${base}\n--- spawned server stdout/stderr tail ---\n${tail}`);
}

/** Idempotent: upserts a workspace + one user per role directly through the DB. */
async function ensureWorkspace(): Promise<string> {
  const db = getDb();
  if (!db) {
    throw new Error(
      "alerts-audience-auth.test.ts requires PERSISTENCE_MODE=database + DATABASE_URL — run via `pnpm run test:db`, not `pnpm test`."
    );
  }
  const [existing] = await db.select().from(workspaces).limit(1);
  if (existing) return existing.id;
  const [created] = await db
    .insert(workspaces)
    .values({ name: "Alerts Audience Auth Test", slug: `alerts-audience-auth-${randomUUID()}` })
    .returning();
  return created!.id;
}

async function ensureTestUser(role: Role, workspaceId: string, tenant = "primary"): Promise<string> {
  const db = getDb();
  if (!db) throw new Error("ensureTestUser requires PERSISTENCE_MODE=database.");
  const email = `alerts-audience-auth-${tenant}-${role.toLowerCase()}@test.iuf.local`;
  const passwordHash = await hashPassword(TEST_PASSWORD);
  const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (existing) {
    await db.update(users).set({ passwordHash, role, workspaceId, isActive: true }).where(eq(users.id, existing.id));
  } else {
    await db.insert(users).values({ email, name: `Test ${role}`, passwordHash, role, workspaceId });
  }
  return email;
}

async function loginAs(email: string): Promise<string> {
  const res = await fetch(`${baseUrl}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: TEST_PASSWORD })
  });
  assert.equal(res.status, 200, `login as ${email} should succeed, got ${res.status}: ${await res.text().catch(() => "")}`);
  const setCookie = res.headers.get("set-cookie");
  assert.ok(setCookie, `login as ${email} should set a session cookie`);
  return setCookie!.split(";")[0]!;
}

/** Directly inserts an iuf_events row, mirroring writeEvent()'s INSERT shape. Returns the row id. */
async function seedEvent(
  ruleId: string,
  ruleName: string,
  ticker: string | null,
  marker: string,
  workspaceId = primaryWorkspaceId,
): Promise<string> {
  const db = getDb();
  if (!db) throw new Error("seedEvent requires PERSISTENCE_MODE=database.");
  const id = randomUUID();
  await db.execute(
    drizzleSql`
      INSERT INTO iuf_events (id, workspace_id, rule_id, rule_name, severity, ticker, payload, triggered_at, acknowledged)
      VALUES (${id}, ${workspaceId}, ${ruleId}, ${ruleName}, 'info', ${ticker}, ${JSON.stringify({ testMarker: marker })}::jsonb, NOW(), false)
    `
  );
  return id;
}

/**
 * Acknowledges every currently-unacknowledged iuf_events row. Used to give
 * the badge test a deterministic starting point regardless of how many
 * unread events the earlier audience-gate tests in this file left behind —
 * a "before/after delta" assertion against a table other tests in the same
 * file also write to is otherwise fragile to declaration-order coupling.
 */
async function acknowledgeAllPendingEvents(): Promise<void> {
  const db = getDb();
  if (!db) throw new Error("acknowledgeAllPendingEvents requires PERSISTENCE_MODE=database.");
  await db.execute(drizzleSql`UPDATE iuf_events SET acknowledged = true WHERE workspace_id = ${primaryWorkspaceId} AND acknowledged = false`);
}

async function getJson(pathAndQuery: string, cookie?: string): Promise<{ status: number; body: any }> {
  const res = await fetch(`${baseUrl}${pathAndQuery}`, {
    headers: cookie ? { cookie } : {}
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

before(async () => {
  const port = await getFreePort();
  baseUrl = `http://127.0.0.1:${port}`;

  const proc = spawn(
    process.execPath,
    ["--import", "tsx", serverEntry],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        PORT: String(port),
        HOST: "127.0.0.1",
        NODE_ENV: "test",
        IUF_ALLOW_TEST_SERVER_BOOT: "1",
        // Keeps the real event-rule-engine cron / event-seed timers from
        // firing (and writing unrelated iuf_events rows) during this file's
        // short run — 600000ms is the hard cap getSchedulerStartupDelayMs()
        // clamps to, comfortably longer than this suite's runtime.
        SCHEDULER_STARTUP_DELAY_MS: "600000",
        DEFAULT_WORKSPACE_SLUG: `alerts-audience-auth-${Date.now()}`
      },
      stdio: ["ignore", "pipe", "pipe"]
    }
  );
  server = proc;
  proc.stdout?.on("data", (chunk: Buffer) => {
    serverOutput += chunk.toString();
  });
  proc.stderr?.on("data", (chunk: Buffer) => {
    serverOutput += chunk.toString();
  });
  proc.once("exit", (code, signal) => {
    serverOutput += `\n[spawned server exited: code=${code} signal=${signal}]\n`;
  });

  await waitForHealth(baseUrl);

  primaryWorkspaceId = await ensureWorkspace();
  const db = getDb();
  if (!db) throw new Error("database unavailable while creating secondary workspace");
  const [secondaryWorkspace] = await db
    .insert(workspaces)
    .values({ name: "Alerts Tenant B", slug: `alerts-tenant-b-${randomUUID()}` })
    .returning();
  secondaryWorkspaceId = secondaryWorkspace!.id;
  const [ownerEmail, adminEmail, analystEmail, viewerEmail] = await Promise.all([
    ensureTestUser("Owner", primaryWorkspaceId),
    ensureTestUser("Admin", primaryWorkspaceId),
    ensureTestUser("Analyst", primaryWorkspaceId),
    ensureTestUser("Viewer", primaryWorkspaceId)
  ]);
  const secondaryOwnerEmail = await ensureTestUser("Owner", secondaryWorkspaceId, "secondary");

  ownerCookie = await loginAs(ownerEmail);
  adminCookie = await loginAs(adminEmail);
  analystCookie = await loginAs(analystEmail);
  viewerCookie = await loginAs(viewerEmail);
  secondaryOwnerCookie = await loginAs(secondaryOwnerEmail);
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

describe("GET /api/v1/alerts — audience gate (#1224 P1-2)", () => {
  test("unauthenticated (no session cookie) is rejected, not silently downgraded", async () => {
    const res = await getJson("/api/v1/alerts?audience=all&limit=200");
    assert.equal(res.status, 401, `expected 401 unauthenticated, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.equal(res.body.error, "unauthenticated");
  });

  test("Owner + ?audience=all sees both actionable_market and ops_internal events", async () => {
    const actionableId = await seedEvent(ACTIONABLE_RULE_ID, "月營收大幅成長", "9999", "owner-all-actionable");
    const opsId = await seedEvent(OPS_INTERNAL_RULE_ID, "每日健康檢查失敗", null, "owner-all-ops");

    const res = await getJson("/api/v1/alerts?audience=all&limit=200", ownerCookie);
    assert.equal(res.status, 200);
    assert.equal(res.body.meta.audience, "all", "Owner's explicit ?audience=all must not be downgraded");

    const ids: string[] = (res.body.data as Array<{ id: string }>).map((e) => e.id);
    assert.ok(ids.includes(actionableId), "Owner audience=all must include the actionable_market event");
    assert.ok(ids.includes(opsId), "Owner audience=all must include the ops_internal event");
  });

  test("Owner with no ?audience param still defaults to actionable_market only", async () => {
    const opsId = await seedEvent(OPS_INTERNAL_RULE_ID, "每日健康檢查失敗", null, "owner-default-ops");

    const res = await getJson("/api/v1/alerts?limit=200", ownerCookie);
    assert.equal(res.status, 200);
    assert.equal(res.body.meta.audience, "actionable_market", "default (no audience param) must be actionable_market even for Owner");

    const ids: string[] = (res.body.data as Array<{ id: string }>).map((e) => e.id);
    assert.ok(!ids.includes(opsId), "default response must not include an ops_internal event, even for Owner");
  });

  for (const [roleName, cookieGetter] of [
    ["Admin", () => adminCookie],
    ["Analyst", () => analystCookie],
    ["Viewer", () => viewerCookie]
  ] as const) {
    test(`${roleName} + ?audience=all is silently downgraded — zero ops_internal leakage by id`, async () => {
      const actionableId = await seedEvent(ACTIONABLE_RULE_ID, "月營收大幅成長", "9999", `${roleName}-all-actionable`);
      const opsId = await seedEvent(OPS_INTERNAL_RULE_ID, "每日健康檢查失敗", null, `${roleName}-all-ops`);

      const res = await getJson("/api/v1/alerts?audience=all&limit=200", cookieGetter());
      assert.equal(res.status, 200);
      assert.equal(
        res.body.meta.audience,
        "actionable_market",
        `${roleName} requesting ?audience=all must be silently downgraded to actionable_market`
      );

      const ids: string[] = (res.body.data as Array<{ id: string }>).map((e) => e.id);
      assert.ok(
        !ids.includes(opsId),
        `${roleName} must NOT see the ops_internal event (id=${opsId}) even when explicitly requesting ?audience=all`
      );
      assert.ok(
        ids.includes(actionableId),
        `${roleName} must still see the actionable_market event (id=${actionableId}) in the downgraded response`
      );
    });
  }
});

describe("GET /api/v1/notifications — unread badge excludes ops_internal (#1224 P1-2)", () => {
  test("non-Owner is rejected (existing OWNER_ONLY guarantee — sanity check for the badge scope below)", async () => {
    const res = await getJson("/api/v1/notifications", adminCookie);
    assert.equal(res.status, 403);
    assert.equal(res.body.error, "OWNER_ONLY");
  });

  test("unread_count increases by exactly 1 when one actionable_market + one ops_internal unread event are added", async () => {
    // Deterministic starting point — the audience-gate tests above already
    // left several of their own unacknowledged events behind in the shared
    // iuf_events table (by design: they assert on GET /api/v1/alerts
    // content, not read state). Clearing them first means this test's delta
    // assertion isn't coupled to how many rows those tests happened to
    // create/leave unread.
    await acknowledgeAllPendingEvents();

    const before = await getJson("/api/v1/notifications", ownerCookie);
    assert.equal(before.status, 200);
    const baselineUnread = before.body.unread_count as number;

    const opsId = await seedEvent(OPS_INTERNAL_RULE_ID, "每日健康檢查失敗", null, "badge-ops");
    const actionableId = await seedEvent(ACTIONABLE_RULE_ID, "月營收大幅成長", "9999", "badge-actionable");

    const after = await getJson("/api/v1/notifications", ownerCookie);
    assert.equal(after.status, 200);
    const newUnread = after.body.unread_count as number;

    assert.equal(
      newUnread,
      baselineUnread + 1,
      `unread_count should rise by exactly 1 (only the actionable_market event, id=${actionableId}) — ` +
        `the ops_internal event (id=${opsId}) must not inflate the badge`
    );

    // Commit message: "the drawer list (already Owner-only) but the unread
    // badge no longer counts ops_internal" — i.e. the drawer still SHOWS the
    // ops_internal event, only the count excludes it.
    const drawerIds: string[] = (after.body.notifications as Array<{ id: string }>).map((n) => n.id);
    assert.ok(drawerIds.includes(`event-${actionableId}`), "actionable event should appear in the drawer list");
    assert.ok(drawerIds.includes(`event-${opsId}`), "ops_internal event should still appear in the drawer list (Owner-only surface), just not counted");
  });
});

describe("iuf_events workspace boundary", () => {
  test("list, raw diagnostics, notifications, and ack never cross workspaces", async () => {
    const primaryId = await seedEvent(ACTIONABLE_RULE_ID, "租戶 A 事件", "1111", "tenant-a");
    assert.equal(
      await _eventEngineInternals.isDuplicateEvent(primaryWorkspaceId, ACTIONABLE_RULE_ID, "1111"),
      true,
      "workspace A should dedupe its own matching event",
    );
    assert.equal(
      await _eventEngineInternals.isDuplicateEvent(secondaryWorkspaceId, ACTIONABLE_RULE_ID, "1111"),
      false,
      "workspace A event must not throttle workspace B",
    );
    const secondaryId = await seedEvent(
      ACTIONABLE_RULE_ID,
      "租戶 B 事件",
      "1111",
      "tenant-b",
      secondaryWorkspaceId,
    );

    const primaryAlerts = await getJson("/api/v1/alerts?audience=all&limit=200", ownerCookie);
    const primaryAlertIds = (primaryAlerts.body.data as Array<{ id: string }>).map((event) => event.id);
    assert.ok(primaryAlertIds.includes(primaryId));
    assert.ok(!primaryAlertIds.includes(secondaryId), "workspace A alerts must exclude workspace B");

    const secondaryAlerts = await getJson("/api/v1/alerts?audience=all&limit=200", secondaryOwnerCookie);
    const secondaryAlertIds = (secondaryAlerts.body.data as Array<{ id: string }>).map((event) => event.id);
    assert.ok(secondaryAlertIds.includes(secondaryId));
    assert.ok(!secondaryAlertIds.includes(primaryId), "workspace B alerts must exclude workspace A");

    const primaryRaw = await getJson("/api/v1/iuf-events?limit=200", ownerCookie);
    const primaryRawIds = (primaryRaw.body.data as Array<{ id: string }>).map((event) => event.id);
    assert.ok(!primaryRawIds.includes(secondaryId), "raw diagnostics must remain workspace-scoped");

    const primaryNotifications = await getJson("/api/v1/notifications", ownerCookie);
    const primaryNotificationIds = (primaryNotifications.body.notifications as Array<{ id: string }>).map((item) => item.id);
    assert.ok(!primaryNotificationIds.includes(`event-${secondaryId}`), "notification drawer must exclude workspace B");

    const ack = await fetch(`${baseUrl}/api/v1/alerts/${secondaryId}/ack`, {
      method: "POST",
      headers: { cookie: ownerCookie },
    });
    assert.equal(ack.status, 404, "workspace A must not acknowledge workspace B event ids");

    const secondaryAfterAck = await getJson("/api/v1/alerts?audience=all&limit=200", secondaryOwnerCookie);
    const secondaryEvent = (secondaryAfterAck.body.data as Array<{ id: string; acknowledged: boolean }>).find(
      (event) => event.id === secondaryId,
    );
    assert.equal(secondaryEvent?.acknowledged, false, "failed cross-workspace ack must not mutate workspace B");
  });
});
