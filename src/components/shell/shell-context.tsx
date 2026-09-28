"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

const SIDEBAR_KEY = "ipa.sidebarCollapsed";
const COPILOT_WIDE_KEY = "ipa.copilotWide";

interface ShellState {
  copilotOpen: boolean;
  openCopilot: () => void;
  closeCopilot: () => void;
  toggleCopilot: () => void;
  /** Wide = half the screen (§4). Remembered per browser until it can be stored per user. */
  copilotWide: boolean;
  setCopilotWide: (wide: boolean) => void;
  searchOpen: boolean;
  setSearchOpen: (open: boolean) => void;
  mobileNavOpen: boolean;
  setMobileNavOpen: (open: boolean) => void;
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (collapsed: boolean) => void;
  /** Context the current page hands to Copilot, e.g. "Erhvervsansvar · Modul 3 · Dækninger". */
  copilotContext: string | null;
  setCopilotContext: (context: string | null) => void;
  /** Breadcrumb trail declared by the current page — only where the hierarchy is real (§4). */
  breadcrumbs: readonly BreadcrumbEntry[] | null;
  setBreadcrumbs: (items: readonly BreadcrumbEntry[] | null) => void;
}

export interface BreadcrumbEntry {
  label: string;
  href?: string;
}

const ShellContext = createContext<ShellState | null>(null);

function readFlag(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === "true";
  } catch {
    return false;
  }
}

function writeFlag(key: string, value: boolean) {
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    /* storage unavailable (private mode) — preference just isn't remembered */
  }
}

export function ShellProvider({ children }: { children: ReactNode }) {
  const [copilotOpen, setCopilotOpen] = useState(false);
  const [copilotWide, setCopilotWideState] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsedState] = useState(false);
  const [copilotContext, setCopilotContext] = useState<string | null>(null);
  const [breadcrumbs, setBreadcrumbs] = useState<readonly BreadcrumbEntry[] | null>(null);

  // Restore remembered preferences after hydration (server always renders the defaults).
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- one-time sync from browser storage */
    setSidebarCollapsedState(readFlag(SIDEBAR_KEY));
    setCopilotWideState(readFlag(COPILOT_WIDE_KEY));
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  const setSidebarCollapsed = useCallback((collapsed: boolean) => {
    setSidebarCollapsedState(collapsed);
    writeFlag(SIDEBAR_KEY, collapsed);
  }, []);

  const setCopilotWide = useCallback((wide: boolean) => {
    setCopilotWideState(wide);
    writeFlag(COPILOT_WIDE_KEY, wide);
  }, []);

  const openCopilot = useCallback(() => setCopilotOpen(true), []);
  const closeCopilot = useCallback(() => setCopilotOpen(false), []);
  const toggleCopilot = useCallback(() => setCopilotOpen((open) => !open), []);

  const value = useMemo(
    () => ({
      copilotOpen,
      openCopilot,
      closeCopilot,
      toggleCopilot,
      copilotWide,
      setCopilotWide,
      searchOpen,
      setSearchOpen,
      mobileNavOpen,
      setMobileNavOpen,
      sidebarCollapsed,
      setSidebarCollapsed,
      copilotContext,
      setCopilotContext,
      breadcrumbs,
      setBreadcrumbs,
    }),
    [
      copilotOpen,
      openCopilot,
      closeCopilot,
      toggleCopilot,
      copilotWide,
      setCopilotWide,
      searchOpen,
      mobileNavOpen,
      sidebarCollapsed,
      setSidebarCollapsed,
      copilotContext,
      breadcrumbs,
    ],
  );

  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
}

export function useShell(): ShellState {
  const value = useContext(ShellContext);
  if (!value) throw new Error("useShell must be used inside <ShellProvider>.");
  return value;
}
