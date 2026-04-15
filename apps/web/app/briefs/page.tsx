import { AppShell } from "@/components/app-shell";
import { BriefBoard } from "@/components/brief-board";

export default function BriefsPage() {
  return (
    <AppShell eyebrow="每日簡報" title="盤勢概覽">
      <BriefBoard />
    </AppShell>
  );
}
