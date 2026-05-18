import { describe, expect, it } from "vitest";

import { formatMobileKgiBlockedReason } from "./mobile-kgi-copy";

describe("MobileKgiWatchlist blocked reason copy", () => {
  it("hides raw SYMBOL_NOT_ALLOWED payloads behind product copy", () => {
    const reason = formatMobileKgiBlockedReason(422, JSON.stringify({ error: "SYMBOL_NOT_ALLOWED" }));

    expect(reason).toBe("未開放");
    expect(reason).not.toContain("SYMBOL_NOT_ALLOWED");
    expect(reason).not.toContain("{");
  });

  it("hides gateway outages behind a short paused state", () => {
    const reason = formatMobileKgiBlockedReason(503, JSON.stringify({ error: "GATEWAY_UNREACHABLE" }));

    expect(reason).toBe("讀取暫停");
    expect(reason).not.toContain("GATEWAY");
    expect(reason).not.toContain("503");
  });

  it("uses a login-safe label for gateway auth failures", () => {
    expect(formatMobileKgiBlockedReason(401, JSON.stringify({ error: "GATEWAY_AUTH" }))).toBe("需重新登入");
    expect(formatMobileKgiBlockedReason(403, "forbidden")).toBe("需重新登入");
  });

  it("falls back to quote-unavailable copy for unknown errors", () => {
    expect(formatMobileKgiBlockedReason(418, "unexpected upstream body")).toBe("暫無報價");
  });
});
