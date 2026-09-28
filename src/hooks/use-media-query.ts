"use client";

import { useSyncExternalStore } from "react";

/** Breakpoint tokens (bp.*) — mirrors Tailwind's md / lg / xl, see docs/05. */
export const BREAKPOINTS = {
  tablet: "(min-width: 768px)",
  desktop: "(min-width: 1024px)",
  wide: "(min-width: 1280px)",
} as const;

export function useMediaQuery(query: string, serverFallback = true): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => serverFallback,
  );
}
