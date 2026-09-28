import { describe, expect, it } from "vitest";

import { SHORTCUTS, detectPlatform, formatShortcut, matchesShortcut, type ShortcutDefinition } from "@/config/shortcuts";

const press = (key: string, modifiers: Partial<{ meta: boolean; ctrl: boolean; alt: boolean; shift: boolean }> = {}) => ({
  key,
  metaKey: modifiers.meta ?? false,
  ctrlKey: modifiers.ctrl ?? false,
  altKey: modifiers.alt ?? false,
  shiftKey: modifiers.shift ?? false,
});

describe("keyboard shortcut configuration", () => {
  it("defines ⌘/Ctrl+K for search and ⌘/Ctrl+J for Copilot in one place", () => {
    expect(SHORTCUTS.globalSearch.key).toBe("k");
    expect(SHORTCUTS.copilot.key).toBe("j");
    const keys = Object.values(SHORTCUTS).map((definition) => definition.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("uses ⌘ on macOS and Ctrl elsewhere", () => {
    expect(matchesShortcut(SHORTCUTS.globalSearch, press("k", { meta: true }), "mac")).toBe(true);
    expect(matchesShortcut(SHORTCUTS.globalSearch, press("k", { ctrl: true }), "mac")).toBe(false);
    expect(matchesShortcut(SHORTCUTS.globalSearch, press("k", { ctrl: true }), "other")).toBe(true);
    expect(matchesShortcut(SHORTCUTS.globalSearch, press("K", { ctrl: true }), "other")).toBe(true);
    expect(matchesShortcut(SHORTCUTS.globalSearch, press("k", { ctrl: true, shift: true }), "other")).toBe(false);
    expect(matchesShortcut(SHORTCUTS.copilot, press("k", { ctrl: true }), "other")).toBe(false);
  });

  it("does nothing and is not advertised when disabled", () => {
    const disabled: ShortcutDefinition = { ...SHORTCUTS.copilot, enabled: false };
    expect(matchesShortcut(disabled, press("j", { ctrl: true }), "other")).toBe(false);
    expect(formatShortcut(disabled, "other")).toBeNull();
    expect(formatShortcut(SHORTCUTS.copilot, "mac")).toBe("⌘J");
    expect(formatShortcut(SHORTCUTS.copilot, "other")).toBe("Ctrl+J");
  });

  it("detects the platform from the user agent", () => {
    expect(detectPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)")).toBe("mac");
    expect(detectPlatform("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe("other");
  });
});
