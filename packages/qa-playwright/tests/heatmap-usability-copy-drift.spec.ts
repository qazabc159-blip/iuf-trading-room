/**
 * heatmap-usability-copy-drift.spec.ts
 * ──────────────────────────────────────
 * QA misc batch ticket #1 (Pete-13 review 🟡#1, 2026-07-24). Read-only: this
 * spec NEVER writes to either file. It reads apps/web/lib's real source text
 * and diffs it against this package's local copy
 * (heatmap-tile-usability-copy.ts), so a future change to the real
 * predicate that isn't mirrored into the copy fails loud here instead of
 * checkHeatmapUpstreamCoverage() (helpers.ts) silently drifting back into a
 * second, stale copy of the same criteria — the exact problem this ticket
 * fixed. Same "read the other side's raw source text" technique as
 * apps/web/app/companies/[symbol]/ai-analyst-report-panel.test.ts's
 * backend/frontend display-gate parity test (PR #1341).
 *
 * Not run against a browser — no `page` fixture used — but still discovered
 * by the desktop-chromium/mobile-iphone-13 projects same as every other spec
 * in this directory (playwright.config.ts has no narrower testMatch for
 * "pure logic" specs), so it runs after the "setup" project same as always.
 */
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

// Anchored to the START of a line (not a bare substring search) — both this
// spec's own doc comment above and heatmap-tile-usability-copy.ts's header
// comment reference the anchor text in prose (inside backticks, mid-line),
// which a plain `indexOf` would match FIRST and produce a false span. A
// line-start match skips those since the real declaration is the only place
// this exact text begins a line.
const SYNC_ANCHOR_LINE = /^export type HeatmapUsabilityTile/m;

function sourceOfTruthSpan(fileText: string, fileLabel: string): string {
  const match = SYNC_ANCHOR_LINE.exec(fileText);
  if (!match) {
    throw new Error(`"export type HeatmapUsabilityTile" line not found in ${fileLabel} — sync anchor itself has drifted`);
  }
  // Normalize CRLF→LF: this repo checks out with mixed line endings
  // depending on how a given file was last written (git core.autocrlf vs.
  // tooling that writes LF directly) — that's an incidental
  // editor/OS artifact, not a real content drift this spec should flag.
  return fileText.slice(match.index).replace(/\r\n/g, "\n").trim();
}

test.describe("heatmap-tile-usability-copy.ts stays in sync with apps/web/lib/heatmap-tile-usability.ts", () => {
  test("deriveHeatmapMove / isUsableHeatmapTile copy is byte-identical to the real apps/web source, from the sync anchor to end of file", () => {
    const realSource = readFileSync(
      new URL("../../../apps/web/lib/heatmap-tile-usability.ts", import.meta.url),
      "utf8"
    );
    const copySource = readFileSync(new URL("./heatmap-tile-usability-copy.ts", import.meta.url), "utf8");

    const real = sourceOfTruthSpan(realSource, "apps/web/lib/heatmap-tile-usability.ts");
    const copy = sourceOfTruthSpan(copySource, "heatmap-tile-usability-copy.ts");

    expect(
      copy,
      "heatmap-tile-usability-copy.ts has drifted from apps/web/lib/heatmap-tile-usability.ts — " +
        "copy the real file's content verbatim from the `export type HeatmapUsabilityTile` line " +
        "onward into heatmap-tile-usability-copy.ts to resync."
    ).toBe(real);
  });
});
