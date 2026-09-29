import { getSupabaseConfig } from "@/lib/supabase/config";

/**
 * ⚠ TEMPORARY DEMO MODE WITHOUT LOGIN — decision B-003 (docs/decisions.md).
 *
 * The public Vercel demo has no database until the project is finished. Until then it
 * runs without login on fictional development data, with a clearly marked role switcher.
 *
 * Safety: demo mode is only active when NO Supabase connection is configured. With a
 * database connected (locally, in tests, and in Vercel once connected) login and
 * server-side authorization apply exactly as specified in docs/06 — demo mode can never
 * expose real data without login.
 *
 * Removal (when the demo is connected to Supabase): set this flag to false, then delete
 * src/dev/demo/, src/mocks/demo.ts and the `isDemoMode()` branches.
 */
export const DEMO_WITHOUT_LOGIN_ENABLED = true;

export function isDemoMode(): boolean {
  return DEMO_WITHOUT_LOGIN_ENABLED && getSupabaseConfig() === null;
}

export const DEMO_ROLES = ["advisor", "leader", "administrator"] as const;
export type DemoRole = (typeof DEMO_ROLES)[number];

export const DEMO_ROLE_LABELS: Record<DemoRole, string> = {
  advisor: "Rådgiver",
  leader: "Leder",
  administrator: "Administrator",
};

export const DEMO_ROLE_COOKIE = "ipa-demo-role";

/** Unknown or missing values fall back to Rådgiver, the least privileged view. */
export function parseDemoRole(value: string | undefined | null): DemoRole {
  return DEMO_ROLES.includes(value as DemoRole) ? (value as DemoRole) : "advisor";
}
