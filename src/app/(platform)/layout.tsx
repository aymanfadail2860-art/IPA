import { AppShell } from "@/components/shell/app-shell";
import { ShellProvider } from "@/components/shell/shell-context";
import { hasPermission } from "@/lib/auth/permissions";
import { requireSession } from "@/lib/auth/server-session";
import { SessionProvider } from "@/lib/auth/session";
import { listMyCases } from "@/lib/data/cases";
// Modules not yet built (Learn, Practice, Copilot content …) still use development mock data.
import { MOCK_DATA_NOTICE, mockChanges, mockCopilotConversations, mockSearchIndex } from "@/mocks";

/** Temporary demo without login (decision B-003). */
const DEMO_NOTICE = "Demo uden login · fiktive data · ikke rigtig adgangskontrol";

export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  // Server-side guard: no session → /login. The session and its permissions come from
  // Supabase Auth and the identity schema — never from the client.
  const session = await requireSession();
  const cases = hasPermission(session.grants, "advise.case.read") ? await listMyCases() : [];

  const notifications = mockChanges.map((change) => ({
    id: change.id,
    title: change.product,
    detail: change.change,
    date: change.validFrom,
    href: "/home#nyt-siden-sidst",
    important: change.affectsActiveCases > 0,
  }));

  return (
    <SessionProvider session={session}>
      <ShellProvider>
        <AppShell
          notifications={notifications}
          searchEntries={mockSearchIndex}
          cases={cases}
          copilotConversation={session.demo ? (mockCopilotConversations[0] ?? null) : null}
          copilotMode={session.demo ? "demo" : "live"}
          mockNotice={session.demo ? DEMO_NOTICE : MOCK_DATA_NOTICE}
        >
          {children}
        </AppShell>
      </ShellProvider>
    </SessionProvider>
  );
}
