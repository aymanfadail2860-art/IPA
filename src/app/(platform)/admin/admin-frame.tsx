"use client";

import { Monitor } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { PageBreadcrumbs } from "@/components/shell/breadcrumbs";
import { ADMIN_SECTIONS } from "@/config/admin-sections";
import { cn } from "@/lib/utils";

/**
 * Admin frame: secondary left navigation (§5) and an honest message on smaller screens —
 * Admin is desktop-only (§19) and never shows a broken layout.
 */
export function AdminFrame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const active = [...ADMIN_SECTIONS].reverse().find((section) => pathname === section.href || pathname.startsWith(`${section.href}/`));

  return (
    <>
      <PageBreadcrumbs items={[{ label: "Admin", href: "/admin" }, ...(active && active.id !== "overview" ? [{ label: active.label }] : [])]} />
      <div className="px-4 py-10 lg:hidden">
        <div className="mx-auto flex max-w-md flex-col items-center gap-3 rounded-lg border border-border-subtle bg-surface-raised p-8 text-center">
          <Monitor className="size-6 text-fg-secondary" aria-hidden />
          <p className="text-heading-3 text-fg-primary">Admin er designet til desktop</p>
          <p className="text-body text-fg-secondary">Åbn Admin på en større skærm for at forvalte indhold, dokumenter og brugere.</p>
        </div>
      </div>
      <div className="hidden min-h-[calc(100dvh-var(--topbar-height))] lg:flex">
        <nav aria-label="Admin" className="w-56 shrink-0 border-r border-border-subtle bg-surface-raised px-3 py-6">
          <p className="mb-3 px-2 text-caption font-semibold tracking-wide text-fg-tertiary uppercase">Admin</p>
          <ul className="space-y-0.5">
            {ADMIN_SECTIONS.map((section) => {
              const Icon = section.icon;
              const current = active?.id === section.id;
              return (
                <li key={section.id}>
                  <Link
                    href={section.href}
                    aria-current={current ? "page" : undefined}
                    className={cn(
                      "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-body",
                      current ? "bg-accent-subtle font-medium text-fg-primary" : "text-fg-secondary hover:bg-surface-sunken hover:text-fg-primary",
                    )}
                  >
                    <Icon className="size-4 shrink-0" aria-hidden />
                    {section.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </>
  );
}
