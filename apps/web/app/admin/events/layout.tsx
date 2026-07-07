import type { ReactNode } from "react";

import { AdminOwnerGate } from "@/components/admin-owner-gate";

/**
 * /admin/events nested layout — permission matrix v1 D3 (G-OWNER group,
 * `reports/permission_matrix/PERMISSION_MATRIX_v1.md`): EventLog stream
 * inspection stays Owner-only.
 */
export default function EventsAdminLayout({ children }: { children: ReactNode }) {
  return <AdminOwnerGate>{children}</AdminOwnerGate>;
}
