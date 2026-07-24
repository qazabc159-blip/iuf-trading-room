// openalice-email-digest-execrows-regression.test.ts — 2026-07-24 (Jason-2)
//
// Pete's PR #1352 review (evidence/sprint_2026_07_23/pr1352_review.md, 🟡 #1)
// flagged that the openalice-email-digest.ts `.rows` fix (1 site, in
// collectTodayEvents()) had no dedicated regression coverage. This file
// closes that gap: seeds a real iuf_events row via drizzle-orm/postgres-js
// (the real production driver — not a re-implementation of the row shape)
// and calls the (now-exported, for testability — same precedent as
// orchestrator-v3.ts's computeTaiexEma60FromDb) collectTodayEvents()
// directly. Reverting the site under test back to a naked `.rows` read
// makes this test fail, because the seeded row would never be read back —
// see PR body for the red/green self-proof transcript.
//
// Wired into `pnpm run test:db` (package.json), same lane as
// orchestrator-v3-taiex-ema60-db.test.ts / market-data-tools-execrows-regression.test.ts.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { before } from "node:test";

import { eq } from "drizzle-orm";
import { getDb, iufEvents, workspaces } from "@iuf-trading-room/db";

import { collectTodayEvents } from "./openalice-email-digest.js";

let workspaceId = "";

before(async () => {
  const db = getDb();
  assert.ok(db, "this suite requires PERSISTENCE_MODE=database — run via `pnpm run test:db`");
  const [existing] = await db.select().from(workspaces).limit(1);
  if (existing) {
    workspaceId = existing.id;
  } else {
    const [created] = await db
      .insert(workspaces)
      .values({ name: "email-digest-execrows-regression Test", slug: `email-digest-execrows-regression-${randomUUID()}` })
      .returning();
    workspaceId = created!.id;
  }
});

test("EMAILDIGEST-1: collectTodayEvents reads real iuf_events rows (not null/empty)", async () => {
  const db = getDb()!;
  const ruleId = `ZZTEST_RULE_${randomUUID().slice(0, 8)}`;

  const [event] = await db
    .insert(iufEvents)
    .values({
      workspaceId,
      ruleId,
      ruleName: "execrows-regression test rule",
      severity: "critical",
      ticker: "2330",
      payload: { note: "execrows-regression fixture" },
      triggeredAt: new Date()
    })
    .returning();
  assert.ok(event, "EMAILDIGEST-1 fixture: iuf_events insert must return a row");

  try {
    const events = await collectTodayEvents(workspaceId);

    const found = events.find((e) => e.ruleId === ruleId);
    assert.ok(
      found,
      "EMAILDIGEST-1: the seeded iuf_events row must come back from collectTodayEvents — " +
        "a naked `.rows` read on db.execute()'s bare-array result would silently degrade to []"
    );
    assert.equal(found!.ruleName, "execrows-regression test rule");
    assert.equal(found!.severity, "critical");
    assert.equal(found!.ticker, "2330");
    assert.deepEqual(found!.payload, { note: "execrows-regression fixture" });
  } finally {
    await db.delete(iufEvents).where(eq(iufEvents.id, event!.id)).catch(() => {});
  }
});
