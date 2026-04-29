import { ContentDraftDetailClient } from "./ContentDraftDetailClient";

export default async function ContentDraftDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ContentDraftDetailClient id={id} />;
}
