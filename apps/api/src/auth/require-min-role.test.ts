import assert from "node:assert/strict";
import test from "node:test";

import {
  ROLE_RANK,
  ROLES_BY_RANK,
  requireMinRole,
  type Role
} from "./require-min-role.js";

function sessionWithRole(role: Role) {
  return {
    user: {
      id: "00000000-0000-0000-0000-000000000000",
      name: "Test User",
      email: "test@example.com",
      role
    }
  };
}

test("ROLE_RANK: D1 strict ladder order — Viewer < Trader < Analyst < Admin < Owner", () => {
  assert.deepEqual(ROLES_BY_RANK, ["Viewer", "Trader", "Analyst", "Admin", "Owner"]);
  assert.equal(ROLE_RANK.Viewer, 0);
  assert.equal(ROLE_RANK.Trader, 1);
  assert.equal(ROLE_RANK.Analyst, 2);
  assert.equal(ROLE_RANK.Admin, 3);
  assert.equal(ROLE_RANK.Owner, 4);
});

test("requireMinRole: full 5x5 rank-combination matrix", () => {
  for (const sessionRole of ROLES_BY_RANK) {
    for (const minRole of ROLES_BY_RANK) {
      const expected = ROLE_RANK[sessionRole] >= ROLE_RANK[minRole];
      const actual = requireMinRole(sessionWithRole(sessionRole), minRole);
      assert.equal(
        actual,
        expected,
        `requireMinRole(session=${sessionRole}, minRole=${minRole}) expected ${expected}, got ${actual}`
      );
    }
  }
});

test("requireMinRole: same role always passes (reflexive)", () => {
  for (const role of ROLES_BY_RANK) {
    assert.equal(requireMinRole(sessionWithRole(role), role), true);
  }
});

test("requireMinRole: Owner passes every minRole gate", () => {
  for (const minRole of ROLES_BY_RANK) {
    assert.equal(requireMinRole(sessionWithRole("Owner"), minRole), true);
  }
});

test("requireMinRole: Viewer only passes the Viewer gate", () => {
  assert.equal(requireMinRole(sessionWithRole("Viewer"), "Viewer"), true);
  assert.equal(requireMinRole(sessionWithRole("Viewer"), "Trader"), false);
  assert.equal(requireMinRole(sessionWithRole("Viewer"), "Analyst"), false);
  assert.equal(requireMinRole(sessionWithRole("Viewer"), "Admin"), false);
  assert.equal(requireMinRole(sessionWithRole("Viewer"), "Owner"), false);
});

test("requireMinRole: null/undefined session always fails, regardless of minRole", () => {
  for (const minRole of ROLES_BY_RANK) {
    assert.equal(requireMinRole(null, minRole), false);
    assert.equal(requireMinRole(undefined, minRole), false);
  }
});
