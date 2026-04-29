import { Suspense } from "react";
import { PageFrame } from "@/components/PageFrame";
import { ReviewBoard } from "@/components/review-board";

export default function ReviewsPage() {
  return (
    <PageFrame code="RVW" title="Reviews" sub="覆盤紀錄">
      <Suspense>
        <ReviewBoard />
      </Suspense>
    </PageFrame>
  );
}
