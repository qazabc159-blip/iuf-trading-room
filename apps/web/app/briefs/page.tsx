import { AppShell } from "@/components/app-shell";
import { BriefBoard } from "@/components/brief-board";

export default function BriefsPage() {
  return (
    <AppShell eyebrow="Daily Brief" title="Operating Picture">
      <BriefBoard />
    </AppShell>
  );
}
