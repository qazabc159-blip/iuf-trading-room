import { permanentRedirect } from "next/navigation";

// P1-2 legacy invite converge (2026-07-05): the old invite_codes-backed test
// invite issuer has been retired (backend now answers 410 on
// /auth/issue-invite). Team/invite management lives on /admin/team, backed
// by the workspace_invites system (migration 0050). This thin redirect keeps
// old bookmarks/links working.
export default function InvitesRedirectPage() {
  permanentRedirect("/admin/team");
}
