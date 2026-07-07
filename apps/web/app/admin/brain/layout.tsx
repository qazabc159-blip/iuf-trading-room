import type { ReactNode } from "react";

import { AdminOwnerGate } from "@/components/admin-owner-gate";

/**
 * /admin/brain/* nested layout — covers /admin/brain/llm and
 * /admin/brain/decisions. Permission matrix v1 D3 / PM-O3 decision
 * (`reports/permission_matrix/PERMISSION_MATRIX_v1.md`): brain monitoring
 * stays Owner-only — PM-O3 kept brain/themes governance at Owner rather than
 * lowering it to Admin alongside team/invites.
 */
export default function BrainAdminLayout({ children }: { children: ReactNode }) {
  return <AdminOwnerGate>{children}</AdminOwnerGate>;
}
