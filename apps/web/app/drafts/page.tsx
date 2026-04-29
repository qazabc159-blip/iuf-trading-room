import { Suspense } from "react";
import { PageFrame } from "@/components/PageFrame";
import { ContentDraftsQueue } from "@/components/content-drafts-queue";

export default function DraftsPage() {
  return (
    <PageFrame code="DFT" title="Drafts" sub="內容草稿">
      <Suspense>
        <ContentDraftsQueue />
      </Suspense>
    </PageFrame>
  );
}
