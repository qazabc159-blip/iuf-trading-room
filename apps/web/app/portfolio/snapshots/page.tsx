import { permanentRedirect } from "next/navigation";

export default function PortfolioSnapshotsRedirectPage() {
  permanentRedirect("/admin/portfolio/snapshots");
}
