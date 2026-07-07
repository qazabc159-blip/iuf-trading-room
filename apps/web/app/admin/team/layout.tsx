import type { ReactNode } from "react";

import { RoleGate } from "@/components/admin-owner-gate";
import { INTERNAL_ADMIN_SURFACES } from "@/lib/canonical-surfaces";

/**
 * /admin/team nested layout — permission matrix v1 D3/D4
 * (`reports/permission_matrix/PERMISSION_MATRIX_v1.md`). PM-O3 carve-out:
 * invite/user management is the one G-ADMIN surface that stayed at Admin
 * instead of Owner. `minRole` is read from the canonical-surfaces registry
 * (single source of truth) instead of being hardcoded here.
 */
const MIN_ROLE = INTERNAL_ADMIN_SURFACES.find((s) => s.path === "/admin/team")!.minRole;

export default function TeamAdminLayout({ children }: { children: ReactNode }) {
  return <RoleGate minRole={MIN_ROLE}>{children}</RoleGate>;
}
