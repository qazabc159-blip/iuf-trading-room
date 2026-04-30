# W7 D3 — Market Agent / EC2 outline

**Date**: 2026-04-30
**Author**: Elva
**Scope**: 1-page outline. NOT a runbook. Surfaces unknowns + decision points only.

---

## 1. Direction (per 楊董 §6)

| Tier | Choice | Role |
|------|--------|------|
| Primary | **AWS Windows EC2** | Production market-data host (push to cloud ingest) |
| Backup | External Windows VPS (3rd-party) | Fallback if EC2 license/perf blocks |
| Dev/Backup only | 個人 PC (current) | Dev env + emergency relay |
| Ops only | Tailscale | 維運 backdoor — NOT production data path |
| Forbidden | TradingView | NEVER as official data source |

---

## 2. Unknowns to resolve before D3 spike

| # | Unknown | Owner | Blocker level |
|---|---------|-------|---------------|
| U1 | Does KGI SDK (`kgisuperpy 1.0.4`) install on Windows Server 2022 EC2? | Jason spike | HIGH — Path C precedent FAILED on Linux due to Windows Forms; Server 2022 may behave like client Windows. |
| U2 | KGI license: 1-host bound? Multiple SDK runs on same person_id allowed? | 楊董 ask KGI ops | HIGH — if single-host, EC2 cutover means current 個人 PC must stop. |
| U3 | EC2 RDP / latency to KGI Taipei servers | Jason spike | MEDIUM — Tokyo region likely; 50-100ms RTT acceptable for read-only quote/tick. |
| U4 | Push direction: `/quote/push` from EC2 outbound → cloud ingest endpoint | Jason design | MEDIUM — already covered in §C2 SUPERSEDED Tailscale proposal, replaces tunnel. |
| U5 | HMAC secret rotation: where stored on EC2 host? | Bruce design | LOW — Windows Credential Manager (DPAPI) precedent already set for KGI password. |
| U6 | Redis cache: which provider? Railway managed Redis? Upstash? | Jason eval | LOW — Railway Redis already provisioned per memory. |
| U7 | SSE fan-out: which apps/api endpoint? Reuse `/api/v1/market-data/stream`? | Jason design | LOW — apps/api already has SSE primitive. |

---

## 3. D3 spike work order (gated on U1+U2 answers)

If U1+U2 PASS:
- **Step 1** — Spin up EC2 Windows Server 2022 t3.large (Tokyo) for 1-day spike. Cost ≤ USD 5/day.
- **Step 2** — Install KGI SDK + run Phase 0 equivalent smoke (login + quote/tick read for 2330).
- **Step 3** — Install gateway clone + run /health + /quote/2330 from EC2 host.
- **Step 4** — Implement outbound push: EC2 → cloud ingest with HMAC.
- **Step 5** — Verify cloud ingest received ≥ 1000 ticks across 30 min.

If U1 or U2 FAIL:
- Halt EC2 plan, escalate to 楊董.
- Backup: external Windows VPS (cost USD 30-50/mo) — same SDK install, less control.

---

## 4. Out of scope (this outline)

- Full runbook (write only after U1+U2 answered)
- Cost optimization (reserved instance, spot, etc.)
- Multi-region failover
- Security group / VPC design
- IAM role policy

---

## 5. Next decision node

楊董 needs to decide:
1. **U2 ask KGI ops** — license is single-host or multi-host? (sends ticket or asks broker rep)
2. **Spike budget** — approve 1-day USD 5 EC2 spike?
3. **Backup VPS** — pre-shortlist 3 providers for fallback?

Until 1+2 answered, D3 stays planning-only.

---

**Status**: PLANNING ONLY. No code spike. Awaiting 楊董 decision on U2 + spike approval.
