/**
 * eventlog.test.ts -- EventLog Phase A isolated tests (2026-05-17)
 * Run via: node --import ./tests/setup-test-env.mjs --import tsx --test tests/eventlog.test.ts
 *
 * All tests run in memory mode (no DB required -- PERSISTENCE_MODE defaults to memory).
 */
import assert from "node:assert/strict";
import test, { after } from "node:test";

import {
  appendEvent,
  readStreamEvents,
  readEventsAt,
  listEventStreams,
  _resetEventLogStoreForTests,
} from "../apps/api/src/events/event-log-store.ts";

const WS = "ws-eventlog-test";

// Reset memory store before each test
function reset() {
  _resetEventLogStoreForTests();
}

// ─────────────────────────────────────────────────────────────────────────────
// EL-1: appendEvent creates stream on first call + returns seq=1
// ─────────────────────────────────────────────────────────────────────────────
test("EL-1: appendEvent creates stream + seq=1 on first call", async () => {
  reset();
  const result = await appendEvent({
    workspaceId: WS,
    streamType: "strategy",
    streamId: "cont_liq_v36",
    eventType: "strategy.subscribed",
    payload: { capital_twd: 100000, sim_only: true },
  });

  assert.equal(typeof result.id, "string", "EL-1: result.id must be a string UUID");
  assert.equal(result.seq, 1, "EL-1: first event in stream must have seq=1");
  assert.equal(typeof result.recordedAt, "string", "EL-1: recordedAt must be an ISO8601 string");
  assert.match(result.recordedAt, /^\d{4}-\d{2}-\d{2}T/, "EL-1: recordedAt must be ISO8601 format");
});

// ─────────────────────────────────────────────────────────────────────────────
// EL-2: seq increments monotonically within a stream
// ─────────────────────────────────────────────────────────────────────────────
test("EL-2: seq increments monotonically within the same stream", async () => {
  reset();
  const r1 = await appendEvent({
    workspaceId: WS,
    streamType: "strategy",
    streamId: "cont_liq_v36",
    eventType: "strategy.subscribed",
    payload: { capital_twd: 100000 },
  });
  const r2 = await appendEvent({
    workspaceId: WS,
    streamType: "strategy",
    streamId: "cont_liq_v36",
    eventType: "strategy.unsubscribed",
    payload: { reason: "user_request" },
  });
  const r3 = await appendEvent({
    workspaceId: WS,
    streamType: "strategy",
    streamId: "cont_liq_v36",
    eventType: "strategy.subscribed",
    payload: { capital_twd: 200000 },
  });

  assert.equal(r1.seq, 1, "EL-2: first event seq=1");
  assert.equal(r2.seq, 2, "EL-2: second event seq=2");
  assert.equal(r3.seq, 3, "EL-2: third event seq=3");
});

// ─────────────────────────────────────────────────────────────────────────────
// EL-3: separate streams have independent seq counters
// ─────────────────────────────────────────────────────────────────────────────
test("EL-3: separate streams have independent seq counters", async () => {
  reset();
  const a1 = await appendEvent({
    workspaceId: WS,
    streamType: "strategy",
    streamId: "stream_A",
    eventType: "strategy.subscribed",
    payload: {},
  });
  const a2 = await appendEvent({
    workspaceId: WS,
    streamType: "strategy",
    streamId: "stream_A",
    eventType: "strategy.subscribed",
    payload: {},
  });
  const b1 = await appendEvent({
    workspaceId: WS,
    streamType: "order",
    streamId: "stream_B",
    eventType: "order.submitted",
    payload: {},
  });

  assert.equal(a1.seq, 1, "EL-3: stream_A first event seq=1");
  assert.equal(a2.seq, 2, "EL-3: stream_A second event seq=2");
  assert.equal(b1.seq, 1, "EL-3: stream_B first event has seq=1 independent of stream_A");
});

// ─────────────────────────────────────────────────────────────────────────────
// EL-4: readStreamEvents returns events in seq order
// ─────────────────────────────────────────────────────────────────────────────
test("EL-4: readStreamEvents returns events in ascending seq order", async () => {
  reset();
  await appendEvent({ workspaceId: WS, streamType: "strategy", streamId: "s1", eventType: "a", payload: { n: 1 } });
  await appendEvent({ workspaceId: WS, streamType: "strategy", streamId: "s1", eventType: "b", payload: { n: 2 } });
  await appendEvent({ workspaceId: WS, streamType: "strategy", streamId: "s1", eventType: "c", payload: { n: 3 } });

  const result = await readStreamEvents({
    workspaceId: WS,
    streamType: "strategy",
    streamId: "s1",
  });

  assert.equal(result.events.length, 3, "EL-4: must return 3 events");
  assert.equal(result.events[0]?.seq, 1, "EL-4: first event seq=1");
  assert.equal(result.events[1]?.seq, 2, "EL-4: second event seq=2");
  assert.equal(result.events[2]?.seq, 3, "EL-4: third event seq=3");
  assert.equal(result.events[0]?.eventType, "a", "EL-4: first event type=a");
  assert.equal(result.events[2]?.eventType, "c", "EL-4: last event type=c");
  assert.equal(result.hasMore, false, "EL-4: hasMore must be false (3 < default limit 50)");
  assert.equal(result.nextSeq, null, "EL-4: nextSeq must be null when no more pages");
});

// ─────────────────────────────────────────────────────────────────────────────
// EL-5: readStreamEvents fromSeq / toSeq filtering
// ─────────────────────────────────────────────────────────────────────────────
test("EL-5: readStreamEvents fromSeq/toSeq filtering works", async () => {
  reset();
  for (let i = 1; i <= 5; i++) {
    await appendEvent({ workspaceId: WS, streamType: "strategy", streamId: "filter-test", eventType: "tick", payload: { i } });
  }

  const fromResult = await readStreamEvents({
    workspaceId: WS,
    streamType: "strategy",
    streamId: "filter-test",
    fromSeq: 3,
  });
  assert.equal(fromResult.events.length, 3, "EL-5: fromSeq=3 should return events 3,4,5");
  assert.equal(fromResult.events[0]?.seq, 3, "EL-5: first result must be seq=3");

  const rangeResult = await readStreamEvents({
    workspaceId: WS,
    streamType: "strategy",
    streamId: "filter-test",
    fromSeq: 2,
    toSeq: 4,
  });
  assert.equal(rangeResult.events.length, 3, "EL-5: fromSeq=2 toSeq=4 should return 3 events");
  assert.equal(rangeResult.events[0]?.seq, 2, "EL-5: range first=2");
  assert.equal(rangeResult.events[2]?.seq, 4, "EL-5: range last=4");
});

// ─────────────────────────────────────────────────────────────────────────────
// EL-6: readEventsAt time-travel returns only events occurred_at <= asOf
// ─────────────────────────────────────────────────────────────────────────────
test("EL-6: readEventsAt time-travel filters by occurredAt", async () => {
  reset();

  const t1 = new Date("2026-01-01T09:00:00Z");
  const t2 = new Date("2026-01-01T10:00:00Z");
  const t3 = new Date("2026-01-01T11:00:00Z");

  await appendEvent({
    workspaceId: WS,
    streamType: "strategy",
    streamId: "time-travel",
    eventType: "strategy.subscribed",
    payload: { n: 1 },
    occurredAt: t1,
  });
  await appendEvent({
    workspaceId: WS,
    streamType: "strategy",
    streamId: "time-travel",
    eventType: "strategy.updated",
    payload: { n: 2 },
    occurredAt: t2,
  });
  await appendEvent({
    workspaceId: WS,
    streamType: "strategy",
    streamId: "time-travel",
    eventType: "strategy.unsubscribed",
    payload: { n: 3 },
    occurredAt: t3,
  });

  // Query asOf = t2 -- must return events 1 and 2, not 3
  const result = await readEventsAt({
    workspaceId: WS,
    streamType: "strategy",
    streamId: "time-travel",
    asOf: t2,
  });

  assert.equal(result.events.length, 2, "EL-6: asOf=t2 must return exactly 2 events");
  assert.equal(result.events[0]?.seq, 1, "EL-6: first event seq=1");
  assert.equal(result.events[1]?.seq, 2, "EL-6: second event seq=2");
  assert.equal(
    result.events.find((e) => e.eventType === "strategy.unsubscribed"),
    undefined,
    "EL-6: event after asOf must not appear"
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// EL-7: readStreamEvents on non-existent stream returns empty
// ─────────────────────────────────────────────────────────────────────────────
test("EL-7: readStreamEvents on non-existent stream returns empty result", async () => {
  reset();
  const result = await readStreamEvents({
    workspaceId: WS,
    streamType: "strategy",
    streamId: "does-not-exist",
  });
  assert.equal(result.events.length, 0, "EL-7: events must be empty for unknown stream");
  assert.equal(result.hasMore, false, "EL-7: hasMore must be false");
  assert.equal(result.nextSeq, null, "EL-7: nextSeq must be null");
});

// ─────────────────────────────────────────────────────────────────────────────
// EL-8: listEventStreams returns streams for the workspace
// ─────────────────────────────────────────────────────────────────────────────
test("EL-8: listEventStreams returns streams for the workspace", async () => {
  reset();
  await appendEvent({ workspaceId: WS, streamType: "strategy", streamId: "s1", eventType: "strategy.subscribed", payload: {} });
  await appendEvent({ workspaceId: WS, streamType: "order", streamId: "o1", eventType: "order.submitted", payload: {} });
  await appendEvent({ workspaceId: "other-ws", streamType: "strategy", streamId: "s2", eventType: "strategy.subscribed", payload: {} });

  const all = await listEventStreams({ workspaceId: WS });
  assert.equal(all.length, 2, "EL-8: must return 2 streams for WS (not other-ws stream)");

  const strategyOnly = await listEventStreams({ workspaceId: WS, streamType: "strategy" });
  assert.equal(strategyOnly.length, 1, "EL-8: streamType filter must return 1 strategy stream");
  assert.equal(strategyOnly[0]?.streamType, "strategy", "EL-8: streamType must be 'strategy'");
  assert.equal(strategyOnly[0]?.streamId, "s1", "EL-8: streamId must be 's1'");
});

// ─────────────────────────────────────────────────────────────────────────────
// EL-9: double append to same stream is idempotent on stream creation
// ─────────────────────────────────────────────────────────────────────────────
test("EL-9: appending to same stream twice reuses existing stream row", async () => {
  reset();
  await appendEvent({ workspaceId: WS, streamType: "strategy", streamId: "reuse", eventType: "e1", payload: {} });
  await appendEvent({ workspaceId: WS, streamType: "strategy", streamId: "reuse", eventType: "e2", payload: {} });

  const streams = await listEventStreams({ workspaceId: WS, streamType: "strategy" });
  assert.equal(streams.length, 1, "EL-9: same stream_type+stream_id must create only one stream entry");

  const events = await readStreamEvents({ workspaceId: WS, streamType: "strategy", streamId: "reuse" });
  assert.equal(events.events.length, 2, "EL-9: must have 2 events in the reused stream");
  assert.equal(events.events[0]?.streamId, events.events[1]?.streamId, "EL-9: both events must share same streamId");
});

after(() => {
  _resetEventLogStoreForTests();
});
