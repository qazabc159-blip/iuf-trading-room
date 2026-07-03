// Permission matrix v1 — PR-A test skeleton (2026-07-04).
//
// Design: reports/permission_matrix/PERMISSION_MATRIX_v1.md §3.
// "矩陣測試一旦綠、後續任何 PR 弄破=CI 紅" — this file is meant to grow one
// row per endpoint group as PR-B / PR-B2 / PR-C / PR-D land, each adding the
// rows for the group it migrates.
//
// IMPORTANT — PR-A pins CURRENT (2026-07-04) behavior, not target behavior.
// server.ts is not touched by PR-A (see require-min-role.ts header). Some of
// the expectations below are the *known-wrong* status quo that later PRs are
// meant to fix (e.g. Trader/Viewer 403 on pure market-data reads that D3
// says should be Viewer-readable). Do not "fix" an assertion here without
// also shipping the matching server.ts change in its owning PR — that would
// silently turn this regression net into a false record.
//
// How role is selected: this suite runs the real API in memory mode
// (no DATABASE_URL / PERSISTENCE_MODE=database), where the auth middleware
// (server.ts ~ line 388-401) takes an `x-user-role` header directly as the
// session role with no login required. This is the lightest current path to
// exercise all 5 roles; it is distinct from the AUTH_ALLOW_ROLE_OVERRIDE
// database-mode override (server.ts:416-426), which requires a real Owner
// login and only applies in database mode.

import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import net from "node:net";
import path from "node:path";
import test, { after, before, describe } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { ROLES_BY_RANK, type Role } from "./require-min-role.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..", "..", "..");
const serverEntry = path.join(repoRoot, "apps", "api", "src", "server.ts");

let baseUrl = "";
let server: ChildProcess | undefined;

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      if (!address || typeof address === "string") {
        reject(new Error("Could not resolve a free port for role-matrix.test.ts."));
        return;
      }
      const { port } = address;
      probe.close((err) => (err ? reject(err) : resolve(port)));
    });
    probe.on("error", reject);
  });
}

async function waitForHealth(url: string, attempts = 60): Promise<void> {
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
  throw lastError instanceof Error
    ? lastError
    : new Error("role-matrix.test.ts: API did not become healthy in time.");
}

async function requestAs(
  role: Role,
  method: "GET" | "POST",
  routePath: string
): Promise<Response> {
  return fetch(`${baseUrl}${routePath}`, {
    method,
    headers: {
      "content-type": "application/json",
      "x-user-role": role
    }
  });
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
        // Overrides the NODE_ENV==="test" boot guard (server.ts ~line 22187)
        // so this suite gets a real listening server. Memory mode stays on
        // (no DATABASE_URL / PERSISTENCE_MODE=database set here), same as
        // `pnpm test` and `pnpm smoke` already run in CI.
        IUF_ALLOW_TEST_SERVER_BOOT: "1",
        DEFAULT_WORKSPACE_SLUG: `role-matrix-${Date.now()}`
      },
      stdio: ["ignore", "pipe", "pipe"]
    }
  );
  server = proc;

  proc.stdout?.on("data", () => {});
  proc.stderr?.on("data", () => {});

  await waitForHealth(baseUrl);
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

interface MatrixCase {
  group: string;
  method: "GET" | "POST";
  path: string;
  /** Expected HTTP status per role, pinned to current (2026-07-04) server.ts behavior. */
  expected: Record<Role, number>;
  note: string;
}

// 4 representative endpoints spanning the current gate shapes described in
// PERMISSION_MATRIX_v1.md §3 D3. One row per case; add more rows here as
// later PRs migrate additional endpoint groups onto requireMinRole.
const CASES: MatrixCase[] = [
  {
    group: "no-gate (the ~56% 'login-only' bucket, PR-B2 territory)",
    method: "GET",
    path: "/api/v1/session",
    expected: { Owner: 200, Admin: 200, Analyst: 200, Trader: 200, Viewer: 200 },
    note: "GET /api/v1/session has no role check today (server.ts:785) — every role passes."
  },
  {
    group: "G-RESEARCH — READ_DRAFT_ROLES (server.ts:3978)",
    method: "GET",
    path: "/api/v1/content-drafts",
    expected: { Owner: 200, Admin: 200, Analyst: 200, Trader: 403, Viewer: 403 },
    note: "current gate = Owner/Admin/Analyst; D3 keeps this group at Analyst — PR-A does not change it."
  },
  {
    group: "G-REVIEW — REVIEW_ROLES (server.ts:3996)",
    method: "POST",
    path: "/api/v1/content-drafts/role-matrix-nonexistent-draft/approve",
    // Role check runs before the draft lookup, so a deliberately-missing
    // draftId still proves the gate: Owner/Admin get past the role check
    // and hit the memory-mode short-circuit (database_mode_required -> 409);
    // Analyst/Trader/Viewer never get that far (403).
    expected: { Owner: 409, Admin: 409, Analyst: 403, Trader: 403, Viewer: 403 },
    note: "current gate = Owner/Admin only; 409 (not 404) because this suite runs in memory mode."
  },
  {
    group: "G-OWNER — Owner-only (server.ts:1831 themes/index)",
    method: "GET",
    path: "/api/v1/themes/index",
    expected: { Owner: 200, Admin: 403, Analyst: 403, Trader: 403, Viewer: 403 },
    note: "current gate = Owner only; representative of the real-money / ops-core group."
  },

  // ── PR-B (2026-07-04): G-PUB READ_DRAFT_ROLES downgrade ──────────────────
  // Design: reports/permission_matrix/PERMISSION_MATRIX_v1.md §4 PR-B row.
  // Classification evidence: reports/permission_matrix/PR_B_CLASSIFICATION_2026_07_04.md
  //
  // Under-grant direction: G-PUB representative endpoints that were previously
  // gated Owner/Admin/Analyst-only now pass every role, including Viewer/Trader.
  // Both endpoints below are deterministic in memory mode (no DB, no network
  // fan-out) so this suite stays fast and non-flaky.
  {
    group: "G-PUB — downgraded to login-only (server.ts /api/v1/quotes)",
    method: "GET",
    path: "/api/v1/quotes",
    expected: { Owner: 200, Admin: 200, Analyst: 200, Trader: 200, Viewer: 200 },
    note: "PR-B: pure quote data (KGI channel blocked -> static empty stub); READ_DRAFT_ROLES check removed."
  },
  {
    group: "G-PUB — downgraded to login-only (server.ts /api/v1/announcements)",
    method: "GET",
    path: "/api/v1/announcements",
    expected: { Owner: 200, Admin: 200, Analyst: 200, Trader: 200, Viewer: 200 },
    note: "PR-B: official market announcements + FinMind news fallback; READ_DRAFT_ROLES check removed."
  }
];

// ── PR-B over-grant guard: the 3 pre-classified exemptions stay Analyst+ ───
// (briefs/:id auditChain, dashboard/snapshot audit_stats+lab_strategies fan-out,
// paper/e2e kill-switch/execution flags). These must NOT be reachable by
// Viewer/Trader even after the G-PUB downgrade above.
interface ExemptCase {
  name: string;
  method: "GET" | "POST";
  path: string;
  /** Only asserted for roles below the gate — Owner/Admin/Analyst status varies
   *  by memory-mode DB availability and is not the point of this guard. */
  deniedRoles: readonly Role[];
}

const EXEMPT_CASES: ExemptCase[] = [
  {
    name: "briefs/:id (auditChain — Analyst+ exemption)",
    method: "GET",
    path: "/api/v1/briefs/role-matrix-nonexistent-brief",
    deniedRoles: ["Viewer", "Trader"]
  },
  {
    name: "dashboard/snapshot (audit_stats + lab_strategies fan-out — Analyst+ exemption)",
    method: "GET",
    path: "/api/v1/dashboard/snapshot",
    deniedRoles: ["Viewer", "Trader"]
  },
  {
    name: "paper/e2e (kill-switch / execution flags — Analyst+ exemption)",
    method: "GET",
    path: "/api/v1/paper/e2e",
    deniedRoles: ["Viewer", "Trader"]
  }
];

describe("role-matrix (PR-A skeleton — pins CURRENT server.ts behavior)", () => {
  for (const testCase of CASES) {
    for (const role of ROLES_BY_RANK) {
      const expectedStatus = testCase.expected[role];
      test(`${testCase.group} :: ${testCase.method} ${testCase.path} :: ${role} -> ${expectedStatus}`, async () => {
        const res = await requestAs(role, testCase.method, testCase.path);
        assert.equal(
          res.status,
          expectedStatus,
          `${testCase.note}\nExpected ${role} -> ${expectedStatus}, got ${res.status}`
        );
        await res.text().catch(() => undefined);
      });
    }
  }
});

describe("role-matrix PR-B — over-grant guard on the 3 pre-classified exemptions", () => {
  for (const exemptCase of EXEMPT_CASES) {
    for (const role of exemptCase.deniedRoles) {
      test(`${exemptCase.name} :: ${exemptCase.method} ${exemptCase.path} :: ${role} -> 403`, async () => {
        const res = await requestAs(role, exemptCase.method, exemptCase.path);
        assert.equal(
          res.status,
          403,
          `PR-B exemption must stay Analyst+: ${role} should still get 403 on ${exemptCase.path}, got ${res.status}`
        );
        await res.text().catch(() => undefined);
      });
    }
  }
});
