export type DedupeNotification = {
  dedupeKey?: string;
  actionUrl?: string;
};

export function taipeiDateFromIso(value: string): string | null {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  return new Date(timestamp + 8 * 60 * 60 * 1_000).toISOString().slice(0, 10);
}

function notificationPriority(item: DedupeNotification) {
  if (item.actionUrl?.startsWith("/briefs/")) return 2;
  if (item.actionUrl) return 1;
  return 0;
}

export function dedupeNotificationItems<T extends DedupeNotification>(items: T[]): T[] {
  const output: T[] = [];
  const keyToIndex = new Map<string, number>();

  for (const item of items) {
    if (!item.dedupeKey) {
      output.push(item);
      continue;
    }

    const existingIndex = keyToIndex.get(item.dedupeKey);
    if (existingIndex === undefined) {
      keyToIndex.set(item.dedupeKey, output.length);
      output.push(item);
      continue;
    }

    if (notificationPriority(item) > notificationPriority(output[existingIndex])) {
      output[existingIndex] = item;
    }
  }

  return output;
}
