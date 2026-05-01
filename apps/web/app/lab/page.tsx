import { LabClient } from "@/app/lab/LabClient";
import { friendlyDataError } from "@/lib/friendly-error";
import { radarLabApi } from "@/lib/radar-lab";

function errorText(error: unknown): string {
  return friendlyDataError(error, "量化研究資料暫時無法讀取。");
}

export default async function LabPage() {
  try {
    const bundles = await radarLabApi.bundles();
    return <LabClient initialBundles={bundles} />;
  } catch (error) {
    return <LabClient initialBundles={[]} initialBlockedReason={errorText(error)} />;
  }
}
