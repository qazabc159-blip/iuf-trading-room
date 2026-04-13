import { AppShell } from "@/components/app-shell";
import { ExecutionBoard } from "@/components/execution-board";

export default function PlansPage() {
  return (
    <AppShell eyebrow="Execution Board" title="Trade Plans">
      <ExecutionBoard />
    </AppShell>
  );
}
