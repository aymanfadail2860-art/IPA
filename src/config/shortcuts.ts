/**
 * Keyboard shortcuts — the single place they are defined (docs/04-ui-ux-design.md §15.4).
 *
 * Components never hard-code key combinations. To change or disable a shortcut
 * (organisation-wide now, per user later), change it here. A disabled shortcut is also
 * removed from tooltips and help texts, because `formatShortcut` returns null for it.
 */

export type ShortcutId = "globalSearch" | "copilot";

export interface ShortcutDefinition {
  id: ShortcutId;
  /** Danish description shown in help texts. */
  description: string;
  /** Lower-case key pressed together with the platform modifier (⌘ on macOS, Ctrl elsewhere). */
  key: string;
  enabled: boolean;
}

export const SHORTCUTS: Record<ShortcutId, ShortcutDefinition> = {
  globalSearch: { id: "globalSearch", description: "Global søgning", key: "k", enabled: true },
  copilot: { id: "copilot", description: "Åbn Copilot", key: "j", enabled: true },
};

export type Platform = "mac" | "other";

export interface KeyEventLike {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

export function matchesShortcut(
  definition: ShortcutDefinition,
  event: KeyEventLike,
  platform: Platform,
): boolean {
  if (!definition.enabled) return false;
  if (event.altKey || event.shiftKey) return false;
  const modifierPressed = platform === "mac" ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  return modifierPressed && event.key.toLowerCase() === definition.key;
}

/** Human-readable label, or null when the shortcut is disabled (so it is not advertised). */
export function formatShortcut(definition: ShortcutDefinition, platform: Platform): string | null {
  if (!definition.enabled) return null;
  const key = definition.key.toUpperCase();
  return platform === "mac" ? `⌘${key}` : `Ctrl+${key}`;
}

export function detectPlatform(userAgent: string): Platform {
  return /Mac|iPhone|iPad|iPod/i.test(userAgent) ? "mac" : "other";
}
