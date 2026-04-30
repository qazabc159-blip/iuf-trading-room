/**
 * companies-ticker-resolution.test.ts
 *
 * Tests for resolveCompany ticker-fallback logic (TASK 1 — T1..T4).
 *
 *   T1: UUID lookup — existing behavior unchanged
 *   T2: ticker lookup — resolves to correct company
 *   T3: unknown ticker — returns null (→ 404, not 500)
 *   T4: unknown UUID — returns null (→ 404, not 500)
 */

import assert from "node:assert/strict";
import test from "node:test";
import { getTradingRoomRepository } from "@iuf-trading-room/domain";
import type { AppSession } from "@iuf-trading-room/contracts";

// ── Helpers ────────────────────────────────────────────────────────────────────

function fakeSession(): AppSession {
  return {
    workspace: { id: "00000000-0000-0000-0000-000000000001", slug: "test", name: "Test" },
    user: { id: "00000000-0000-0000-0000-000000000002", name: "Test User", email: "test@example.com", role: "Owner" },
    persistenceMode: "memory"
  };
}

// Inline copy of resolveCompany — so we don't import the full server.ts
// (which has side effects like binding the Hono app).
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function resolveCompany(
  repo: Awaited<ReturnType<typeof getTradingRoomRepository>>,
  idOrTicker: string,
  options: { workspaceSlug: string }
) {
  if (UUID_PATTERN.test(idOrTicker)) {
    return repo.getCompany(idOrTicker, options);
  }
  const all = await repo.listCompanies(undefined, options);
  return all.find((c) => c.ticker === idOrTicker) ?? null;
}

// ── Tests ──────────────────────────────────────────────────────────────────────

test("T1: UUID lookup returns existing company", async () => {
  const session = fakeSession();
  const repo = getTradingRoomRepository();

  const created = await repo.createCompany(
    {
      name: "台積電",
      ticker: "2330",
      market: "TWSE",
      country: "TW",
      chainPosition: "Mid",
      beneficiaryTier: "Direct",
      themeIds: [],
      exposure: { direct: 0, indirect: 0, total: 0 },
      validation: { status: "pending", score: 0, issues: [] },
      notes: ""
    },
    { workspaceSlug: session.workspace.slug }
  );

  const result = await resolveCompany(repo, created.id, {
    workspaceSlug: session.workspace.slug
  });
  assert.ok(result, "should resolve by UUID");
  assert.equal(result.id, created.id);
  assert.equal(result.ticker, "2330");
});

test("T2: ticker lookup resolves to correct company", async () => {
  const session = fakeSession();
  const repo = getTradingRoomRepository();

  const created = await repo.createCompany(
    {
      name: "聯發科",
      ticker: "2454",
      market: "TWSE",
      country: "TW",
      chainPosition: "Mid",
      beneficiaryTier: "Direct",
      themeIds: [],
      exposure: { direct: 0, indirect: 0, total: 0 },
      validation: { status: "pending", score: 0, issues: [] },
      notes: ""
    },
    { workspaceSlug: session.workspace.slug }
  );

  const result = await resolveCompany(repo, "2454", {
    workspaceSlug: session.workspace.slug
  });
  assert.ok(result, "ticker '2454' should resolve");
  assert.equal(result.id, created.id);
  assert.equal(result.name, "聯發科");
});

test("T3: unknown ticker returns null (→ 404, not 500)", async () => {
  const session = fakeSession();
  const repo = getTradingRoomRepository();

  const result = await resolveCompany(repo, "NOTEXIST", {
    workspaceSlug: session.workspace.slug
  });
  assert.equal(result, null, "unknown ticker must return null");
});

test("T4: unknown UUID returns null (→ 404, not 500)", async () => {
  const session = fakeSession();
  const repo = getTradingRoomRepository();

  const result = await resolveCompany(
    repo,
    "00000000-0000-4000-8000-000000000099",
    { workspaceSlug: session.workspace.slug }
  );
  assert.equal(result, null, "unknown UUID must return null");
});
