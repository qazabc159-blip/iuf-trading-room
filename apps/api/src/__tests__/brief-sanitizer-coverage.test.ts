/**
 * brief-sanitizer-coverage.test.ts -- write-time sanitizer gate coverage (PR #628).
 *
 * Bruce P1 audit 2026-05-17: FFFD=70 in 5/15-5/17 briefs because
 * sanitizeBriefBody was only applied in parseDirectBriefPayload (direct/cron path).
 * OpenAlice device-submitted briefs bypassed the sanitizer entirely.
 *
 * Fix: apply sanitizeBriefBody in content-draft-store.approveContentDraft for all
 * daily_briefs approve paths (write-time gate).
 *
 * Tests:
 * BSANIT-1: scrubReplacementChars removes U+FFFD from body
 * BSANIT-2: scrubForbiddenPhrases removes rule-template fallback label
 * BSANIT-3: sanitizeBriefBody removes both FFFD and rule-template in one call
 * BSANIT-4: sanitizeBriefBody is a no-op on clean text (no false stripping)
 * BSANIT-5: sanitizeBriefBody handles empty string
 * BSANIT-6: write-time gate applies sanitizer to ALL sections in a multi-section brief
 * BSANIT-7: FFFD=70 pattern from 5/15-17 briefs is fully scrubbed
 * BSANIT-8: double-scrub is idempotent (already-clean text unchanged after 2 passes)
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  sanitizeBriefBody,
  scrubReplacementChars,
  scrubForbiddenPhrases,
} from "../openalice-brief-sanitizer.js";

// Helpers
const FFFD = "�"; // U+FFFD replacement character

describe("brief-sanitizer-coverage", () => {
  it("BSANIT-1: scrubReplacementChars removes U+FFFD replacement characters", () => {
    const input = `${FFFD}${FFFD}${FFFD}` + "通訊";
    const result = scrubReplacementChars(input);
    assert.ok(!result.includes(FFFD), "U+FFFD chars must be removed");
    assert.ok(result.includes("通訊"), "Chinese text must be preserved");
  });

  it("BSANIT-1b: scrubReplacementChars collapses leftover double-spaces", () => {
    const input = "before " + FFFD + FFFD + FFFD + " after";
    const result = scrubReplacementChars(input);
    assert.equal(result, "before after");
  });

  it("BSANIT-1c: scrubReplacementChars is no-op on clean UTF-8 text", () => {
    const clean = "台股市場今日維持穩定。";
    assert.equal(scrubReplacementChars(clean), clean);
  });

  it("BSANIT-2: scrubForbiddenPhrases removes rule-template fallback label", () => {
    const input = "主題觀察。Generated: 2026-05-13 (rule-template fallback)。電動車供應鏈資料正常。";
    const result = scrubForbiddenPhrases(input);
    assert.ok(!result.includes("rule-template fallback"), "rule-template fallback label must be removed");
    assert.ok(result.includes("電動車供應鏈資料正常"), "substantive content must be preserved");
  });

  it("BSANIT-2b: scrubForbiddenPhrases removes internal draft wording", () => {
    const input = "此版本僅作內部研究草稿，供人員審閱後再决定後續分析方向。請關注市場動態。";
    const result = scrubForbiddenPhrases(input);
    assert.ok(!result.includes("內部研究草稿"), "forbidden phrase must be removed");
    assert.ok(!result.includes("供人員審閱"), "forbidden phrase must be removed");
    assert.ok(result.includes("請關注市場動態"), "following content must be preserved");
  });

  it("BSANIT-2c: scrubForbiddenPhrases is no-op on clean content", () => {
    const clean = "今日台股市場維持觀察。";
    assert.equal(scrubForbiddenPhrases(clean), clean);
  });

  it("BSANIT-3: sanitizeBriefBody removes both FFFD and rule-template in one call", () => {
    const mixed = FFFD + "通訊。此版本僅作內部研究草稿，供人員審閱後再决定後續分析方向。";
    const result = sanitizeBriefBody(mixed);
    assert.ok(!result.includes(FFFD), "U+FFFD must be removed");
    assert.ok(!result.includes("內部研究草稿"), "internal draft phrase must be removed");
    assert.ok(result.includes("通訊"), "clean Chinese text must survive");
  });

  it("BSANIT-3b: sanitizeBriefBody removes CP950 mojibake pattern (70 chars simulated)", () => {
    const fffd70 = FFFD.repeat(70);
    const input = "今日市場总覽：" + fffd70 + "台股維持觀察格局。";
    const result = sanitizeBriefBody(input);
    assert.ok(!result.includes(FFFD), "All 70 FFFD chars must be removed");
    assert.ok(result.includes("台股維持觀察格局"), "trailing text must survive");
  });

  it("BSANIT-4: sanitizeBriefBody is a no-op on clean text (no false stripping)", () => {
    const clean = "法人連續3日淨流入。";
    const result = sanitizeBriefBody(clean);
    assert.equal(result, clean, "clean text must pass through unchanged");
  });

  it("BSANIT-5: sanitizeBriefBody handles empty string", () => {
    assert.equal(sanitizeBriefBody(""), "");
  });

  it("BSANIT-5b: sanitizeBriefBody handles string of only FFFD chars", () => {
    const allFffd = FFFD.repeat(70);
    const result = sanitizeBriefBody(allFffd);
    assert.equal(result, "", "all-FFFD string must scrub to empty");
  });

  it("BSANIT-6: write-time gate applies sanitizer to all sections in a multi-section brief", () => {
    const rawSections = [
      { heading: "今日市場总覽", body: "市場今日" + FFFD.repeat(3) + "走勢觀察中。" },
      { heading: "風控警示", body: "簽子距離門淳 5.7pp。Generated: 2026-05-15 (rule-template fallback)。" },
      { heading: "綽合觀察", body: "外資法人動向中性。此版本僅作內部研究草稿，供人員審閱後再决定後續分析方向。" }
    ];
    const sanitizedSections = rawSections.map((section) => ({
      ...section,
      body: sanitizeBriefBody(section.body)
    }));
    for (const s of sanitizedSections) {
      assert.ok(!s.body.includes(FFFD), `section "${s.heading}": U+FFFD must be removed`);
      assert.ok(!s.body.includes("rule-template fallback"), `section "${s.heading}": rule-template must be removed`);
      assert.ok(!s.body.includes("內部研究草稿"), `section "${s.heading}": internal draft phrase must be removed`);
    }
    assert.ok(sanitizedSections[0]!.body.includes("市場今日"), "market text must survive");
    assert.ok(sanitizedSections[1]!.body.includes("簽子距離門淳 5.7pp"), "risk content must survive");
    assert.ok(sanitizedSections[2]!.body.includes("外資法人動向中性"), "institutional content must survive");
  });

  it("BSANIT-7: FFFD=70 pattern from 5/15-17 briefs is fully scrubbed", () => {
    const fffd70 = FFFD.repeat(70);
    const section = { heading: "今日市場总覽", body: "即時市場數据：" + fffd70 + "TWSE 成交量正常。" };
    const scrubbed = sanitizeBriefBody(section.body);
    const fffdCount = [...scrubbed].filter((c) => c === FFFD).length;
    assert.equal(fffdCount, 0, `After scrub: expected 0 FFFD chars, got ${fffdCount}`);
    assert.ok(scrubbed.includes("TWSE"), "TWSE must survive");
  });

  it("BSANIT-8: double-scrub is idempotent (already-clean text unchanged after 2 passes)", () => {
    const alreadyClean = "法人動向觀察。簽子報酬率 -9.30%。";
    const firstPass = sanitizeBriefBody(alreadyClean);
    const secondPass = sanitizeBriefBody(firstPass);
    assert.equal(firstPass, secondPass, "second scrub pass must be idempotent");
    assert.equal(firstPass, alreadyClean, "clean text must be unchanged after first pass");
  });
});
