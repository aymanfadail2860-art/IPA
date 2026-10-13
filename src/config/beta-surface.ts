/**
 * The fast beta (B-035, docs/beta.md §1, L2; B-037): areas outside the beta's scope are hidden —
 * not in the navigation, the search, the user menu or on Home, and not served: the proxy answers
 * 404 before anything is rendered, the pages answer 404 again (requireArea), and their server
 * actions refuse (sessionInArea). Advise is postponed; Analytics (phase 15) and Min profil
 * (phase 13) show only development mock data. Home, Learn, Copilot, Practice, Assessment and
 * Admin stay. The temporary demo without login (B-003) is not the beta and keeps every area.
 *
 * No dependencies: the proxy imports this module.
 */

/** The hidden areas (NAV_ITEMS ids) and the URL prefix of each (a test checks they match). */
export const BETA_HIDDEN_AREAS: Readonly<Record<string, string>> = Object.freeze({
  advise: "/advise",
  analytics: "/analytics",
  profile: "/profile",
});

/** Which product surface a session sees: the beta, or the demo without login (B-003). */
export type Surface = "beta" | "demo";

export function surfaceOf(session: { demo?: unknown }): Surface {
  return session.demo ? "demo" : "beta";
}

/** Whether an area (a NAV_ITEMS id) exists on this surface at all. */
export function isAreaAvailable(id: string, surface: Surface): boolean {
  return surface === "demo" || !Object.hasOwn(BETA_HIDDEN_AREAS, id);
}

/** Whether a path (without query or fragment) lies inside an area the beta hides. */
export function isHiddenInBeta(pathname: string): boolean {
  return Object.values(BETA_HIDDEN_AREAS).some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}
