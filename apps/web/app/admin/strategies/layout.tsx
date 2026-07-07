import type { ReactNode } from "react";

import { AdminOwnerGate } from "@/components/admin-owner-gate";

/**
 * /admin/strategies nested layout — permission matrix v1 D3 (G-OWNER group,
 * `reports/permission_matrix/PERMISSION_MATRIX_v1.md`): Quant Lab strategy
 * governance stays Owner-only.
 */
export default function StrategiesAdminLayout({ children }: { children: ReactNode }) {
  return <AdminOwnerGate>{children}</AdminOwnerGate>;
}
