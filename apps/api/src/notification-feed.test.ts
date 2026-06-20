import assert from "node:assert/strict";
import test from "node:test";

import { dedupeNotificationItems, taipeiDateFromIso } from "./notification-feed.js";

test("dedupes brief publication events and keeps the direct brief link", () => {
  const result = dedupeNotificationItems([
    {
      id: "event-1",
      dedupeKey: "brief_published:2026-06-19",
      actionUrl: "/alerts",
    },
    {
      id: "brief-1",
      dedupeKey: "brief_published:2026-06-19",
      actionUrl: "/briefs/brief-1",
    },
  ]);

  assert.equal(result.length, 1);
  assert.equal(result[0]?.id, "brief-1");
});

test("converts UTC event timestamps to the Taipei calendar date", () => {
  assert.equal(taipeiDateFromIso("2026-06-18T23:42:00.000Z"), "2026-06-19");
});
