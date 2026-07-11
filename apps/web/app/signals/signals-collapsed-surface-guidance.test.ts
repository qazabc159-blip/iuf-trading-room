/**
 * P1-5 (reports/product_critique_20260710/PRODUCT_CRITIQUE_v1.md): `/signals`
 * is already correctly demoted out of the sidebar/command-palette nav (see
 * lib/canonical-surfaces.ts LEGACY_WEB_SURFACES — disposition "grouped",
 * replacementPath "/ai-recommendations"), reachable only via a deep-link tab
 * from `/ai-recommendations` ("訊號中心"). What was still missing: every
 * non-content state of the page itself (`目前沒有訊號` / `資料來源暫停` /
 * `無可判讀訊號`) was a dead end with no way back to the canonical surface.
 *
 * Source-grep test (server component, no render harness in this repo — see
 * industry-heatmap-representatives.test.ts for the established convention).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sourcePath = fileURLToPath(new URL("./page.tsx", import.meta.url));
const source = readFileSync(sourcePath, "utf8");

describe("/signals collapsed-surface guidance", () => {
  it("declares itself as an /ai-recommendations sub-page in the page note", () => {
    expect(source).toContain("本頁為 AI 推薦頁「訊號中心」子頁，主要入口在 AI 推薦。");
  });

  it("gives every non-content state a way back to /ai-recommendations", () => {
    const backLinkCount = (source.match(/href="\/ai-recommendations" className="mini-button">前往 AI 推薦</g) ?? []).length;
    expect(backLinkCount).toBe(3);
  });
});
