import { AppShell } from "@/components/app-shell";
import { OpenAliceOps } from "@/components/openalice-ops";

export default function OpsPage() {
  return (
    <AppShell eyebrow="系統戰情" title="營運監控">
      <OpenAliceOps />
    </AppShell>
  );
}
