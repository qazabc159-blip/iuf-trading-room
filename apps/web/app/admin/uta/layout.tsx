import type { ReactNode } from "react";

import { AdminOwnerGate } from "@/components/admin-owner-gate";

/**
 * /admin/uta/* nested layout — covers the /admin/uta index redirect and
 * /admin/uta/accounts. Permission matrix v1 D3 (G-OWNER group,
 * `reports/permission_matrix/PERMISSION_MATRIX_v1.md`): UTA broker/account
 * management stays Owner-only.
 */
export default function UtaAdminLayout({ children }: { children: ReactNode }) {
  return <AdminOwnerGate>{children}</AdminOwnerGate>;
}
