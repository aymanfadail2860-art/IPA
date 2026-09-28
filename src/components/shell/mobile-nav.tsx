"use client";

import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";

import { BrandMark } from "./brand-mark";
import { useShell } from "./shell-context";
import { SidebarNav } from "./sidebar-nav";

/** Below the desktop breakpoint the sidebar becomes a drawer (§19). */
export function MobileNav() {
  const { mobileNavOpen, setMobileNavOpen } = useShell();
  return (
    <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
      <SheetContent side="left" className="w-72 gap-0 bg-surface-raised p-0">
        <SheetTitle className="flex h-[var(--topbar-height)] items-center border-b border-border-subtle px-4">
          <BrandMark />
        </SheetTitle>
        <SheetDescription className="sr-only">Hovednavigation</SheetDescription>
        <div className="overflow-y-auto px-3 py-4">
          <SidebarNav onNavigate={() => setMobileNavOpen(false)} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
