import { FinalOnlyFrame } from "@/components/FinalOnlyFrame";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function IdeasPage() {
  return <FinalOnlyFrame title="Strategy Ideas" src={`/api/ui-final-v031/strategy-ideas?rev=${Date.now().toString(36)}`} />;
}
