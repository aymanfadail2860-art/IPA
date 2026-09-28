"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { groupedNavItems, navItemForPath } from "@/config/navigation";
import { useSession } from "@/lib/auth/session";
import { cn } from "@/lib/utils";

/**
 * Main navigation list, shared by the desktop sidebar and the mobile drawer.
 * Items the user has no access to are not rendered — never shown as locked (§4).
 * The active item: accent.subtle background + a clear left marker, not coloured text alone.
 */
export function SidebarNav({ collapsed = false, onNavigate }: { collapsed?: boolean; onNavigate?: () => void }) {
  const { grants } = useSession();
  const pathname = usePathname();
  const activeId = navItemForPath(pathname)?.id;
  const groups = groupedNavItems(grants);

  return (
    <nav aria-label="Hovednavigation" className="flex flex-col gap-6">
      {groups.map(({ group, label, items }) => (
        <div key={group}>
          <h2 className="sr-only">{label}</h2>
          <ul className="space-y-0.5">
            {items.map((item) => {
              const Icon = item.icon;
              const active = item.id === activeId;
              const link = (
                <Link
                  href={item.href}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "relative flex h-9 items-center gap-3 rounded-md px-3 text-body transition-colors",
                    active
                      ? "bg-accent-subtle font-medium text-fg-primary before:absolute before:inset-y-1.5 before:left-0 before:w-[3px] before:rounded-full before:bg-brand"
                      : "text-fg-secondary hover:bg-surface-sunken hover:text-fg-primary",
                    collapsed && "justify-center px-0",
                  )}
                >
                  <Icon className={cn("size-[1.125rem] shrink-0", active && "text-brand")} aria-hidden />
                  <span className={cn(collapsed && "sr-only")}>{item.label}</span>
                </Link>
              );
              return (
                <li key={item.id}>
                  {collapsed ? (
                    <Tooltip>
                      <TooltipTrigger asChild>{link}</TooltipTrigger>
                      <TooltipContent side="right">{item.label}</TooltipContent>
                    </Tooltip>
                  ) : (
                    link
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
