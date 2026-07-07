import type { ReactNode } from "react";

import { AdminOwnerGate } from "@/components/admin-owner-gate";

/**
 * /admin/portfolio/* nested layout — covers /admin/portfolio/snapshots.
 * Permission matrix v1 D3 (G-OWNER group,
 * `reports/permission_matrix/PERMISSION_MATRIX_v1.md`): Trading-as-Git
 * snapshot/diff inspection stays Owner-only.
 */
export default function PortfolioAdminLayout({ children }: { children: ReactNode }) {
  return <AdminOwnerGate>{children}</AdminOwnerGate>;
}
