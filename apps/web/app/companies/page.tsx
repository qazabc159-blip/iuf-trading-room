import { AppShell } from "@/components/app-shell";
import { CompanyBoard } from "@/components/company-board";

export default function CompaniesPage() {
  return (
    <AppShell eyebrow="公司資料庫" title="覆蓋標的">
      <CompanyBoard />
    </AppShell>
  );
}
