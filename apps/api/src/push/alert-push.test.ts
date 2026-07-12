import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAlertPushPayload,
  createAlertPushDispatcher,
  shouldSendAlertType,
} from "./alert-push.js";
import type { PushSubscriptionStore, StoredPushSubscription } from "./push-subscriptions.js";
import type { WebPushServiceState } from "./web-push-client.js";

const endpoints = [
  "https://push.example.invalid/active",
  "https://push.example.invalid/gone",
  "https://push.example.invalid/missing",
];
const eligibleRuleIds = [
  "R01_REVENUE_SURGE_YOY50",
  "R02_INSTITUTIONAL_CONSECUTIVE_BUY_5D",
  "R03_INSTITUTIONAL_CONSECUTIVE_SELL_5D",
  "R04_SHAREHOLDING_HHI_BREAKOUT",
  "R05_REVENUE_DECLINE_YOY30",
  "R06_MAJOR_SHAREHOLDER_THRESHOLD",
  "R07_MAJOR_ANNOUNCEMENT",
  "R08_AI_BRIEF_PUBLISHED",
];
// P1-2 granularity fix (2026-07-11): removed from PAYLOAD_COPY — service/
// content-freshness status notices, not a trader-actionable market signal
// and not push-worthy either.
const removedFromAllowlistRuleIds = ["R11_V3_REC_CRON_EXHAUSTED", "R14_THEME_REFRESH_STALE"];
const chineseNotificationCopy = /^[\p{Script=Han}，。！？、：；「」『』（）\s]+$/u;
const forbiddenNotificationCopy =
  /保證獲利|可以跟單|alpha confirmed|live-ready|enum|model|debug|openai|llm|kgi|R\d/iu;

function subscription(endpoint: string): StoredPushSubscription {
  return {
    userId: "00000000-0000-4000-8000-000000000001",
    endpoint,
    keys: { p256dh: "browser-public-key", auth: "browser-auth-secret" },
    createdAt: new Date("2026-07-10T00:00:00Z"),
  };
}

function createStore() {
  const rows = new Map(endpoints.map((endpoint) => [endpoint, subscription(endpoint)]));
  const removed: string[] = [];
  const store: PushSubscriptionStore = {
    async upsert() {},
    async removeForUser(_userId, endpoint) {
      return rows.delete(endpoint);
    },
    async listAll() {
      return [...rows.values()];
    },
    async removeByEndpoint(endpoint) {
      removed.push(endpoint);
      return rows.delete(endpoint);
    },
  };
  return { rows, removed, store };
}

test("event dispatch builds Chinese copy, sends web push, and removes 404/410 subscriptions", async () => {
  const { rows, removed, store } = createStore();
  const deliveries: Array<{ endpoint: string; payload: string }> = [];
  const pushState: WebPushServiceState = {
    ok: true,
    service: {
      publicKey: "test-public-key",
      async sendNotification(target, payload) {
        deliveries.push({ endpoint: target.endpoint, payload });
        if (target.endpoint.endsWith("/gone")) throw { statusCode: 410 };
        if (target.endpoint.endsWith("/missing")) throw { statusCode: 404 };
        return { statusCode: 201, body: "", headers: {} };
      },
    },
  };
  const dispatch = createAlertPushDispatcher({ store, getPushService: () => pushState });

  const result = await dispatch({ ruleId: "R07_MAJOR_ANNOUNCEMENT", ticker: "2330" });

  assert.deepEqual(result, { status: "sent", attempted: 3, sent: 1, failed: 2, removed: 2 });
  assert.equal(deliveries.length, 3);
  assert.deepEqual(removed.sort(), endpoints.slice(1).sort());
  assert.deepEqual([...rows.keys()], [endpoints[0]]);

  const payload = JSON.parse(deliveries[0]!.payload) as { title: string; body: string; url: string };
  assert.deepEqual(payload, {
    title: "重大公告提醒",
    body: "公司發布新的重大公告，請查看最新內容。",
    url: "/companies/2330",
  });
  assert.match(payload.title, chineseNotificationCopy);
  assert.match(payload.body, chineseNotificationCopy);
  assert.doesNotMatch(`${payload.title} ${payload.body}`, forbiddenNotificationCopy);
});

test("same event type is throttled for five minutes and allowed at the boundary", async () => {
  const { store } = createStore();
  let now = 1_000_000;
  let sends = 0;
  const dispatch = createAlertPushDispatcher({
    store,
    now: () => now,
    getPushService: () => ({
      ok: true,
      service: {
        publicKey: "test-public-key",
        async sendNotification() {
          sends += 1;
          return { statusCode: 201, body: "", headers: {} };
        },
      },
    }),
  });

  assert.equal((await dispatch({ ruleId: "R08_AI_BRIEF_PUBLISHED", ticker: null })).status, "sent");
  now += 299_999;
  assert.equal((await dispatch({ ruleId: "R08_AI_BRIEF_PUBLISHED", ticker: null })).status, "throttled");
  now += 1;
  assert.equal((await dispatch({ ruleId: "R08_AI_BRIEF_PUBLISHED", ticker: null })).status, "sent");
  assert.equal(sends, 6);

  assert.equal(shouldSendAlertType(undefined, 10), true);
  assert.equal(shouldSendAlertType(10, 300_009), false);
  assert.equal(shouldSendAlertType(10, 300_010), true);
});

test("internal event types are not eligible and raw metadata cannot enter user-facing copy", async () => {
  assert.equal(buildAlertPushPayload({ ruleId: "R09_HALLUCINATION_REJECTED", ticker: "debug" }), null);
  assert.deepEqual(buildAlertPushPayload({ ruleId: "R08_AI_BRIEF_PUBLISHED", ticker: null }), {
    title: "市場簡報已更新",
    body: "新的市場簡報已發布，請開啟戰情室查看。",
    url: "/briefs",
  });

  for (const ruleId of eligibleRuleIds) {
    const payload = buildAlertPushPayload({ ruleId, ticker: "2330" });
    assert.ok(payload, `${ruleId} should have allowlisted user copy`);
    assert.match(payload.title, chineseNotificationCopy);
    assert.match(payload.body, chineseNotificationCopy);
    assert.doesNotMatch(`${payload.title} ${payload.body}`, forbiddenNotificationCopy);
  }

  for (const ruleId of removedFromAllowlistRuleIds) {
    assert.equal(
      buildAlertPushPayload({ ruleId, ticker: null }),
      null,
      `${ruleId} is a service/content-freshness status, not push-worthy`
    );
  }
});
