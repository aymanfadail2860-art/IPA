"use client";

import { useEffect } from "react";

import { useShell } from "@/components/shell/shell-context";

/**
 * Declares the Copilot context of the current page (IA §5): Learn hands over product,
 * path and module; Advise hands over case and work area. Renders nothing.
 */
export function CopilotContext({ value }: { value: string }) {
  const { setCopilotContext } = useShell();
  useEffect(() => {
    setCopilotContext(value);
    return () => setCopilotContext(null);
  }, [value, setCopilotContext]);
  return null;
}
