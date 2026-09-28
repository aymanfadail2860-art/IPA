"use client";

import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { BrandMark } from "./brand-mark";
import { useShell } from "./shell-context";
import { SidebarNav } from "./sidebar-nav";

/** Desktop sidebar: fixed on the left, can be folded to icons (§4). */
export function Sidebar() {
  const { sidebarCollapsed, setSidebarCollapsed } = useShell();
  return (
    <aside
      aria-label="Sidebar"
      className={cn(
        "sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-border-subtle bg-surface-raised lg:flex",
        sidebarCollapsed ? "w-[var(--sidebar-width-collapsed)]" : "w-[var(--sidebar-width)]",
      )}
    >
      <div className={cn("flex h-[var(--topbar-height)] items-center px-4", sidebarCollapsed && "justify-center px-0")}>
        <Link href="/home" aria-label="Insurance Partners — gå til Home" className="rounded-md">
          <BrandMark collapsed={sidebarCollapsed} />
        </Link>
      </div>
      <div className={cn("flex-1 overflow-y-auto px-3 py-4", sidebarCollapsed && "px-2")}>
        <SidebarNav collapsed={sidebarCollapsed} />
      </div>
      <div className={cn("border-t border-border-subtle p-3", sidebarCollapsed && "flex justify-center px-2")}>
        <Button
          variant="ghost"
          size={sidebarCollapsed ? "icon-sm" : "sm"}
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          aria-label={sidebarCollapsed ? "Fold menuen ud" : "Fold menuen ind til ikoner"}
          aria-expanded={!sidebarCollapsed}
          className={cn(!sidebarCollapsed && "w-full justify-start text-fg-secondary")}
        >
          {sidebarCollapsed ? <PanelLeftOpen aria-hidden /> : <PanelLeftClose aria-hidden />}
          {sidebarCollapsed ? null : "Fold ind"}
        </Button>
      </div>
    </aside>
  );
}
