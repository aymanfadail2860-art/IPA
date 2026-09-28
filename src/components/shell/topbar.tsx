"use client";

import { FlaskConical, Menu, Search, Sparkles } from "lucide-react";
import { usePathname } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { navItemForPath } from "@/config/navigation";
import { useShortcutLabel } from "@/hooks/use-shortcut";

import { BreadcrumbTrail } from "./breadcrumbs";
import { Notifications, type NotificationEntry } from "./notifications";
import { useShell } from "./shell-context";
import { UserMenu } from "./user-menu";

/**
 * Topbar — low and discreet: orientation, not identity (§4). Breadcrumb on the left;
 * search, Copilot, notifications and the user menu on the right.
 */
export function Topbar({ notifications, mockNotice }: { notifications: readonly NotificationEntry[]; mockNotice: string }) {
  const { setSearchOpen, toggleCopilot, copilotOpen, setMobileNavOpen, breadcrumbs } = useShell();
  const pathname = usePathname();
  const searchShortcut = useShortcutLabel("globalSearch");
  const copilotShortcut = useShortcutLabel("copilot");
  const section = navItemForPath(pathname);
  const onCopilotPage = pathname.startsWith("/copilot");

  return (
    <header className="sticky top-0 z-30 flex h-[var(--topbar-height)] shrink-0 items-center gap-2 border-b border-border-subtle bg-surface-raised/95 px-3 backdrop-blur-sm md:px-6">
      <Button
        variant="ghost"
        size="icon"
        className="lg:hidden"
        aria-label="Åbn menu"
        onClick={() => setMobileNavOpen(true)}
      >
        <Menu aria-hidden />
      </Button>

      <div className="min-w-0 flex-1">
        {breadcrumbs && breadcrumbs.length > 0 ? (
          <BreadcrumbTrail items={breadcrumbs} />
        ) : section ? (
          <p className="truncate text-label font-medium text-fg-primary">{section.label}</p>
        ) : null}
      </div>

      <span
        className="hidden shrink-0 items-center gap-1.5 rounded-sm bg-surface-sunken px-2 py-1 text-caption text-fg-secondary @4xl/content:inline-flex"
        title={mockNotice}
      >
        <FlaskConical className="size-3.5" aria-hidden />
        <span aria-hidden>Fiktive data</span>
        <span className="sr-only">{mockNotice}</span>
      </span>

      <Button
        variant="secondary"
        size="sm"
        onClick={() => setSearchOpen(true)}
        className="hidden w-56 justify-start text-fg-tertiary @2xl/content:inline-flex"
        aria-label={searchShortcut ? `Søg (${searchShortcut})` : "Søg"}
      >
        <Search aria-hidden />
        <span className="flex-1 text-left">Søg</span>
        {searchShortcut ? (
          <kbd className="rounded-sm border border-border-subtle bg-surface-sunken px-1.5 font-mono text-caption text-fg-secondary">
            {searchShortcut}
          </kbd>
        ) : null}
      </Button>
      <Button variant="ghost" size="icon" className="@2xl/content:hidden" aria-label="Søg" onClick={() => setSearchOpen(true)}>
        <Search aria-hidden />
      </Button>

      {onCopilotPage ? null : (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={copilotOpen ? "secondary" : "ghost"}
              size="sm"
              onClick={toggleCopilot}
              aria-pressed={copilotOpen}
              aria-label={copilotOpen ? "Luk Copilot" : "Åbn Copilot"}
            >
              <Sparkles className="text-ai-suggestion" aria-hidden />
              <span className="hidden @xl/content:inline">Copilot</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {copilotOpen ? "Luk Copilot" : "Åbn Copilot"}
            {copilotShortcut ? ` · ${copilotShortcut}` : ""}
          </TooltipContent>
        </Tooltip>
      )}

      <Notifications items={notifications} />
      <UserMenu />
    </header>
  );
}
