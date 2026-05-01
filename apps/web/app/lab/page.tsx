import { LabClient } from "@/app/lab/LabClient";
import { radarLabApi } from "@/lib/radar-lab";

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default async function LabPage() {
  try {
    const bundles = await radarLabApi.bundles();
    return <LabClient initialBundles={bundles} />;
  } catch (error) {
    return <LabClient initialBundles={[]} initialBlockedReason={errorText(error)} />;
  }
}
