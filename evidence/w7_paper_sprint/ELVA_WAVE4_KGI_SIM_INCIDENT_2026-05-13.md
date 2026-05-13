# SUPERSEDED - DO NOT USE AS CURRENT STATUS

This file replaces an earlier incorrect incident draft that labeled Wave 4 as
`WAVE3_BLOCKED_KGI_SIM_AUTH`. That diagnosis is false after owner-email review
and local SIM round-trip verification on 2026-05-13.

Use the handoff below as current status:

- `evidence/w7_paper_sprint/ELVA_KGI_SIM_CORRECTION_HANDOFF_2026-05-13.md`

Correct current facts:

- KGI SIM authorization exists per KGI email.
- SIM login uses the Owner's existing KGI person_id and SIM password `0000`.
- SSM `/iuf/kgi/sim_person_id` and `/iuf/kgi/sim_person_pwd` are valid SIM SecureStrings; do not delete them as fake.
- EC2 fails SIM because it cannot TCP-connect to KGI test hosts from that source IP.
- Owner local PC can reach KGI test hosts and completed SIM order round-trip.
- PR #406 includes follow-up commit `f2a6da6` mapping REST strings to `kgisuperpy` enums.
- Local SIM evidence: `/order/create` returned `200 sim_only=true accepted`; callbacks received; order id `V000L`.

Current verdict: `KGI_SIM_LOCAL_ROUNDTRIP_PASS__EC2_TEST_HOST_NETWORK_BLOCKED`.
