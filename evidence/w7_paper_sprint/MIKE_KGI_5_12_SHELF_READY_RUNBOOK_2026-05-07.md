-- Mike Migration Auditor | KGI 5/12 Shelf-Ready Prep | 2026-05-07
-- Frame: Pure documentation + design prep. 0 production code written. 0 KGI live calls.

# KGI 5/12 SHELF-READY RUNBOOK

Auditor: Mike
Date: 2026-05-07
Sprint: W7 Paper Sprint

---

## A. 0024-0026 PROMOTE PR STATUS (disk-verified 2026-05-07 23:xx TST)

| # | File on disk | .DRAFT. infix? | migrate.ts will pick up? | Audit verdict |
|---|---|---|---|---|
| 0024 | 0024_finmind_market_intel.sql | NO | YES | APPROVED (PR #264 BLOCK #6 re-audit) |
| 0024 | 0024_finmind_market_intel.down.sql | -- | paired | YES |
| 0025 | 0025_iuf_events.sql | NO | YES | APPROVED (PR #267 BLOCK #6) |
| 0025 | 0025_iuf_events.down.sql | -- | paired | YES |
| 0026 | 0026_iuf_notification_preferences.sql | NO | YES | APPROVED (PR #268 BLOCK #6) |
| 0026 | 0026_iuf_notification_preferences.down.sql | -- | paired | YES |

Conclusion: 0024-0026 are fully promoted on disk. migrate.ts filter confirmed active (scripts/migrate.ts:24).
Outstanding nit on 0026: iuf_notif_prefs_user_idx is redundant with UNIQUE(user_id) — P6 pattern.
Not a blocker. Can be dropped in a future cleanup migration.

0027-0030 NOT YET WRITTEN. Slot numbers reserved. Design proposal in section D.

> ⚠️ **2026-05-08 RENUMBER**: PR #325 took 0027 for `brief_search_index`. KGI write-side schemas
> shift to **0028-0031** (kgi_orders → 0028, kgi_fills → 0029, kgi_positions → 0030, kgi_reconciliation → 0031).
> Mike audit MIKE_MIGRATION_0027_AUDIT_2026-05-08 documented the collision. When promoting these,
> Jason must rename schema files + update the section D headings below, but design content is unchanged.

---

## B. 5/12 ACTUAL-DAY PLAYBOOK (11 steps ordered)

Step 1 — PREREQ: Confirm TradeCom element permission enabled by KGI 業務員.
  Verify: services/kgi-gateway/scripts/diagnose_sim_login.py exits with success (not code 78).
  Owner: 楊董 (business action, not technical).

Step 2 — PREREQ: Confirm 電子下單密碼 (not web login password) is the correct person_pwd.
  Verify: diagnose_sim_login.py log line "IsSucceed / FIsLogon" = true.
  Note: kgi_session.py bug — getattr FIsLogon vs IsSucceed — may need Jason 1-line fix (separate PR).

Step 3 — PREREQ: SuperPy API status verified (code 79 = already applied for, per handoff).
  Verify: diagnose_sim_login.py does NOT return code 79. If still 79, escalate to 業務員.

Step 4 — sim login E2E dry-run.
  Script: diagnose_sim_login.py with ENVIRONMENT=simulation.
  Expected: login success + quote read (read-only, no order submission).
  If PASS → proceed. If FAIL → stop, diagnose, do NOT proceed to live.

Step 5 — migrate.ts apply 0025+0026 to production DB.
  Command: pnpm run migrate (with PERSISTENCE_MODE=database DATABASE_URL=prod).
  Verify: SELECT table_name FROM information_schema.tables WHERE table_name IN ('iuf_events','iuf_notification_preferences');
  Expected: 2 rows returned. If 0 rows → migration did not apply, stop.

Step 6 — 0027-0030 KGI write-side migrations: 楊董 ack required before Jason writes DRAFT files.
  These 4 migrations are NOT written yet (by design — stop-line: KGI write-side frozen).
  On 5/12 楊董 must explicitly ack "write KGI order migrations" before Jason proceeds.

Step 7 — 4-layer risk config verify.
  Check: account / strategy / symbol limits are set for the 5/12 test trade.
  Suggested limits for first live trade: max position = 1 share / 0050 ETF only / per-symbol cap = 20000 TWD.

Step 8 — Paper → sim → live progression order (MANDATORY).
  Must pass in sequence, NO skipping:
    paper (killSwitch=OFF, paper endpoint) → sim (KGI sim environment) → live (KGI live environment).
  Do NOT flip to live directly without sim PASS.

Step 9 — Kill switch confirm.
  Verify: KILL_SWITCH env var = true before proceeding to any KGI order submission.
  First live trade: 楊董 manually sets KILL_SWITCH=false only at time of intentional first order.
  After trade: reset KILL_SWITCH=true immediately.

Step 10 — First live trade: 0050 ETF 1 share (odd-lot).
  Quantity: 1 share. Unit: SHARE (odd-lot). Capital: ~20k TWD exposure.
  See section F for risk framing.

Step 11 — Post-trade reconciliation.
  After order ACK: verify kgi_fills + kgi_positions (once 0027-0030 are promoted and live).
  If position not reflected within 5 min: trigger reconciliation sweep (kgi_reconciliation table).
  If mismatch: stop all trading, escalate.

---

## C. THREE PREREQ CHECKS (person_id / TradeCom / simulation)

### C1: person_id case sensitivity
Rule (from feedback_kgi_env_var_uppercase_rule.md + Phase 0 翻盤 2026-04-23):
  KGI person_id IS case-sensitive. Use UPPERCASE exactly as KGI account registered.
  Phase 0 root cause was lowercase person_id. Must not regress.
Check: grep -r "person_id" services/kgi-gateway/config/ — confirm value is UPPERCASE.
Env var: KGI_PERSON_ID (Railway env). Must match KGI account ID letter-for-letter.

### C2: TradeCom element permission
Status as of 2026-05-07: NOT ENABLED (code 78).
What it is: A KGI backend permission flag enabling DLL-level API access (TradeCom component).
How to fix: 楊董 → email/call 業務員 → request TradeCom 元件使用授權 for account KGI_PERSON_ID.
Draft letter: services/kgi-gateway/scripts/KGI_SUPPORT_QUESTION_DRAFT.md
Timeline: typically same-day to 1 business day.
Verify: diagnose_sim_login.py returns NO code 78 after enable.

### C3: simulation vs live switch
Two environments, independently gated:
  sim: ENVIRONMENT=simulation — KGI test environment, no real money. Use for all dry-runs.
  live: ENVIRONMENT=live — real money, real fills. Only after sim PASS + 楊董 ack.
Both environments require:
  - TradeCom permission enabled
  - person_id correct (case-sensitive)
  - 電子下單密碼 (not web login password)
Stop-line: do NOT switch to live until sim E2E is clean (login + quote + paper order ACK).

---

## D. 0027-0030 SCHEMA DESIGN PROPOSAL

### Design constraints (from anti-pattern playbook P7/P8/P9)
- quantity_unit: NOT NULL, NO DEFAULT. Caller must pass 'SHARE' or 'LOT'. (P7)
- user_id: NO FK to users(id). KGI order user_id = auth-layer UUID, may not have a users row. (P8)
- No KGI credentials (person_id/person_pwd) in any column default or comment. (P9)
- kgi_deal_id source: confirmed from KGI SDK — kgi_deal_id comes from fill ACK payload, not order submission. (design assumption: nullable at insert, populated on fill event)

### 0027_kgi_orders
Purpose: one row per KGI order submission attempt.
Columns:
  id UUID PK DEFAULT gen_random_uuid()
  idempotency_key TEXT NOT NULL UNIQUE          -- caller-generated, prevents double-submit
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT
  user_id UUID NOT NULL                         -- NO FK (auth-layer UUID, see P8)
  symbol TEXT NOT NULL
  side TEXT NOT NULL CHECK (side IN ('BUY','SELL'))
  quantity INTEGER NOT NULL CHECK (quantity > 0)
  quantity_unit TEXT NOT NULL CHECK (quantity_unit IN ('SHARE','LOT'))  -- NO DEFAULT (P7)
  price NUMERIC(12,2) NULL                      -- NULL = market order
  order_type TEXT NOT NULL DEFAULT 'LIMIT' CHECK (order_type IN ('LIMIT','MARKET'))
  kgi_order_id TEXT NULL                        -- populated after KGI ACK; NULL until confirmed
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','SUBMITTED','FILLED','PARTIAL_FILL','CANCELLED','REJECTED','ERROR'))
  submitted_at TIMESTAMPTZ NULL
  filled_at TIMESTAMPTZ NULL
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
Indexes:
  UNIQUE (idempotency_key)                      -- dedup at DB level, covered by UNIQUE index
  idx ON (workspace_id, status, created_at DESC) -- main query: pending orders per workspace
  idx ON (user_id, created_at DESC)             -- user order history
  idx ON (symbol, created_at DESC)              -- per-symbol order history
  idx ON (kgi_order_id) WHERE kgi_order_id IS NOT NULL  -- fill lookup by KGI native id
Down: DROP TABLE IF EXISTS kgi_orders;

### 0028_kgi_fills
Purpose: one row per fill event received from KGI.
Columns:
  id UUID PK DEFAULT gen_random_uuid()
  order_id UUID NOT NULL REFERENCES kgi_orders(id) ON DELETE RESTRICT
  kgi_deal_id TEXT NOT NULL UNIQUE              -- KGI native deal/fill ID (from fill ACK payload)
  fill_qty INTEGER NOT NULL CHECK (fill_qty > 0)
  fill_price NUMERIC(12,2) NOT NULL
  fill_time TIMESTAMPTZ NOT NULL
  raw_payload JSONB NOT NULL DEFAULT '{}'       -- full KGI fill event, audit trail
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
Indexes:
  UNIQUE (kgi_deal_id)                         -- prevents duplicate fill inserts (idempotent ingest)
  idx ON (order_id, fill_time DESC)            -- fills per order
Down: DROP TABLE IF EXISTS kgi_fills;

### 0029_kgi_positions
Purpose: current KGI account position state (swept/reconciled).
Columns:
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT
  account_id TEXT NOT NULL                      -- KGI account ID (string, not FK)
  symbol TEXT NOT NULL
  qty_long INTEGER NOT NULL DEFAULT 0
  qty_short INTEGER NOT NULL DEFAULT 0
  qty_sellable INTEGER NOT NULL DEFAULT 0       -- broker-reported sellable qty (may differ from long due to T+1)
  avg_cost NUMERIC(12,4) NULL
  last_swept_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  PRIMARY KEY (workspace_id, account_id, symbol)
Indexes:
  idx ON (workspace_id, account_id)             -- all positions for an account
Down: DROP TABLE IF EXISTS kgi_positions;

### 0030_kgi_reconciliation
Purpose: audit log of reconciliation sweeps comparing IUF vs KGI position state.
Columns:
  id UUID PK DEFAULT gen_random_uuid()
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT
  sweep_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  symbol TEXT NULL                              -- NULL = full-account sweep
  iuf_qty INTEGER NULL
  kgi_qty INTEGER NULL
  status TEXT NOT NULL CHECK (status IN ('MATCH','DRIFT','ERROR','UNKNOWN'))
  drift_amount INTEGER NULL                     -- iuf_qty - kgi_qty when DRIFT
  notes TEXT NULL
  raw_payload JSONB NOT NULL DEFAULT '{}'
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
Indexes:
  idx ON (workspace_id, sweep_at DESC)          -- recent sweeps per workspace
  idx ON (workspace_id, symbol, sweep_at DESC)  -- per-symbol history
  idx ON (status, sweep_at DESC) WHERE status != 'MATCH'  -- partial: only non-match rows
Down: DROP TABLE IF EXISTS kgi_reconciliation;

### Pre-write checklist (before Jason writes DRAFT files)
  [ ] 楊董 explicit ack "proceed with 0027-0030 DRAFT write"
  [ ] workspaces table exists in schema (verify 0001-0024 establishes workspaces PK)
  [ ] kgi_session.py FIsLogon bug fixed (separate PR) — not a migration blocker but prerequisite for e2e test
  [ ] quantity_unit enum: confirm 'SHARE' / 'LOT' matches paper_orders (0020) convention

---

## E. ROLLBACK / KILL-SWITCH MATRIX

### Migration rollback (0025-0026 already in prod)

| Migration | Rollback SQL | Estimated time | Data loss? |
|---|---|---|---|
| 0026_iuf_notification_preferences | DROP TABLE IF EXISTS _quarantine_...; DROP TABLE IF EXISTS iuf_notification_preferences; | < 5s | Prefs rows only (0 rows currently, no active writer) |
| 0025_iuf_events | DROP TABLE IF EXISTS _quarantine_iuf_events; DROP TABLE IF EXISTS iuf_events; | < 5s | Event log rows since promote. Code degrades to no-event gracefully. |
| 0024_finmind_market_intel | 0024_finmind_market_intel.down.sql | < 5s | FinMind cache rows (re-fetchable from FinMind API) |

Rollback dependency order: 0026 before 0025 (no actual FK between them, but convention).
Rollback gate: rollback requires 楊董 ack. No automated rollback on migration tables.

### Kill-switch 3-level protection sequence

Level 1 — Env var: KILL_SWITCH=true (Railway env, blocks all order submission at API layer)
  Flip to false: Railway dashboard → variable edit → redeploy (2-3 min).
  Flip back to true: same path, immediate after trade.

Level 2 — Code guard: apps/api/src/broker/kgi-broker.ts createOrder() checks KILL_SWITCH.
  If env var somehow missing: code default is BLOCKED (fail-safe).

Level 3 — DB: paper_orders / kgi_orders have status field.
  Emergency: UPDATE kgi_orders SET status='CANCELLED' WHERE status='PENDING';
  This is a data fix, not a migration — requires operator psql access.

Kill-switch reset SOP after first live trade:
  1. Trade submitted → wait for fill ACK (kgi_fills row appears)
  2. Verify kgi_positions updated
  3. Immediately set KILL_SWITCH=true via Railway
  4. Write reconciliation sweep (kgi_reconciliation row) to confirm MATCH

---

## F. RISK ASSESSMENT: FIRST LIVE TRADE — 0050 ETF 1 SHARE

Trade profile:
  Symbol: 0050 (元大台灣50 ETF) — most liquid Taiwan ETF, tight bid-ask
  Unit: SHARE (odd-lot, 1 share)
  Approximate capital at risk: ~20,000 TWD (0050 trades ~200 TWD/share range)
  Purpose: Confirm KGI write-side E2E (submit → ACK → fill → position update → reconciliation)

Why 0050 is correct:
  High liquidity → fills immediately, no partial-fill complexity
  Low unit price per share → 1 share = minimal exposure
  Odd-lot supported by KGI → quantity_unit='SHARE' path tested

Why 1 share is correct:
  Minimum meaningful fill (1 LOT = 1000 shares = ~200k TWD exposure, unacceptable for E2E test)
  Consistent with 楊董 ack: "odd-lot 1 share / 20k TWD capital / 5 acceptance reqs" (feedback_odd_lot_demo_q1_correction.md)

Stop conditions (abort before submit):
  - kgi_session.py does not show FIsLogon = true
  - 4-layer risk check fails (max position / daily loss exceeded)
  - KILL_SWITCH is not explicitly set to false by operator
  - sim E2E did not PASS in current session

Post-trade acceptance criteria (5 required):
  1. kgi_orders row status = 'FILLED'
  2. kgi_fills row with kgi_deal_id populated
  3. kgi_positions row shows qty_long >= 1 for 0050
  4. kgi_reconciliation sweep = MATCH (iuf_qty == kgi_qty)
  5. No 4-layer risk limit breached in audit_logs

---

Auditor: Mike
Date: 2026-05-07
Status: SHELF-READY — 5/12 楊董 ack required before Step 6+ execution
Evidence: evidence/w7_paper_sprint/MIKE_KGI_5_12_SHELF_READY_RUNBOOK_2026-05-07.md
