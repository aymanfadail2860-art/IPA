"use client";

import { Keyboard, LogOut, UserRound } from "lucide-react";
import Link from "next/link";

import { InitialsAvatar } from "@/components/common/avatar-stack";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SHORTCUTS } from "@/config/shortcuts";
import { usePlatform } from "@/hooks/use-shortcut";
import { formatShortcut } from "@/config/shortcuts";
import { useSession } from "@/lib/auth/session";

/** User menu — identity, own profile and the documented keyboard shortcuts (§20). */
export function UserMenu() {
  const { user } = useSession();
  const platform = usePlatform();
  const shortcuts = Object.values(SHORTCUTS)
    .map((definition) => ({ definition, label: formatShortcut(definition, platform) }))
    .filter((entry) => entry.label !== null);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="h-10 gap-2.5 px-1.5 md:px-2" aria-label={`Brugermenu for ${user.name}`}>
          <InitialsAvatar initials={user.initials} name={user.name} size="sm" />
          <span className="hidden text-left leading-tight @5xl/content:block">
            <span className="block text-label font-medium text-fg-primary">{user.name}</span>
            <span className="block text-caption text-fg-tertiary">{user.title}</span>
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="font-normal">
          <p className="text-body font-medium text-fg-primary">{user.name}</p>
          <p className="text-caption text-fg-secondary">
            {user.title} · {user.teamName}
          </p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/profile">
            <UserRound aria-hidden />
            Min profil
          </Link>
        </DropdownMenuItem>
        {shortcuts.length > 0 ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="flex items-center gap-2 text-caption font-medium text-fg-tertiary">
              <Keyboard className="size-3.5" aria-hidden />
              Tastaturgenveje
            </DropdownMenuLabel>
            {shortcuts.map(({ definition, label }) => (
              <div key={definition.id} className="flex items-center justify-between px-2 py-1 text-body text-fg-secondary">
                <span>{definition.description}</span>
                <kbd className="rounded-sm border border-border-subtle bg-surface-sunken px-1.5 font-mono text-caption">{label}</kbd>
              </div>
            ))}
          </>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled>
          <LogOut aria-hidden />
          Log ud · ikke tilgængelig uden login
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
