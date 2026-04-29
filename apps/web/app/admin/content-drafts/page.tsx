import { PageFrame } from "@/components/PageFrame";
import { ContentDraftsQueue } from "@/components/content-drafts-queue";

export default function ContentDraftsAdminPage() {
  return (
    <PageFrame code="ADM" title="Content Drafts" sub="內容草稿審核" exec>
      <ContentDraftsQueue />
    </PageFrame>
  );
}
