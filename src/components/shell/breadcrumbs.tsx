"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";

import { useShell, type BreadcrumbEntry } from "./shell-context";

/** Declares the breadcrumb trail for the current page. Renders nothing itself. */
export function PageBreadcrumbs({ items }: { items: readonly BreadcrumbEntry[] }) {
  const { setBreadcrumbs } = useShell();
  const key = JSON.stringify(items);
  useEffect(() => {
    setBreadcrumbs(JSON.parse(key) as BreadcrumbEntry[]);
    return () => setBreadcrumbs(null);
  }, [key, setBreadcrumbs]);
  return null;
}

export function BreadcrumbTrail({ items }: { items: readonly BreadcrumbEntry[] }) {
  return (
    <nav aria-label="Brødkrummesti" className="min-w-0">
      <ol className="flex min-w-0 items-center gap-1 text-label text-fg-secondary">
        {items.map((item, index) => {
          const last = index === items.length - 1;
          return (
            <li
              key={`${item.label}-${index}`}
              className={last ? "flex min-w-0 items-center gap-1" : "hidden shrink-0 items-center gap-1 sm:flex"}
            >
              {index > 0 ? <ChevronRight className="hidden size-3.5 shrink-0 text-fg-tertiary sm:block" aria-hidden /> : null}
              {item.href && !last ? (
                <Link href={item.href} className="max-w-40 truncate rounded-sm hover:text-fg-primary hover:underline">
                  {item.label}
                </Link>
              ) : (
                <span className="truncate font-medium text-fg-primary" aria-current={last ? "page" : undefined}>
                  {item.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
