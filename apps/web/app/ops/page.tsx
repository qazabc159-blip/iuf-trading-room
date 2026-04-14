import { AppShell } from "@/components/app-shell";
import { OpenAliceOps } from "@/components/openalice-ops";

export default function OpsPage() {
  return (
    <AppShell eyebrow="Operations" title="OpenAlice Ops">
      <OpenAliceOps />
    </AppShell>
  );
}
