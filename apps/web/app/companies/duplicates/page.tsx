import { AppShell } from "@/components/app-shell";
import { CompanyDuplicates } from "@/components/company-duplicates";

export default function CompanyDuplicatesPage() {
  return (
    <AppShell eyebrow="公司資料庫" title="重複偵測">
      <CompanyDuplicates />
    </AppShell>
  );
}
