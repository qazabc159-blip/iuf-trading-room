import { AppShell } from "@/components/app-shell";
import { CompanyBoard } from "@/components/company-board";

export default function CompaniesPage() {
  return (
    <AppShell eyebrow="Company Board" title="Coverage Cards">
      <CompanyBoard />
    </AppShell>
  );
}
