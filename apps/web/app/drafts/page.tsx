import { AppShell } from "@/components/app-shell";
import { DraftReviewQueue } from "@/components/draft-review-queue";

export default function DraftsPage() {
  return (
    <AppShell eyebrow="Agent Drafts" title="Draft Review Queue">
      <DraftReviewQueue />
    </AppShell>
  );
}
