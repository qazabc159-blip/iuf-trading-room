import { AppShell } from "@/components/app-shell";
import { DraftReviewQueue } from "@/components/draft-review-queue";

export default function DraftsPage() {
  return (
    <AppShell eyebrow="草稿審核" title="代理草稿佇列">
      <DraftReviewQueue />
    </AppShell>
  );
}
