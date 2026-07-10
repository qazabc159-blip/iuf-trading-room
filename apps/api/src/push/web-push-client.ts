import webpush, {
  type PushSubscription,
  type RequestOptions,
  type SendResult,
} from "web-push";

const REQUIRED_VAPID_ENV = ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"] as const;

type VapidEnvName = (typeof REQUIRED_VAPID_ENV)[number];
type Environment = Record<string, string | undefined>;

export type WebPushTransport = {
  setVapidDetails(subject: string, publicKey: string, privateKey: string): void;
  sendNotification(
    subscription: PushSubscription,
    payload?: string | Buffer | null,
    options?: RequestOptions,
  ): Promise<SendResult>;
};

export type ConfiguredWebPushService = {
  publicKey: string;
  sendNotification(
    subscription: PushSubscription,
    payload: string,
    options?: RequestOptions,
  ): Promise<SendResult>;
};

export type WebPushServiceState =
  | { ok: true; service: ConfiguredWebPushService }
  | { ok: false; message: string; missing: VapidEnvName[] };

export function getConfiguredWebPushService(
  env: Environment = process.env,
  transport: WebPushTransport = webpush,
): WebPushServiceState {
  const missing = REQUIRED_VAPID_ENV.filter((name) => !env[name]?.trim());
  if (missing.length > 0) {
    return {
      ok: false,
      message: "推播服務尚未完成設定，暫時無法使用。",
      missing,
    };
  }

  const publicKey = env.VAPID_PUBLIC_KEY!.trim();
  const privateKey = env.VAPID_PRIVATE_KEY!.trim();
  const subject = env.VAPID_SUBJECT!.trim();
  if (!subject.startsWith("mailto:") && !subject.startsWith("https://")) {
    return {
      ok: false,
      message: "推播服務聯絡資訊格式有誤，暫時無法使用。",
      missing: [],
    };
  }

  try {
    transport.setVapidDetails(subject, publicKey, privateKey);
  } catch {
    return {
      ok: false,
      message: "推播服務金鑰格式有誤，暫時無法使用。",
      missing: [],
    };
  }

  return {
    ok: true,
    service: {
      publicKey,
      sendNotification: (subscription, payload, options) =>
        transport.sendNotification(subscription, payload, options),
    },
  };
}
