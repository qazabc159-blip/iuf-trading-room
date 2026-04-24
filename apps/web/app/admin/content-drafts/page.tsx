import { AppShell } from "@/components/app-shell";
import { ContentDraftsQueue } from "@/components/content-drafts-queue";

export default function ContentDraftsAdminPage() {
  return (
    <AppShell eyebrow="審稿 · 內容草稿" title="OpenAlice 草稿佇列">
      <ContentDraftsQueue />
    </AppShell>
  );
}
