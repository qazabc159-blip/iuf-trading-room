import type { PushSubscription } from "web-push";

import {
  databasePushSubscriptionStore,
  type PushSubscriptionStore,
  type StoredPushSubscription,
} from "./push-subscriptions.js";
import {
  getConfiguredWebPushService,
  type ConfiguredWebPushService,
  type WebPushServiceState,
} from "./web-push-client.js";

const DEFAULT_THROTTLE_MS = 5 * 60 * 1_000;

export type AlertPushEvent = {
  workspaceId: string;
  ruleId: string;
  ticker: string | null;
};

export type AlertPushPayload = {
  title: string;
  body: string;
  url: string;
};

type PayloadCopy = Omit<AlertPushPayload, "url"> & {
  path: string;
  companySpecific?: boolean;
};

// P1-2 granularity fix (2026-07-11, after prod verify of #1224): R11 (推薦
// cron 耗盡) and R14 (題材未更新) were removed from this allowlist. Both are
// service/content-freshness status notices ("資料尚未產出，請稍後查看") —
// not a market signal a trader can act on, and not urgent enough to justify
// interrupting a phone with a push notification either. This allowlist also
// doubles as the alerts-feed audience classification (openalice-event-rule-
// engine.ts's `ruleAudience()`), so removing them here demotes them to
// ops_internal on BOTH surfaces at once — see that file's comment for the
// full reasoning and the PR body for the per-rule attribution table.
const PAYLOAD_COPY: Readonly<Record<string, PayloadCopy>> = {
  R01_REVENUE_SURGE_YOY50: {
    title: "營收變化提醒",
    body: "月營收出現需要留意的變化，請查看最新資料。",
    path: "/alerts",
    companySpecific: true,
  },
  R02_INSTITUTIONAL_CONSECUTIVE_BUY_5D: {
    title: "法人動向提醒",
    body: "法人買進動向出現連續變化，請查看最新資料。",
    path: "/alerts",
    companySpecific: true,
  },
  R03_INSTITUTIONAL_CONSECUTIVE_SELL_5D: {
    title: "法人動向提醒",
    body: "法人賣出動向出現連續變化，請查看最新資料。",
    path: "/alerts",
    companySpecific: true,
  },
  R04_SHAREHOLDING_HHI_BREAKOUT: {
    title: "持股變化提醒",
    body: "持股集中度出現需要留意的變化，請查看最新資料。",
    path: "/alerts",
    companySpecific: true,
  },
  R05_REVENUE_DECLINE_YOY30: {
    title: "營收變化提醒",
    body: "月營收下滑達到提醒條件，請查看最新資料。",
    path: "/alerts",
    companySpecific: true,
  },
  R06_MAJOR_SHAREHOLDER_THRESHOLD: {
    title: "持股變化提醒",
    body: "主要股東持股出現需要留意的變化，請查看最新資料。",
    path: "/alerts",
    companySpecific: true,
  },
  R07_MAJOR_ANNOUNCEMENT: {
    title: "重大公告提醒",
    body: "公司發布新的重大公告，請查看最新內容。",
    path: "/alerts",
    companySpecific: true,
  },
  R08_AI_BRIEF_PUBLISHED: {
    title: "市場簡報已更新",
    body: "新的市場簡報已發布，請開啟戰情室查看。",
    path: "/briefs",
  },
};

function companyPath(ticker: string | null): string | null {
  const normalized = ticker?.trim();
  if (!normalized || !/^[A-Za-z0-9._-]{1,24}$/.test(normalized)) return null;
  return `/companies/${encodeURIComponent(normalized)}`;
}

/** Builds user-facing copy from an allowlist; raw event metadata never enters the notification. */
export function buildAlertPushPayload(
  event: Pick<AlertPushEvent, "ruleId" | "ticker">,
): AlertPushPayload | null {
  const copy = PAYLOAD_COPY[event.ruleId];
  if (!copy) return null;

  return {
    title: copy.title,
    body: copy.body,
    url: copy.companySpecific ? (companyPath(event.ticker) ?? copy.path) : copy.path,
  };
}

/** Pure five-minute frequency guard. The boundary itself is eligible. */
export function shouldSendAlertType(
  lastSentAtMs: number | undefined,
  nowMs: number,
  throttleMs = DEFAULT_THROTTLE_MS,
): boolean {
  return lastSentAtMs === undefined || nowMs - lastSentAtMs >= throttleMs;
}

function isExpiredSubscriptionError(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("statusCode" in error)) return false;
  const statusCode = (error as { statusCode?: unknown }).statusCode;
  return statusCode === 404 || statusCode === 410;
}

function toWebPushSubscription(subscription: StoredPushSubscription): PushSubscription {
  return {
    endpoint: subscription.endpoint,
    keys: subscription.keys,
  };
}

export type AlertPushDispatchResult = {
  status: "sent" | "not_eligible" | "unavailable" | "throttled" | "no_subscribers";
  attempted: number;
  sent: number;
  failed: number;
  removed: number;
};

type AlertPushDependencies = {
  store: PushSubscriptionStore;
  getPushService: () => WebPushServiceState;
  now: () => number;
  throttleMs: number;
};

export function createAlertPushDispatcher(dependencies: Partial<AlertPushDependencies> = {}) {
  const deps: AlertPushDependencies = {
    store: databasePushSubscriptionStore,
    getPushService: () => getConfiguredWebPushService(),
    now: () => Date.now(),
    throttleMs: DEFAULT_THROTTLE_MS,
    ...dependencies,
  };
  const lastSentByType = new Map<string, number>();

  return async function dispatchAlertPush(event: AlertPushEvent): Promise<AlertPushDispatchResult> {
    const payload = buildAlertPushPayload(event);
    if (!payload) {
      return { status: "not_eligible", attempted: 0, sent: 0, failed: 0, removed: 0 };
    }

    const pushState = deps.getPushService();
    if (!pushState.ok) {
      return { status: "unavailable", attempted: 0, sent: 0, failed: 0, removed: 0 };
    }

    const now = deps.now();
    const throttleKey = `${event.workspaceId}:${event.ruleId}`;
    if (!shouldSendAlertType(lastSentByType.get(throttleKey), now, deps.throttleMs)) {
      return { status: "throttled", attempted: 0, sent: 0, failed: 0, removed: 0 };
    }
    // Reserve the event type before the first await so concurrent ticks cannot double-send.
    lastSentByType.set(throttleKey, now);

    let subscriptions: StoredPushSubscription[];
    try {
      subscriptions = await deps.store.listForWorkspace(event.workspaceId);
    } catch (error) {
      lastSentByType.delete(throttleKey);
      throw error;
    }
    if (subscriptions.length === 0) {
      lastSentByType.delete(throttleKey);
      return { status: "no_subscribers", attempted: 0, sent: 0, failed: 0, removed: 0 };
    }

    const result = {
      status: "sent" as const,
      attempted: subscriptions.length,
      sent: 0,
      failed: 0,
      removed: 0,
    };
    const body = JSON.stringify(payload);

    await Promise.all(
      subscriptions.map(async (subscription) => {
        try {
          await send(pushState.service, subscription, body);
          result.sent += 1;
        } catch (error) {
          result.failed += 1;
          if (isExpiredSubscriptionError(error)) {
            if (await deps.store.removeByEndpoint(event.workspaceId, subscription.endpoint)) result.removed += 1;
          }
        }
      }),
    );

    return result;
  };
}

function send(service: ConfiguredWebPushService, subscription: StoredPushSubscription, payload: string) {
  return service.sendNotification(toWebPushSubscription(subscription), payload, {
    TTL: 60,
    urgency: "high",
    timeout: 5_000,
  });
}

export const dispatchAlertPush = createAlertPushDispatcher();
