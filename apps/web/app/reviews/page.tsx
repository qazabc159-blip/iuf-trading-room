import { Suspense } from "react";

import { AppShell } from "@/components/app-shell";
import { ReviewBoard } from "@/components/review-board";

export default function ReviewsPage() {
  return (
    <AppShell eyebrow="交易檢討" title="覆盤紀錄">
      <Suspense>
        <ReviewBoard />
      </Suspense>
    </AppShell>
  );
}
