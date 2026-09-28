import { cookies } from "next/headers";

import { AppShell } from "@/components/shell/app-shell";
import { ShellProvider } from "@/components/shell/shell-context";
import { DevSessionProvider } from "@/dev/dev-session-provider";
import { DEV_ROLE_COOKIE, isMockRoleId } from "@/dev/dev-tools";
import { RoleSwitcher } from "@/dev/role-switcher";
// PHASE 5: all shell data is mock data. Replaced by server-side data access later.
import { MOCK_DATA_NOTICE, mockChanges, mockCopilotConversations, mockSearchIndex } from "@/mocks";

export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const storedRole = cookieStore.get(DEV_ROLE_COOKIE)?.value;
  const initialRole = isMockRoleId(storedRole) ? storedRole : "advisor";

  const notifications = mockChanges.map((change) => ({
    id: change.id,
    title: change.product,
    detail: change.change,
    date: change.validFrom,
    href: "/home#nyt-siden-sidst",
    important: change.affectsActiveCases > 0,
  }));

  return (
    // DEVELOPMENT ONLY: DevSessionProvider is replaced by real authentication later.
    <DevSessionProvider initialRole={initialRole}>
      <ShellProvider>
        <AppShell
          notifications={notifications}
          searchEntries={mockSearchIndex}
          copilotConversation={mockCopilotConversations[0]}
          mockNotice={MOCK_DATA_NOTICE}
        >
          {children}
        </AppShell>
        <RoleSwitcher />
      </ShellProvider>
    </DevSessionProvider>
  );
}
