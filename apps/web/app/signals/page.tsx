import { AppShell } from "@/components/app-shell";
import { SignalBoard } from "@/components/signal-board";

export default function SignalsPage() {
  return (
    <AppShell eyebrow="Signal Board" title="Signal Review">
      <SignalBoard />
    </AppShell>
  );
}
