export type PushCapability = "ready" | "needs-install" | "unsupported";

export function resolvePushCapability(input: {
  standalone: boolean;
  serviceWorkerSupported: boolean;
  pushManagerSupported: boolean;
  notificationsSupported: boolean;
}): PushCapability {
  if (!input.standalone) return "needs-install";
  if (!input.serviceWorkerSupported || !input.pushManagerSupported || !input.notificationsSupported) return "unsupported";
  return "ready";
}

export function urlBase64ToUint8Array(value: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index);
  return bytes;
}
