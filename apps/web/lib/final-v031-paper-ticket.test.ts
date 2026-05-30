import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const ticketHtml = readFileSync(new URL("../public/ui-final-v031/paper_trading_room/index.html", import.meta.url), "utf8");
const liveHydration = readFileSync(new URL("./final-v031-live.ts", import.meta.url), "utf8");
const backendProxy = readFileSync(new URL("../app/api/ui-final-v031/backend/route.ts", import.meta.url), "utf8");

describe("final-v031 paper ticket price gate", () => {
  it("keeps an invalid paper ticket out of the ready-submit state", () => {
    expect(ticketHtml).toContain("const validTicket=validQty&&validPrice");
    expect(ticketHtml).toContain("submitBtn.disabled=true");
    expect(ticketHtml).toContain("紙上單未就緒");
    expect(ticketHtml).toContain("請輸入有效委託價");
    expect(ticketHtml).toContain("待輸入 <small>NTD</small>");
    expect(ticketHtml).toContain("window.__IUF_TICKET_LOCK_REASON__");
  });

  it("does not fall back to selected quote for an invalid limit-price submit", () => {
    expect(liveHydration).toContain("const rawPx = Number");
    expect(liveHydration).toContain('const px = orderType === "market" ? selectedPx : rawPx');
    expect(liveHydration).toContain("const invalidPrice = priceRequired");
    expect(liveHydration).toContain('submit.dataset.blocked = "invalid_ticket"');
    expect(liveHydration).toContain("window.__IUF_TICKET_LOCK_REASON__");
  });

  it("localizes selected sector labels before rendering the trading room header", () => {
    expect(liveHydration).toContain("sector: industryLabel(company?.chainPosition");
    expect(liveHydration).toContain("sector:industryLabel(company?.chainPosition");
    expect(liveHydration).toContain('setText(".symhead .meta", industryLabel(selected.sector');
  });

  it("keeps K-line overlays as real toggle controls instead of decorative labels", () => {
    expect(ticketHtml).toContain('type="button" class="tool on" data-layer="ma"');
    expect(ticketHtml).toContain('type="button" class="tool on" data-layer="vwap"');
    expect(ticketHtml).toContain("function syncToolLayers()");
    expect(ticketHtml).toContain("chart.dataset[layer]=isOn?'on':'off'");
  });

  it("surfaces KGI SIM quote auth unavailable instead of vague empty tables", () => {
    expect(liveHydration).toContain("gateway_quote_auth");
    expect(liveHydration).toContain("KGI_QUOTE_AUTH_UNAVAILABLE");
    expect(liveHydration).toContain("KGI SIM 已登入，行情權限未開");
    expect(liveHydration).toContain("hydrateKgiReadinessNote()");
  });

  it("allows the final-v031 backend proxy to read KGI SIM status", () => {
    expect(liveHydration).toContain('soft(apiGet("/api/v1/kgi/status"))');
    expect(backendProxy).toContain("^\\/api\\/v1\\/kgi\\/status");
  });
});
