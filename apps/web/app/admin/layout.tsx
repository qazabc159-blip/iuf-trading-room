import type { ReactNode } from "react";

/**
 * /admin/* route group root layout.
 *
 * Login is already enforced globally by `middleware.ts` (unauthenticated
 * requests are redirected to /login before any /admin route renders), so
 * this layout does not re-check auth.
 *
 * Role gating is intentionally NOT blanket-applied here anymore. Permission
 * matrix v1 D3 (`reports/permission_matrix/PERMISSION_MATRIX_v1.md`) gives
 * each /admin/* sub-route group its own minimum role (Admin for
 * /admin/team, Analyst for /admin/content-drafts, Owner for the rest) —
 * a single blanket Owner-only gate here would block Admin/Analyst accounts
 * from surfaces the registry says they should reach. Each sub-route group
 * therefore carries its own nested layout applying `RoleGate` at the
 * registry's minRole: see app/admin/{team,content-drafts,brain,events,
 * portfolio,tools,uta,strategies}/layout.tsx.
 */
export default function AdminLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
