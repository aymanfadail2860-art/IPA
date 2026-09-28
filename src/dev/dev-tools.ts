import type { MockRoleId } from "@/mocks/sessions";

/**
 * DEVELOPMENT-ONLY tooling switch.
 *
 * Dev tools (the role switcher) are shown when running `next dev`, or when a build is
 * explicitly started with NEXT_PUBLIC_IPA_DEV_TOOLS=true (e.g. a preview for design review).
 * They are never an access-control mechanism.
 */
export const DEV_TOOLS_ENABLED =
  process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_IPA_DEV_TOOLS === "true";

export const DEV_ROLE_COOKIE = "ipa-dev-role";

export function isMockRoleId(value: string | undefined): value is MockRoleId {
  return value === "advisor" || value === "leader" || value === "administrator";
}
