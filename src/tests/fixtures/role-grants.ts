import type { PermissionGrant } from "@/lib/auth/permissions";

/**
 * The default permission bundles per role, as defined in
 * supabase/migrations/20260929000200_identity_catalog.sql. Kept in sync by
 * src/tests/role-catalog.test.ts, which parses the migration.
 */
export const ROLE_GRANTS: Record<"advisor" | "leader" | "administrator", PermissionGrant[]> = {
  advisor: [
    { key: "learning.progress.read", scope: "own" },
    { key: "practice.session.write", scope: "own" },
    { key: "assessment.result.read", scope: "own" },
    { key: "advise.case.read", scope: "own" },
    { key: "advise.case.write", scope: "own" },
  ],
  leader: [
    { key: "learning.progress.read", scope: "own" },
    { key: "learning.progress.read", scope: "team" },
    { key: "practice.session.write", scope: "own" },
    { key: "assessment.result.read", scope: "own" },
    { key: "assessment.result.read", scope: "team" },
    { key: "advise.case.read", scope: "own" },
    { key: "advise.case.write", scope: "own" },
    { key: "analytics.team.read", scope: "team" },
  ],
  administrator: [
    { key: "learning.progress.read", scope: "own" },
    { key: "practice.session.write", scope: "own" },
    { key: "assessment.result.read", scope: "own" },
    { key: "advise.case.read", scope: "own" },
    { key: "advise.case.write", scope: "own" },
    { key: "knowledge.document.read", scope: "all" },
    { key: "knowledge.document.read_historical", scope: "all" },
    { key: "knowledge.document.write", scope: "all" },
    { key: "knowledge.version.publish", scope: "all" },
    { key: "identity.user.manage", scope: "all" },
    { key: "system.settings.manage", scope: "all" },
  ],
};

/** A user holding several roles gets the union of their bundles (e.g. Rådgiver + Leder). */
export function grantsFor(...roles: (keyof typeof ROLE_GRANTS)[]): PermissionGrant[] {
  const seen = new Map<string, PermissionGrant>();
  for (const role of roles) for (const grant of ROLE_GRANTS[role]) seen.set(`${grant.key}:${grant.scope}`, grant);
  return [...seen.values()];
}
