import { permanentRedirect } from "next/navigation";

export default function DraftsRedirectPage() {
  permanentRedirect("/admin/content-drafts");
}
