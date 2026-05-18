#!/usr/bin/env python3
"""Append THEMES-MOJIBAKE tests to ci.test.ts (avoids linter revert of Edit tool)."""
import os

test_file = os.path.join(
    os.path.dirname(__file__), "..", "tests", "ci.test.ts"
)
test_file = os.path.abspath(test_file)

with open(test_file, "r", encoding="utf-8") as f:
    content = f.read()

# Check if already inserted
if "THEMES-MOJIBAKE-1" in content:
    print("Already inserted — no-op.")
    exit(0)

# The insertion point: before the Force-exit teardown after() block
INSERTION_MARKER = "// Force-exit teardown: tsx/esbuild service workers are not killed by node:test runner."

if INSERTION_MARKER not in content:
    print(f"ERROR: marker not found in {test_file}")
    exit(1)

NEW_TESTS = r"""
// ── THEMES-MOJIBAKE: CP950 mojibake detection + re-encode + write-time prevention ─
//
// These tests verify:
// 1. tryReencode correctly re-encodes CP950-as-Latin1 garbled strings back to CJK.
// 2. hasMojibakeCandidate correctly identifies mojibake candidates.
// 3. tryReencode returns ok=false for random invalid-CP950 byte sequences.
// 4. The admin handler works in memory-mode (graceful degradation).

test("THEMES-MOJIBAKE-1: tryReencode decodes known CP950 mojibake sequence for 低軌衛星", async () => {
  // "低軌衛星" in CP950 = bytes 0xa7,0x43,0xad,0x79,0xbd,0xc3,0xac,0x50
  // (verified via iconv-lite encode on 2026-05-18).
  // When those bytes are stored as Latin-1 chars in a JS string, fixCP950Mojibake
  // must re-decode them back to correct CJK.
  const cp950Bytes = Buffer.from([0xa7, 0x43, 0xad, 0x79, 0xbd, 0xc3, 0xac, 0x50]);
  const mojibake = cp950Bytes.toString("latin1"); // garbled Latin-1 view of CP950 bytes

  const { tryReencode } = await import("../apps/api/src/admin-themes-re-encode-mojibake.js") as
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    any;

  const result = tryReencode(mojibake);
  assert.ok(result.ok, "THEMES-MOJIBAKE-1: tryReencode should succeed for known CP950 sequence");
  assert.equal(result.fixed, "低軌衛星", "THEMES-MOJIBAKE-1: decoded value should be 低軌衛星");
});

test("THEMES-MOJIBAKE-2: hasMojibakeCandidate returns false for pure ASCII and correct UTF-8", async () => {
  const { hasMojibakeCandidate } = await import("../apps/api/src/admin-themes-re-encode-mojibake.js") as
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    any;

  assert.equal(hasMojibakeCandidate("5G connectivity"), false,
    "THEMES-MOJIBAKE-2: pure ASCII must not be flagged");
  assert.equal(hasMojibakeCandidate("低軌衛星"), false,
    "THEMES-MOJIBAKE-2: proper UTF-8 CJK must not be flagged (no high bytes in JS string)");
  assert.equal(hasMojibakeCandidate(null), false,
    "THEMES-MOJIBAKE-2: null must not be flagged");
  assert.equal(hasMojibakeCandidate(""), false,
    "THEMES-MOJIBAKE-2: empty string must not be flagged");

  // Build a string with high bytes (Latin-1 view of CP950 bytes) — should be flagged
  const highByteStr = Buffer.from([0xa7, 0x43]).toString("latin1");
  assert.equal(hasMojibakeCandidate(highByteStr), true,
    "THEMES-MOJIBAKE-2: string with \\x80-\\xff bytes must be flagged as mojibake candidate");
});

test("THEMES-MOJIBAKE-3: tryReencode returns ok=false for byte sequences that decode to replacement chars", async () => {
  const { tryReencode } = await import("../apps/api/src/admin-themes-re-encode-mojibake.js") as
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    any;

  // 0x81 0x80 is an invalid CP950 sequence (lead byte 0x81 followed by invalid trailer 0x80)
  // iconv-lite will emit a replacement char or silently fail.
  // The safety guard must not return ok=true with garbled output.
  const invalidBytes = Buffer.from([0x81, 0x80, 0x81]).toString("latin1");
  const result = tryReencode(invalidBytes);
  // Either ok=false OR ok=true with no replacement char (iconv-lite may still map something)
  // The critical assertion: no U+FFFD in result.fixed when ok=true
  if (result.ok) {
    assert.ok(!result.fixed.includes("�"),
      "THEMES-MOJIBAKE-3: if ok=true, fixed must not contain U+FFFD replacement char");
  } else {
    assert.equal(result.ok, false,
      "THEMES-MOJIBAKE-3: invalid CP950 byte sequence should return ok=false");
  }
});

test("THEMES-MOJIBAKE-4: handleAdminThemesReEncodeMojibake returns graceful error in memory-mode", async () => {
  // Memory mode: isDatabaseMode() = false, so the handler returns not_database_mode error.
  const { handleAdminThemesReEncodeMojibake } = await import("../apps/api/src/admin-themes-re-encode-mojibake.js") as
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    any;

  // Build a minimal Hono Context mock
  const mockSession = {
    user: { id: "user-1", name: "Test", email: "test@test.com", role: "Owner" },
    workspace: { id: "ws-1", slug: "test-ws" }
  };
  let capturedData: unknown = null;
  let capturedStatus: number = 200;
  const mockContext = {
    get: (key: string) => key === "session" ? mockSession : undefined,
    req: { json: async () => ({ dryRun: true }) },
    json: (data: unknown, status?: number) => {
      capturedData = data;
      capturedStatus = status ?? 200;
      return { _data: data, _status: capturedStatus };
    }
  };

  await handleAdminThemesReEncodeMojibake(mockContext);

  const responseData = capturedData as { data: { errors: string[]; dryRun: boolean; scannedRows: number } };
  assert.ok(Array.isArray(responseData.data.errors),
    "THEMES-MOJIBAKE-4: errors must be an array");
  assert.ok(
    responseData.data.errors.includes("not_database_mode"),
    "THEMES-MOJIBAKE-4: memory-mode must return not_database_mode error"
  );
  assert.equal(responseData.data.dryRun, true,
    "THEMES-MOJIBAKE-4: dryRun must be true (default)");
  assert.equal(responseData.data.scannedRows, 0,
    "THEMES-MOJIBAKE-4: scannedRows must be 0 in memory-mode");
});

"""

content = content.replace(INSERTION_MARKER, NEW_TESTS + INSERTION_MARKER)

with open(test_file, "w", encoding="utf-8") as f:
    f.write(content)

# Verify
with open(test_file, "r", encoding="utf-8") as f:
    verify = f.read()

assert "THEMES-MOJIBAKE-1" in verify, "THEMES-MOJIBAKE-1 not found after write"
assert "THEMES-MOJIBAKE-2" in verify, "THEMES-MOJIBAKE-2 not found after write"
assert "THEMES-MOJIBAKE-3" in verify, "THEMES-MOJIBAKE-3 not found after write"
assert "THEMES-MOJIBAKE-4" in verify, "THEMES-MOJIBAKE-4 not found after write"
print(f"OK: appended 4 THEMES-MOJIBAKE tests to {test_file}")
print(f"Total file size: {len(verify)} chars")
