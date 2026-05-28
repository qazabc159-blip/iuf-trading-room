type DataWrapped<T> = {
  data?: T;
};

export function unwrapEventLogApiPayload<T>(json: T | DataWrapped<T>): T {
  if (json && typeof json === "object" && "data" in json) {
    const data = (json as DataWrapped<T>).data;
    if (data !== undefined && data !== null) return data;
  }

  return json as T;
}
