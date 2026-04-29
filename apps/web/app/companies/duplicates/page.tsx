import { PageFrame } from "@/components/PageFrame";
import { CompanyDuplicates } from "@/components/company-duplicates";

export default function CompanyDuplicatesPage() {
  return (
    <PageFrame code="DUP" title="Duplicates" sub="重複公司">
      <CompanyDuplicates />
    </PageFrame>
  );
}
