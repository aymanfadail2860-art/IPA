/**
 * What can be done in Advise per device class (docs/04-ui-ux-design.md §19):
 *  - Mobile:  read only
 *  - Tablet:  reading and working notes — no accepting or rejecting AI suggestions
 *  - Desktop: full functionality
 *
 * Disabled actions always carry a Danish reason (docs/04 §3.6).
 */
export type DeviceClass = "mobile" | "tablet" | "desktop";

export interface AdviseCapabilities {
  /** Ask for AI suggestions (on demand). */
  requestSuggestions: boolean;
  /** Accept, edit-and-accept or reject AI suggestions, and undo validations. */
  reviewSuggestions: boolean;
  /** Create or edit working notes. */
  editNotes: boolean;
}

export const ADVISE_CAPABILITIES: Record<DeviceClass, AdviseCapabilities> = {
  mobile: { requestSuggestions: false, reviewSuggestions: false, editNotes: false },
  tablet: { requestSuggestions: false, reviewSuggestions: false, editNotes: true },
  desktop: { requestSuggestions: true, reviewSuggestions: true, editNotes: true },
};

export const ADVISE_DISABLED_REASONS = {
  desktopOnly: "Kan kun redigeres på desktop",
  notesTabletOrDesktop: "Noter kan kun redigeres på tablet eller desktop",
} as const;

/** Breakpoints match bp.tablet (768 px) and bp.desktop (1024 px). */
export function deviceClassForWidth(width: number): DeviceClass {
  if (width < 768) return "mobile";
  if (width < 1024) return "tablet";
  return "desktop";
}
