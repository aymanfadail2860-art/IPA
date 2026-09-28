import { RequirePermission } from "@/components/common/require-permission";

import { AdminFrame } from "./admin-frame";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <RequirePermission
      requirement={{ anyOf: ["knowledge.document.write", "knowledge.version.publish", "identity.user.manage", "system.settings.manage"] }}
    >
      <AdminFrame>{children}</AdminFrame>
    </RequirePermission>
  );
}
