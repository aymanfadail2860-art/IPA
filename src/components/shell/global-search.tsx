"use client";

import {
  BookOpen,
  BriefcaseBusiness,
  FileText,
  Package,
  Settings,
  Sparkles,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { meetsRequirement } from "@/lib/auth/permissions";
import { useSession } from "@/lib/auth/session";

import { useShell } from "./shell-context";

export interface SearchEntry {
  id: string;
  group: string;
  title: string;
  detail?: string;
  href: string;
  adminOnly?: boolean;
}

const GROUP_ICONS: Record<string, LucideIcon> = {
  Produkter: Package,
  Dokumenter: FileText,
  Læringsmoduler: BookOpen,
  "Egne kundecases": BriefcaseBusiness,
  Handlinger: Zap,
  Administration: Settings,
};

/**
 * Global search (⌘K / Ctrl+K, §4). Finds things across products, documents, modules,
 * own cases and actions, grouped by type and filtered by permissions. It does not answer
 * questions — but any query can be sent on to Copilot.
 */
export function GlobalSearch({ entries }: { entries: readonly SearchEntry[] }) {
  const { searchOpen, setSearchOpen } = useShell();
  const { grants } = useSession();
  const router = useRouter();
  const [query, setQuery] = useState("");

  const isAdmin = meetsRequirement(grants, { anyOf: ["knowledge.document.write", "identity.user.manage"] });
  const visible = entries.filter((entry) => !entry.adminOnly || isAdmin);
  const groups = [...new Set(visible.map((entry) => entry.group))];

  function go(href: string) {
    setSearchOpen(false);
    setQuery("");
    router.push(href);
  }

  return (
    <CommandDialog open={searchOpen} onOpenChange={setSearchOpen}>
      <CommandInput placeholder="Søg efter produkter, dokumenter, moduler …" value={query} onValueChange={setQuery} />
      <CommandList>
        <CommandEmpty>Ingen resultater. Prøv et andet ord, eller spørg Copilot.</CommandEmpty>
        {groups.map((group) => {
          const Icon = GROUP_ICONS[group] ?? FileText;
          return (
            <CommandGroup key={group} heading={group}>
              {visible
                .filter((entry) => entry.group === group)
                .map((entry) => (
                  <CommandItem key={entry.id} value={`${entry.title} ${entry.detail ?? ""}`} onSelect={() => go(entry.href)}>
                    <Icon className="text-fg-tertiary" aria-hidden />
                    <span>{entry.title}</span>
                    {entry.detail ? <span className="ml-auto text-caption text-fg-tertiary">{entry.detail}</span> : null}
                  </CommandItem>
                ))}
            </CommandGroup>
          );
        })}
        {query.trim() ? (
          <CommandGroup heading="Copilot" forceMount>
            <CommandItem
              value={`copilot ${query}`}
              forceMount
              onSelect={() => go(`/copilot?q=${encodeURIComponent(query.trim())}`)}
            >
              <Sparkles className="text-ai-suggestion" aria-hidden />
              <span>
                Spørg Copilot: <span className="font-medium">&ldquo;{query.trim()}&rdquo;</span>
              </span>
            </CommandItem>
          </CommandGroup>
        ) : null}
      </CommandList>
    </CommandDialog>
  );
}
