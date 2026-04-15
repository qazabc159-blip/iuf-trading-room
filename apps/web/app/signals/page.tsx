import { AppShell } from "@/components/app-shell";
import { SignalBoard } from "@/components/signal-board";

export default function SignalsPage() {
  return (
    <AppShell eyebrow="訊號雷達" title="訊號總覽">
      <SignalBoard />
    </AppShell>
  );
}
