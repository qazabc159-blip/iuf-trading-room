import { Suspense } from "react";
import { PageFrame } from "@/components/PageFrame";
import { BriefBoard } from "@/components/brief-board";

export default function BriefsPage() {
  return (
    <PageFrame code="BRF" title="Daily Briefs" sub="每日簡報">
      <Suspense>
        <BriefBoard />
      </Suspense>
    </PageFrame>
  );
}
