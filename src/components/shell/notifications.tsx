"use client";

import { Bell } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatDate } from "@/lib/format";

export interface NotificationEntry {
  id: string;
  title: string;
  detail: string;
  date: string;
  href: string;
  important?: boolean;
}

/** Notifications — changes in the professional basis that concern the user. */
export function Notifications({ items }: { items: readonly NotificationEntry[] }) {
  const unread = items.filter((item) => item.important).length;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={`Notifikationer, ${unread} vigtige`} className="relative">
          <Bell aria-hidden />
          {unread > 0 ? (
            <span aria-hidden className="absolute top-1.5 right-1.5 size-2 rounded-full bg-error ring-2 ring-surface-raised" />
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <p className="border-b border-border-subtle px-4 py-3 text-heading-3">Notifikationer</p>
        <ul className="max-h-80 divide-y divide-border-subtle overflow-y-auto">
          {items.map((item) => (
            <li key={item.id}>
              <Link href={item.href} className="block px-4 py-3 hover:bg-surface-sunken">
                <p className="text-body font-medium text-fg-primary">{item.title}</p>
                <p className="text-body text-fg-secondary">{item.detail}</p>
                <p className="mt-1 text-caption text-fg-tertiary">Gælder fra {formatDate(item.date)}</p>
              </Link>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
