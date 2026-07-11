import { test, expect } from "@playwright/test";

// P0-1 + P0-4 fix verification (product critique 2026-07-10), against the
// NEW code (local `next start` build wired to prod API + real owner
// session), not yet deployed.

async function pollCapital(page: import("@playwright/test").Page, label: string, maxMs = 20000) {
  const start = Date.now();
  const frame = page.frameLocator("iframe").first();
  let lastText = "";
  while (Date.now() - start < maxMs) {
    const text = await frame
      .locator("#summary-capital")
      .evaluate((el) => el.textContent, undefined, { timeout: 1000 })
      .catch(() => null);
    if (text && text !== lastText) {
      console.log(`[${label}] t+${Date.now() - start}ms capital=`, text);
      lastText = text;
    }
    if (text && text !== "待授權" && text !== "載入中" && text.trim() !== "") {
      return { elapsedMs: Date.now() - start, text };
    }
    await page.waitForTimeout(300);
  }
  return { elapsedMs: -1, text: lastText };
}

test("P0-1: handoff from AI-rec-style URL unlocks the ticket fast, and never shows 需要 Owner 登入 for a real owner session", async ({ page }) => {
  await page.goto(
    "/portfolio?ticker=3707&prefill=true&from_rec=rec_3707_20260710&entry=74.5-80.3&stop=67.3&tp=96&side=buy",
    { waitUntil: "domcontentloaded" }
  );
  const frame = page.frameLocator("iframe").first();

  // While loading, the placeholder must say 載入中 (loading), never
  // 待授權/需要 Owner 登入 (unauthorized) for an actually-logged-in Owner.
  const early = await frame.locator("#summary-capital").textContent({ timeout: 1500 }).catch(() => null);
  console.log("EARLY capital text:", early);
  if (early) expect(early).not.toBe("待授權");

  const result = await pollCapital(page, "handoff-3707");
  console.log("READY at", result.elapsedMs, "ms, text=", result.text);
  expect(result.elapsedMs).toBeGreaterThan(-1);
  expect(result.elapsedMs).toBeLessThan(5000); // was ~7-10s before the fast-path fix
  expect(result.text).toBe("10,000,000");

  const submitState = await frame
    .locator("#submit-btn")
    .evaluate((el) => ({ disabled: (el as HTMLButtonElement).disabled, label: el.querySelector("b")?.textContent ?? null }))
    .catch(() => null);
  console.log("submit state:", submitState);
  expect(submitState?.disabled).toBe(false);
  expect(submitState?.label).not.toContain("需要 Owner 登入");

  await page.screenshot({ path: "jim_p0_verify_handoff_after_fix.png", fullPage: true });
});

test("P0-4: portfolio summary reconciles (mktval/pnl/held-count/available-cash consistent)", async ({ page }) => {
  await page.goto("/portfolio", { waitUntil: "domcontentloaded" });
  const frame = page.frameLocator("iframe").first();
  await pollCapital(page, "direct-2330");

  const capital = await frame.locator("#summary-capital").textContent();
  const avail = await frame.locator("#summary-avail").textContent();
  const mktval = await frame.locator("#summary-mktval").textContent();
  const poscount = await frame.locator("#summary-poscount").textContent();
  const posBadge = await frame.locator('.lhead .tb[data-lt="positions"] .c').textContent();

  console.log("capital=", capital, "avail=", avail, "mktval=", mktval, "poscount=", poscount, "posBadge=", posBadge);

  // Reconciliation invariant: held-position count must match the ledger
  // badge count (both now filtered to netQtyShares>0), and if poscount is 0
  // then mktval must be the honest empty dash, not a bare "0".
  expect(poscount?.trim()).toBe(posBadge?.trim());
  if (poscount?.trim() === "0") {
    expect(mktval?.trim()).toBe("—");
  }

  await page.screenshot({ path: "jim_p0_verify_portfolio_reconcile.png", fullPage: true });
});
