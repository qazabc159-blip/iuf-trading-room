import { Suspense } from "react";

import { AppShell } from "@/components/app-shell";
import { ExecutionBoard } from "@/components/execution-board";

export default function PlansPage() {
  return (
    <AppShell eyebrow="交易計畫" title="執行紀律">
      <Suspense>
        <ExecutionBoard />
      </Suspense>
    </AppShell>
  );
}
