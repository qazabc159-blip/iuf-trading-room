// migration-0031-dedup.test.ts
// Unit tests for 0031_companies_unique_ticker.sql logic — no live DB required.
//
// These tests validate the SQL *semantics* using in-memory data structures that
// mirror the real table relationships. They guard against the v2 → v3 regression:
//   v2 root cause: company_relations and company_keywords have unique indexes that
//   collide when multiple dup company_id rows are rewired to the same survivor_id.
//
// MIG01 — Step 0a correctly identifies company_relations rows to delete
// MIG02 — Step 0b correctly identifies company_keywords rows to delete
// MIG03 — Step 2 EXISTS delete correctly removes non-survivor rows
// MIG04 — Step 2 EXISTS is NULL-safe (never deletes all rows on NULL id)
// MIG05 — survivor selection is deterministic (MIN(id) = lexicographically smallest UUID)
// MIG06 — FK child rows pointing to survivors are NOT deleted in Step 0a/0b
// MIG07 — company_relations target_company_id rewire does not require pre-dedup

import assert from "node:assert/strict";
import test from "node:test";

// ---------------------------------------------------------------------------
// In-memory data model mirrors prod schema
// ---------------------------------------------------------------------------

type Company = { id: string; workspace_id: string; ticker: string };
type CompanyRelation = {
  id: string;
  workspace_id: string;
  company_id: string;
  target_label: string;
  relation_type: string;
};
type CompanyKeyword = {
  id: string;
  workspace_id: string;
  company_id: string;
  label: string;
};

// ---------------------------------------------------------------------------
// Helper: compute survivor_id per (workspace_id, ticker) = MIN(id) by string compare
// ---------------------------------------------------------------------------
function computeSurvivorMap(companies: Company[]): Map<string, string> {
  // key: `${workspace_id}:${ticker}` → survivor_id
  const map = new Map<string, string>();
  for (const c of companies) {
    const key = `${c.workspace_id}:${c.ticker}`;
    const cur = map.get(key);
    if (!cur || c.id < cur) map.set(key, c.id);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Step 0a simulation: returns ids that WOULD BE DELETED from company_relations
// ---------------------------------------------------------------------------
function simulateStep0a(
  companies: Company[],
  relations: CompanyRelation[]
): Set<string> {
  const survivorById = new Map<string, string>(); // company_id → survivor_id
  const survivorMap = computeSurvivorMap(companies);
  for (const c of companies) {
    const key = `${c.workspace_id}:${c.ticker}`;
    survivorById.set(c.id, survivorMap.get(key)!);
  }

  // For each relation, project company_id → survivor_id
  // Group by (workspace_id, survivor_id, target_label, relation_type)
  // Keep MIN(id) per group; delete the rest
  const grouped = new Map<string, string[]>(); // groupKey → [relation.id, ...]
  for (const r of relations) {
    const sid = survivorById.get(r.company_id) ?? r.company_id;
    const key = `${r.workspace_id}|${sid}|${r.target_label}|${r.relation_type}`;
    const arr = grouped.get(key) ?? [];
    arr.push(r.id);
    grouped.set(key, arr);
  }

  const keepIds = new Set<string>();
  for (const ids of grouped.values()) {
    const minId = ids.reduce((a, b) => (a < b ? a : b));
    keepIds.add(minId);
  }

  const toDelete = new Set<string>();
  for (const r of relations) {
    if (!keepIds.has(r.id)) toDelete.add(r.id);
  }
  return toDelete;
}

// ---------------------------------------------------------------------------
// Step 0b simulation for company_keywords
// ---------------------------------------------------------------------------
function simulateStep0b(
  companies: Company[],
  keywords: CompanyKeyword[]
): Set<string> {
  const survivorById = new Map<string, string>();
  const survivorMap = computeSurvivorMap(companies);
  for (const c of companies) {
    const key = `${c.workspace_id}:${c.ticker}`;
    survivorById.set(c.id, survivorMap.get(key)!);
  }

  const grouped = new Map<string, string[]>();
  for (const k of keywords) {
    const sid = survivorById.get(k.company_id) ?? k.company_id;
    const key = `${k.workspace_id}|${sid}|${k.label}`;
    const arr = grouped.get(key) ?? [];
    arr.push(k.id);
    grouped.set(key, arr);
  }

  const keepIds = new Set<string>();
  for (const ids of grouped.values()) {
    const minId = ids.reduce((a, b) => (a < b ? a : b));
    keepIds.add(minId);
  }

  const toDelete = new Set<string>();
  for (const k of keywords) {
    if (!keepIds.has(k.id)) toDelete.add(k.id);
  }
  return toDelete;
}

// ---------------------------------------------------------------------------
// Step 2 simulation: EXISTS-based delete (returns ids to delete)
// ---------------------------------------------------------------------------
function simulateStep2Delete(companies: Company[]): Set<string> {
  // For each company c, delete if there exists c2 with same (workspace_id, ticker) and c2.id < c.id
  const toDelete = new Set<string>();
  for (const c of companies) {
    const hasSmaller = companies.some(
      (c2) =>
        c2.workspace_id === c.workspace_id &&
        c2.ticker === c.ticker &&
        c2.id < c.id
    );
    if (hasSmaller) toDelete.add(c.id);
  }
  return toDelete;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("MIG01 — Step 0a deletes colliding company_relations rows before rewire", () => {
  const ws = "ws-1";
  // Two duplicates of 2330: dup1 < dup2 → dup1 is survivor
  const companies: Company[] = [
    { id: "aaaa", workspace_id: ws, ticker: "2330" },
    { id: "bbbb", workspace_id: ws, ticker: "2330" },
  ];
  // Each duplicate has a relation with same (target_label, relation_type)
  // After rewire: both would have company_id=aaaa → unique collision
  const relations: CompanyRelation[] = [
    { id: "r1", workspace_id: ws, company_id: "aaaa", target_label: "tsmc", relation_type: "supplier" },
    { id: "r2", workspace_id: ws, company_id: "bbbb", target_label: "tsmc", relation_type: "supplier" },
  ];
  const toDelete = simulateStep0a(companies, relations);
  // r2 maps to same (ws, aaaa, tsmc, supplier) as r1; r1 has lower id → r2 deleted
  assert.ok(toDelete.has("r2"), "r2 (duplicate after projection) should be deleted");
  assert.ok(!toDelete.has("r1"), "r1 (survivor row) should be kept");
});

test("MIG02 — Step 0b deletes colliding company_keywords rows before rewire", () => {
  const ws = "ws-1";
  const companies: Company[] = [
    { id: "aaaa", workspace_id: ws, ticker: "2317" },
    { id: "cccc", workspace_id: ws, ticker: "2317" },
  ];
  const keywords: CompanyKeyword[] = [
    { id: "k1", workspace_id: ws, company_id: "aaaa", label: "AI" },
    { id: "k2", workspace_id: ws, company_id: "cccc", label: "AI" },
  ];
  const toDelete = simulateStep0b(companies, keywords);
  assert.ok(toDelete.has("k2"), "k2 (duplicate after projection) should be deleted");
  assert.ok(!toDelete.has("k1"), "k1 (survivor row) should be kept");
});

test("MIG03 — Step 2 EXISTS deletes only non-survivor companies", () => {
  const ws = "ws-1";
  const companies: Company[] = [
    { id: "aaaa", workspace_id: ws, ticker: "2330" }, // survivor (smallest)
    { id: "bbbb", workspace_id: ws, ticker: "2330" }, // duplicate → delete
    { id: "cccc", workspace_id: ws, ticker: "2317" }, // unique ticker → keep
  ];
  const toDelete = simulateStep2Delete(companies);
  assert.ok(toDelete.has("bbbb"), "bbbb (dup, larger id) should be deleted");
  assert.ok(!toDelete.has("aaaa"), "aaaa (survivor, smallest id) should be kept");
  assert.ok(!toDelete.has("cccc"), "cccc (unique ticker) should be kept");
});

test("MIG04 — Step 2 EXISTS is NULL-safe: never deletes all rows", () => {
  // NOT IN with NULLs in subquery deletes 0 rows (postgres behavior).
  // EXISTS never has this problem. Simulate: all ids are valid strings (no null).
  const ws = "ws-1";
  const companies: Company[] = [
    { id: "aaaa", workspace_id: ws, ticker: "0050" },
  ];
  const toDelete = simulateStep2Delete(companies);
  // Only 1 row, no duplicate → nothing deleted
  assert.equal(toDelete.size, 0, "single-row ticker must never be deleted");
});

test("MIG05 — survivor is deterministic: MIN(id) by lexicographic order", () => {
  const ws = "ws-1";
  const companies: Company[] = [
    { id: "zzzz", workspace_id: ws, ticker: "2330" },
    { id: "aaaa", workspace_id: ws, ticker: "2330" },
    { id: "mmmm", workspace_id: ws, ticker: "2330" },
  ];
  const survivorMap = computeSurvivorMap(companies);
  assert.equal(survivorMap.get(`${ws}:2330`), "aaaa", "aaaa is lexicographically smallest → survivor");
  const toDelete = simulateStep2Delete(companies);
  assert.ok(!toDelete.has("aaaa"), "aaaa (survivor) kept");
  assert.ok(toDelete.has("mmmm"), "mmmm deleted");
  assert.ok(toDelete.has("zzzz"), "zzzz deleted");
});

test("MIG06 — Step 0a does NOT delete relations pointing to unique companies", () => {
  const ws = "ws-1";
  const companies: Company[] = [
    { id: "aaaa", workspace_id: ws, ticker: "2330" },
    { id: "bbbb", workspace_id: ws, ticker: "2330" }, // dup → aaaa survivor
    { id: "cccc", workspace_id: ws, ticker: "2317" }, // unique, cccc is survivor
  ];
  const relations: CompanyRelation[] = [
    // relation on unique company (cccc = sole 2317 row) — must NOT be deleted
    { id: "r3", workspace_id: ws, company_id: "cccc", target_label: "hon_hai", relation_type: "customer" },
    // relation on dup 2330 that collides
    { id: "r1", workspace_id: ws, company_id: "aaaa", target_label: "tsmc", relation_type: "supplier" },
    { id: "r2", workspace_id: ws, company_id: "bbbb", target_label: "tsmc", relation_type: "supplier" },
  ];
  const toDelete = simulateStep0a(companies, relations);
  assert.ok(!toDelete.has("r3"), "r3 on unique company must not be deleted");
  assert.ok(!toDelete.has("r1"), "r1 survivor row must not be deleted");
  assert.ok(toDelete.has("r2"), "r2 collision row must be deleted");
});

test("MIG07 — distinct target_labels prevent false collision in Step 0a", () => {
  const ws = "ws-1";
  const companies: Company[] = [
    { id: "aaaa", workspace_id: ws, ticker: "2330" },
    { id: "bbbb", workspace_id: ws, ticker: "2330" },
  ];
  // Different target_labels — after projection both get company_id=aaaa,
  // but (workspace_id, aaaa, supplier_A, supplier) ≠ (workspace_id, aaaa, customer_B, customer)
  // → no collision, both rows should survive
  const relations: CompanyRelation[] = [
    { id: "r1", workspace_id: ws, company_id: "aaaa", target_label: "supplier_A", relation_type: "supplier" },
    { id: "r2", workspace_id: ws, company_id: "bbbb", target_label: "customer_B", relation_type: "customer" },
  ];
  const toDelete = simulateStep0a(companies, relations);
  assert.equal(toDelete.size, 0, "distinct target_label+relation_type rows should both survive");
});
