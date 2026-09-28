"use client";

import { usePathname } from "next/navigation";
import { useCallback, type ReactNode } from "react";

import { CopilotPanel } from "@/components/copilot/copilot-panel";
import { useShortcut } from "@/hooks/use-shortcut";

import type { SearchEntry } from "@/lib/search";
import type { CustomerCase, CopilotConversation } from "@/types/domain";

import { GlobalSearch } from "./global-search";
import { MobileNav } from "./mobile-nav";
import type { NotificationEntry } from "./notifications";
import { useShell } from "./shell-context";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";

export const COPILOT_PAGE_INPUT_ID = "copilot-page-input";

/**
 * AppShell (docs/04-ui-ux-design.md §4): fixed left sidebar, topbar, content, and a right
 * context panel used by Copilot. The Copilot panel pushes the content aside on desktop.
 */
export function AppShell({
  children,
  notifications,
  searchEntries,
  cases,
  copilotConversation,
  mockNotice,
}: {
  children: ReactNode;
  notifications: readonly NotificationEntry[];
  searchEntries: readonly SearchEntry[];
  /** Customer cases; the search shows only those the user owns or is assigned to. */
  cases: readonly CustomerCase[];
  copilotConversation: CopilotConversation;
  mockNotice: string;
}) {
  const { setSearchOpen, toggleCopilot } = useShell();
  const pathname = usePathname();

  const openSearch = useCallback(() => setSearchOpen(true), [setSearchOpen]);
  const handleCopilotShortcut = useCallback(() => {
    // On the Copilot page itself the shortcut focuses the question field instead.
    if (pathname.startsWith("/copilot")) {
      document.getElementById(COPILOT_PAGE_INPUT_ID)?.focus();
      return;
    }
    toggleCopilot();
  }, [pathname, toggleCopilot]);

  useShortcut("globalSearch", openSearch);
  useShortcut("copilot", handleCopilotShortcut);

  return (
    <div className="flex min-h-dvh">
      <a
        href="#main-content"
        className="sr-only z-50 rounded-md bg-surface-raised px-4 py-2 text-body font-medium focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Spring til indhold
      </a>
      <Sidebar />
      <MobileNav />
      <div className="@container/content flex min-w-0 flex-1 flex-col">
        <Topbar notifications={notifications} mockNotice={mockNotice} />
        <main id="main-content" tabIndex={-1} className="@container/main flex-1 outline-none">
          {children}
        </main>
      </div>
      {pathname.startsWith("/copilot") ? null : <CopilotPanel conversation={copilotConversation} />}
      <GlobalSearch entries={searchEntries} cases={cases} />
    </div>
  );
}
