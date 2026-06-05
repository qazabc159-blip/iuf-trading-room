import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const pageSource = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

describe("settings index page", () => {
  it("keeps /settings as a real customer settings hub instead of a 404", () => {
    expect(pageSource).toContain("設定中心");
    expect(pageSource).toContain('href: "/settings/account"');
    expect(pageSource).toContain('href: "/settings/broker"');
    expect(pageSource).toContain('href: "/settings/subscription"');
  });

  it("states broker and order safety boundaries in customer language", () => {
    expect(pageSource).toContain("KGI SIM");
    expect(pageSource).toContain("KGI 唯讀");
    expect(pageSource).toContain("正式下單目前維持停用");
    expect(pageSource).toContain("Real Order 仍維持鎖定");
    expect(pageSource).not.toMatch(/localStorage|AWS SSM|sim_person_pwd|type="password"/);
  });
});
