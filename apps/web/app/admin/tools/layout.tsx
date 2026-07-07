import type { ReactNode } from "react";

import { AdminOwnerGate } from "@/components/admin-owner-gate";

/**
 * /admin/tools nested layout — permission matrix v1 D3 (G-OWNER group,
 * `reports/permission_matrix/PERMISSION_MATRIX_v1.md`): ToolCenter registry
 * stays Owner-only.
 */
export default function ToolsAdminLayout({ children }: { children: ReactNode }) {
  return <AdminOwnerGate>{children}</AdminOwnerGate>;
}
