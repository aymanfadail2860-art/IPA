import { AccessDenied } from "@/components/common/access-denied";
import { ADMIN_REQUIREMENT } from "@/config/navigation";
import { authorize } from "@/lib/auth/server-session";

import { AdminFrame } from "./admin-frame";

/**
 * Admin frame. The layout hides the secondary navigation from users without access, but it
 * is NOT the authorization boundary: every Admin page checks permissions itself, because a
 * layout renders in parallel with its page and cannot stop the page's output.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await authorize(ADMIN_REQUIREMENT);
  if (!session) return <AccessDenied />;
  return <AdminFrame>{children}</AdminFrame>;
}
