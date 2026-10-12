/**
 * Permission model (docs/03-technical-architecture.md §10).
 *
 * Access is ALWAYS decided on permission + scope — never on a role name. Roles are only
 * named bundles of permissions. The keys below are the examples fixed in phase 3; the full
 * catalogue is a non-blocking decision that is extended during implementation.
 *
 * These checks shape the UI and are repeated server-side. They are not the security boundary
 * on their own: the database enforces access with RLS and its functions (phase 6).
 */

export type PermissionScope = "own" | "team" | "all";

export type PermissionKey =
  | "learning.progress.read"
  | "practice.session.write"
  | "assessment.result.read"
  | "advise.case.write"
  | "advise.case.read"
  | "analytics.team.read"
  | "knowledge.document.read"
  | "knowledge.document.read_historical"
  | "knowledge.document.write"
  | "knowledge.version.publish"
  | "identity.user.manage"
  | "system.settings.manage"
  /** Phase 8 (B-014): reading AI-log metadata for quality work — gives no access while switched off. */
  | "ai.quality.read";

export interface PermissionGrant {
  key: PermissionKey;
  scope: PermissionScope;
}

/** A requirement is met when every `allOf` key and at least one `anyOf` key is granted. */
export interface PermissionRequirement {
  allOf?: readonly PermissionKey[];
  anyOf?: readonly PermissionKey[];
}

export function hasPermission(
  grants: readonly PermissionGrant[],
  key: PermissionKey,
  scope?: PermissionScope,
): boolean {
  return grants.some((grant) => grant.key === key && (scope === undefined || grant.scope === scope));
}

export function meetsRequirement(
  grants: readonly PermissionGrant[],
  requirement: PermissionRequirement | undefined,
): boolean {
  if (!requirement) return true;
  const { allOf = [], anyOf = [] } = requirement;
  const hasAll = allOf.every((key) => hasPermission(grants, key));
  const hasAny = anyOf.length === 0 || anyOf.some((key) => hasPermission(grants, key));
  return hasAll && hasAny;
}
