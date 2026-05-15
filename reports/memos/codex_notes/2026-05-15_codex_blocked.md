# 2026-05-15 Codex Blocked Items

## AI Recommendation Feedback Real-ID Write

- Owner: Jason
- Found by: Frontend Codex
- Status: frontend proxy and card controls implemented; upstream success for real recommendation IDs is not yet verified.
- Blocker: `POST /api/v1/recommendations/:id/feedback` still appears to validate existence with the mock recommendation lookup only, while #517 can generate real Athena/news/leader recommendation IDs.
- Impact: `/ai-recommendations` can show the feedback controls, but a real card may return non-2xx and the UI will correctly show `回饋尚未寫入`.
- Requested backend action: align feedback POST lookup with the same real-list + mock-fallback resolver used by `GET /api/v1/recommendations/:id`, then ask Bruce to owner-session click one real card feedback action.
