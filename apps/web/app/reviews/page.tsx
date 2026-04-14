import { Suspense } from "react";

import { AppShell } from "@/components/app-shell";
import { ReviewBoard } from "@/components/review-board";

export default function ReviewsPage() {
  return (
    <AppShell eyebrow="Review Board" title="Trade Reviews">
      <Suspense>
        <ReviewBoard />
      </Suspense>
    </AppShell>
  );
}
