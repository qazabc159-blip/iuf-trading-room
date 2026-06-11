import type { ReactNode } from "react";

import { AdminOwnerGate } from "@/components/admin-owner-gate";

export default function AdminLayout({ children }: { children: ReactNode }) {
  return <AdminOwnerGate>{children}</AdminOwnerGate>;
}
