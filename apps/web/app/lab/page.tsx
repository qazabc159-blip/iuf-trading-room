import { LabClient } from "@/app/lab/LabClient";
import { radarLabApi } from "@/lib/radar-lab";

export default async function LabPage() {
  const bundles = await radarLabApi.bundles();
  return <LabClient initialBundles={bundles} />;
}
