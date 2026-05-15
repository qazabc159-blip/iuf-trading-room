# JASON — /notifications Real Events Evidence
**Date**: 2026-05-15 14:50 TST
**Branch**: feat/api-notifications-real-events-2026-05-15
**Commit**: 5b89a16

## What Changed

`GET /api/v1/notifications` replaced stub (empty list) with real event synthesis:

### Sources
| Source | Action filter | Notification type |
|--------|--------------|-------------------|
| audit_logs | paper_submit (status 201) | paper_order_filled / info |
| audit_logs | paper_submit (status >=422) | paper_order_rejected / warn |
| audit_logs | update, entityType=kill_switch | risk_alert / critical |
| audit_logs | kgi.sim.order_submitted | kgi_status / info |
| daily_briefs | status=published | brief_published / info |

### Rules
- 7-day window
- 200 audit rows scanned (inArray filter excludes heartbeat noise kgi.gateway.health)
- 10 brief rows pulled
- merged, sorted desc, sliced to 50
- read: always false (no user_notification_read table, Phase 2)

### mark-read
- POST /api/v1/notifications/:id/mark-read → fires writeAuditLog(notifications.mark_read) → 204
- No DB persistence (Phase 2)

## Build Result
- tsc --noEmit: PASS (0 errors)
- Lane boundary: only server.ts strategy/notification block touched
- No schema change
- No risk/broker/frontend files touched

## Bruce Verify Steps
1. Deploy commit 5b89a16
2. Submit 1 paper order → GET /api/v1/notifications → expect paper_order_filled or paper_order_rejected
3. Trigger kill switch (POST /api/v1/risk/kill-switch) → GET /notifications → expect risk_alert severity=critical
4. Check unread_count = notifications.length (all unread v1)
5. POST /api/v1/notifications/{any-id}/mark-read → expect 204
