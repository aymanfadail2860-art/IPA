"use client";

import { useEffect, useSyncExternalStore } from "react";

import {
  SHORTCUTS,
  detectPlatform,
  formatShortcut,
  matchesShortcut,
  type Platform,
  type ShortcutId,
} from "@/config/shortcuts";

const noopSubscribe = () => () => {};

export function usePlatform(): Platform {
  return useSyncExternalStore(
    noopSubscribe,
    () => detectPlatform(navigator.userAgent),
    () => "other",
  );
}

/** Registers a global handler for a configured shortcut. Disabled shortcuts do nothing. */
export function useShortcut(id: ShortcutId, handler: () => void) {
  const platform = usePlatform();
  useEffect(() => {
    const definition = SHORTCUTS[id];
    if (!definition.enabled) return;
    function onKeyDown(event: KeyboardEvent) {
      if (matchesShortcut(definition, event, platform)) {
        event.preventDefault();
        handler();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [id, handler, platform]);
}

/** Label for tooltips/help, or null when the shortcut is disabled (then it is not shown). */
export function useShortcutLabel(id: ShortcutId): string | null {
  return formatShortcut(SHORTCUTS[id], usePlatform());
}
