import type { ReactNode } from "react";

import { RoleGate } from "@/components/admin-owner-gate";
import { SECONDARY_ADMIN_SURFACES } from "@/lib/canonical-surfaces";

/**
 * /admin/content-drafts nested layout — permission matrix v1 D3
 * (`reports/permission_matrix/PERMISSION_MATRIX_v1.md`), G-RESEARCH group:
 * content-draft review is Analyst+ (the original READ_DRAFT_ROLES intent).
 * `minRole` is read from the canonical-surfaces registry (single source of
 * truth) instead of being hardcoded here. Covers both the list page and the
 * `[id]` detail page.
 */
const MIN_ROLE = SECONDARY_ADMIN_SURFACES.find((s) => s.path === "/admin/content-drafts")!.minRole;

export default function ContentDraftsAdminLayout({ children }: { children: ReactNode }) {
  return <RoleGate minRole={MIN_ROLE}>{children}</RoleGate>;
}
