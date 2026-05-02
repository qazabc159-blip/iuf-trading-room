import { notFound } from "next/navigation";
import { LabBundleDetailClient } from "@/app/lab/[bundleId]/LabBundleDetailClient";
import { PageFrame, Panel } from "@/components/PageFrame";
import { friendlyDataError } from "@/lib/friendly-error";
import { radarLabApi } from "@/lib/radar-lab";

function errorText(error: unknown): string {
  return friendlyDataError(error, "量化策略包明細暫時無法讀取。");
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
        title="量化策略包明細"
        sub="資料暫停"
        note="此頁需要正式量化策略包資料；沒有資料時不顯示假明細。"
      >
        <Panel code="LAB-D" title="策略包明細" right="暫停">
          <div className="terminal-note">
            暫停：策略包 {bundleId} 的資料尚未啟用。負責人：Athena + Jason。細節：{errorText(error)}
          </div>
        </Panel>
      </PageFrame>
    );
  }
}
