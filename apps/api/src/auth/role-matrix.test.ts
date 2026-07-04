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

import { ROLE_RANK, ROLES_BY_RANK, type Role } from "./require-min-role.js";

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

type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

async function requestAs(
  role: Role,
  method: HttpMethod,
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
  },
  {
    group: "G-PUB — downgraded to login-only (server.ts /api/v1/briefs/search)",
    method: "GET",
    path: "/api/v1/briefs/search?q=role-matrix-probe",
    // Memory mode has no DB, so the handler 503s at its database_unavailable
    // guard — for EVERY role. The point of this row is the Viewer/Trader
    // column: 503 (not 403) proves the READ_DRAFT_ROLES gate is gone and low
    // roles reach the handler body. The published-only content guarantee is
    // pinned by the source-scan test below (the SQL is unreachable in memory mode).
    expected: { Owner: 503, Admin: 503, Analyst: 503, Trader: 503, Viewer: 503 },
    note: "PR-B: role gate removed; memory mode short-circuits at database_unavailable for all roles."
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

// PR-B2 (2026-07-04) — login-only sweep gate verification.
//
// Design: reports/permission_matrix/PERMISSION_MATRIX_v1.md §4 PR-B2 row.
// These 51 cases correspond 1:1 to every endpoint gated in this PR (see
// reports/permission_matrix/PR_B2_LOGIN_ONLY_SWEEP_2026_07_04.md for the full
// per-endpoint group/action/reason breakdown covering all ~196 login-only
// candidates, not just these 51).
//
// Each case only asserts the boundary the gate itself is responsible for:
//   - every role ranked BELOW minRole must get exactly 403 (forbidden_role) —
//     requireMinRole() is the first statement in each handler body, so no
//     downstream body-parsing / DB lookup ever runs first for a blocked role.
//   - every role ranked AT-OR-ABOVE minRole must NOT get 403 — whatever
//     status downstream logic then produces (200/201/400/404/409/500,
//     depending on memory-mode state, a deliberately-empty body, or the
//     `role-matrix-x` placeholder used in place of a real :id/:ideaId param)
//     is out of scope here; only the permission boundary is pinned.
// Path params use the literal placeholder "role-matrix-x" — same pattern as
// the G-REVIEW case above (role check runs before any param/DB lookup).
interface GateOnlyCase {
  group: string;
  method: HttpMethod;
  path: string;
  minRole: Role;
}

const GATE_CASES: GateOnlyCase[] = [
  { group: "G-ADMIN-ish", method: "GET", path: "/api/v1/audit-logs/summary", minRole: "Admin" },
  { group: "G-ADMIN-ish", method: "GET", path: "/api/v1/audit-logs/export", minRole: "Admin" },
  { group: "G-ADMIN-ish", method: "GET", path: "/api/v1/audit-logs", minRole: "Admin" },
  { group: "G-ADMIN-ish", method: "GET", path: "/api/v1/event-history", minRole: "Admin" },
  { group: "G-ADMIN-ish", method: "GET", path: "/api/v1/event-history/summary", minRole: "Admin" },
  { group: "G-ADMIN-ish", method: "GET", path: "/api/v1/event-history/export", minRole: "Admin" },
  { group: "G-ADMIN-ish", method: "GET", path: "/api/v1/ops/snapshot", minRole: "Admin" },
  { group: "G-ADMIN-ish", method: "GET", path: "/api/v1/ops/trends", minRole: "Admin" },
  { group: "G-ADMIN-ish", method: "POST", path: "/api/v1/market-data/manual-quotes", minRole: "Admin" },
  { group: "G-ADMIN-ish", method: "POST", path: "/api/v1/market-data/paper-quotes", minRole: "Admin" },
  { group: "G-PORT", method: "POST", path: "/api/v1/risk/limits", minRole: "Trader" },
  { group: "G-ADMIN-ish", method: "POST", path: "/api/v1/risk/kill-switch", minRole: "Admin" },
  { group: "G-PORT", method: "POST", path: "/api/v1/risk/checks", minRole: "Trader" },
  { group: "G-PORT", method: "POST", path: "/api/v1/risk/strategy-limits", minRole: "Trader" },
  { group: "G-PORT", method: "DELETE", path: "/api/v1/risk/strategy-limits", minRole: "Trader" },
  { group: "G-PORT", method: "POST", path: "/api/v1/risk/symbol-limits", minRole: "Trader" },
  { group: "G-PORT", method: "DELETE", path: "/api/v1/risk/symbol-limits", minRole: "Trader" },
  { group: "G-PORT", method: "POST", path: "/api/v1/trading/orders", minRole: "Trader" },
  { group: "G-PORT", method: "POST", path: "/api/v1/trading/orders/cancel", minRole: "Trader" },
  { group: "G-RESEARCH", method: "GET", path: "/api/v1/companies/duplicates", minRole: "Analyst" },
  { group: "G-RESEARCH", method: "GET", path: "/api/v1/companies/merge-preview", minRole: "Analyst" },
  { group: "G-ADMIN-ish", method: "POST", path: "/api/v1/companies/merge", minRole: "Admin" },
  { group: "G-RESEARCH", method: "POST", path: "/api/v1/themes", minRole: "Analyst" },
  { group: "G-RESEARCH", method: "PATCH", path: "/api/v1/themes/role-matrix-x", minRole: "Analyst" },
  { group: "G-RESEARCH", method: "POST", path: "/api/v1/companies", minRole: "Analyst" },
  { group: "G-RESEARCH", method: "PUT", path: "/api/v1/companies/role-matrix-x/relations", minRole: "Analyst" },
  { group: "G-RESEARCH", method: "PUT", path: "/api/v1/companies/role-matrix-x/keywords", minRole: "Analyst" },
  { group: "G-RESEARCH", method: "PATCH", path: "/api/v1/companies/role-matrix-x", minRole: "Analyst" },
  { group: "G-PORT", method: "POST", path: "/api/v1/strategy/ideas/role-matrix-x/promote-to-paper-submit", minRole: "Trader" },
  { group: "G-RESEARCH", method: "POST", path: "/api/v1/strategy/runs", minRole: "Analyst" },
  { group: "G-PORT", method: "POST", path: "/api/v1/strategy/runs/role-matrix-x/confirm-token", minRole: "Trader" },
  { group: "G-PORT", method: "POST", path: "/api/v1/strategy/runs/role-matrix-x/execute", minRole: "Trader" },
  { group: "G-RESEARCH", method: "POST", path: "/api/v1/signals", minRole: "Analyst" },
  { group: "G-RESEARCH", method: "PATCH", path: "/api/v1/signals/role-matrix-x", minRole: "Analyst" },
  { group: "G-PORT", method: "POST", path: "/api/v1/plans", minRole: "Trader" },
  { group: "G-PORT", method: "PATCH", path: "/api/v1/plans/role-matrix-x", minRole: "Trader" },
  { group: "G-PORT", method: "POST", path: "/api/v1/reviews", minRole: "Trader" },
  { group: "G-RESEARCH", method: "POST", path: "/api/v1/briefs", minRole: "Analyst" },
  { group: "G-ADMIN-ish", method: "POST", path: "/api/v1/import/my-tw-coverage", minRole: "Admin" },
  { group: "G-PORT", method: "POST", path: "/api/v1/kgi/quote/subscribe", minRole: "Trader" },
  { group: "G-PORT", method: "POST", path: "/api/v1/kgi/quote/subscribe/kbar", minRole: "Trader" },
  { group: "G-PORT", method: "POST", path: "/api/v1/paper/orders", minRole: "Trader" },
  { group: "G-PORT", method: "POST", path: "/api/v1/paper/orders/role-matrix-x/cancel", minRole: "Trader" },
  { group: "G-ADMIN-ish", method: "POST", path: "/api/v1/portfolio/kill-mode", minRole: "Admin" },
  { group: "G-PORT", method: "POST", path: "/api/v1/paper/submit", minRole: "Trader" },
  { group: "G-RESEARCH", method: "POST", path: "/api/v1/lab/bundles/intake", minRole: "Analyst" },
  { group: "G-RESEARCH", method: "GET", path: "/api/v1/lab/bundles", minRole: "Analyst" },
  { group: "G-SELF", method: "GET", path: "/api/v1/uta/accounts", minRole: "Trader" },
  { group: "G-PORT", method: "POST", path: "/api/v1/uta/orders", minRole: "Trader" },
  { group: "G-SELF", method: "GET", path: "/api/v1/uta/positions", minRole: "Trader" },
  { group: "G-SELF", method: "GET", path: "/api/v1/uta/orders", minRole: "Trader" }
];

describe("role-matrix (PR-B2 — login-only sweep, 51 newly-gated endpoints)", () => {
  for (const gc of GATE_CASES) {
    for (const role of ROLES_BY_RANK) {
      const shouldBlock = ROLE_RANK[role] < ROLE_RANK[gc.minRole];
      test(`${gc.group} :: ${gc.method} ${gc.path} :: ${role} -> ${shouldBlock ? "403" : "not-403"}`, async () => {
        const res = await requestAs(role, gc.method, gc.path);
        if (shouldBlock) {
          assert.equal(
            res.status,
            403,
            `expected ${role} (rank < ${gc.minRole}) to be blocked at ${gc.method} ${gc.path}, got ${res.status}`
          );
        } else {
          assert.notEqual(
            res.status,
            403,
            `expected ${role} (rank >= ${gc.minRole}) to pass the role gate at ${gc.method} ${gc.path}, got 403`
          );
        }
        await res.text().catch(() => undefined);
      });
    }
  }
});

describe("role-matrix PR-B — briefs/search must stay published/approved-only (Pete review #1166)", () => {
  // The worker-draft OR branch `OR (status = 'draft' AND generated_by = 'worker')`
  // used to sit in all four briefs/search SQL blocks (FTS main, ILIKE fallback,
  // and both COUNT queries). Once PR-B dropped the READ_DRAFT_ROLES gate, that
  // branch would have leaked unreviewed worker-draft body text (summary_preview)
  // to any logged-in role. The matrix suite runs in memory mode where the SQL is
  // unreachable (database_unavailable short-circuit), so this is a source-scan
  // pin — same pattern as the repo's other SQL-shape regression tests.
  test("briefs/search handler SQL has no worker-draft branch and 4 strict published/approved filters", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(serverEntry, "utf8");

    const start = source.indexOf('app.get("/api/v1/briefs/search"');
    assert.notEqual(start, -1, "briefs/search route not found in server.ts");
    // Handler ends at the next route registration after it.
    const end = source.indexOf('app.post("/api/v1/briefs"', start);
    assert.notEqual(end, -1, "route following briefs/search not found in server.ts");
    const handler = source.slice(start, end);

    assert.ok(
      !handler.includes("generated_by = 'worker'"),
      "briefs/search SQL must NOT contain the worker-draft OR branch — it leaks unreviewed draft text to Viewer (Pete review #1166)"
    );
    assert.ok(
      !/status\s*=\s*'draft'/.test(handler),
      "briefs/search SQL must NOT reference status='draft' in any WHERE clause"
    );

    const strictFilterCount =
      handler.split("AND status IN ('published','approved')").length - 1;
    assert.equal(
      strictFilterCount,
      4,
      `expected the strict published/approved filter in all 4 SQL blocks (FTS main, ILIKE fallback, FTS COUNT, ILIKE COUNT); found ${strictFilterCount}`
    );
  });
});
