"use client";

import type { DeviceClass } from "@/config/advise-capabilities";

import { BREAKPOINTS, useMediaQuery } from "./use-media-query";

/** Device class from the viewport (not the content container), so an open Copilot panel never changes it. */
export function useDeviceClass(): DeviceClass {
  const isDesktop = useMediaQuery(BREAKPOINTS.desktop);
  const isTablet = useMediaQuery(BREAKPOINTS.tablet);
  if (isDesktop) return "desktop";
  return isTablet ? "tablet" : "mobile";
}
