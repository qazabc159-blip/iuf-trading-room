import { notFound } from "next/navigation";
import { LabBundleDetailClient } from "@/app/lab/[bundleId]/LabBundleDetailClient";
import { radarLabApi } from "@/lib/radar-lab";

export default async function LabBundlePage({ params }: { params: Promise<{ bundleId: string }> }) {
  const { bundleId } = await params;
  const bundle = await radarLabApi.bundle(bundleId);
  if (!bundle) notFound();
  return <LabBundleDetailClient bundle={bundle} />;
}
