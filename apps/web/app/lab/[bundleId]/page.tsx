import { notFound } from "next/navigation";
import { LabBundleDetailClient } from "@/app/lab/[bundleId]/LabBundleDetailClient";
import { PageFrame, Panel } from "@/components/PageFrame";
import { radarLabApi } from "@/lib/radar-lab";

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default async function LabBundlePage({ params }: { params: Promise<{ bundleId: string }> }) {
  const { bundleId } = await params;
  try {
    const bundle = await radarLabApi.bundle(bundleId);
    if (!bundle) notFound();
    return <LabBundleDetailClient bundle={bundle} />;
  } catch (error) {
    return (
      <PageFrame
        code="LAB-D"
        title="Quant Lab Detail"
        sub="BLOCKED"
        note="[LAB-D] Production requires real lab bundle data. Mock bundle detail is hidden."
      >
        <Panel code="LAB-D" title="Bundle Detail" right="BLOCKED">
          <div className="terminal-note">
            BLOCKED: Quant Lab bundle API is unavailable for {bundleId}. Owner: Athena + Jason. Detail: {errorText(error)}
          </div>
        </Panel>
      </PageFrame>
    );
  }
}
