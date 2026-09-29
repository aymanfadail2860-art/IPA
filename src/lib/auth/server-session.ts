import "server-only";

import { redirect } from "next/navigation";
import { cache } from "react";

import { meetsRequirement, type PermissionGrant, type PermissionKey, type PermissionRequirement, type PermissionScope } from "@/lib/auth/permissions";
import type { Session } from "@/lib/auth/session";
import { isDemoMode } from "@/dev/demo/demo-mode";
import { readDemoRole } from "@/dev/demo/server";
import { demoSession } from "@/dev/demo/data";
import { getSupabaseConfig } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const PERMISSION_KEYS = new Set<PermissionKey>([
  "learning.progress.read",
  "practice.session.write",
  "assessment.result.read",
  "advise.case.write",
  "advise.case.read",
  "analytics.team.read",
  "knowledge.document.read",
  "knowledge.document.read_historical",
  "knowledge.document.write",
  "knowledge.version.publish",
  "identity.user.manage",
  "system.settings.manage",
]);

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

/**
 * The signed-in user's session, built server-side from Supabase Auth and the identity
 * schema (via RLS as that user). Cached per request. Returns null when not signed in, when
 * the account has no active platform user, or when Supabase is not configured.
 */
export const getServerSession = cache(async (): Promise<Session | null> => {
  // Temporary demo without login (B-003): only when no database is connected.
  if (isDemoMode()) return demoSession(await readDemoRole());
  if (!getSupabaseConfig()) return null;
  const supabase = await createSupabaseServerClient();

  const { data: claimsData } = await supabase.auth.getClaims();
  if (!claimsData?.claims?.sub) return null;

  const identity = supabase.schema("identity");
  const { data: userId } = await identity.rpc("current_user_id");
  if (!userId) return null;

  const [{ data: user }, { data: permissions }, { data: memberships }] = await Promise.all([
    identity.from("users").select("id, display_name, job_title").eq("id", userId).single(),
    identity.rpc("my_permissions"),
    identity.from("team_memberships").select("team_id, teams(name)").eq("user_id", userId),
  ]);
  if (!user) return null;

  const grants: PermissionGrant[] = ((permissions ?? []) as { permission: string; scope: string }[])
    .filter((row) => PERMISSION_KEYS.has(row.permission as PermissionKey))
    .map((row) => ({ key: row.permission as PermissionKey, scope: row.scope as PermissionScope }));

  const teamNames = ((memberships ?? []) as unknown as { teams: { name: string } | null }[])
    .map((row) => row.teams?.name)
    .filter((name): name is string => Boolean(name))
    .sort((a, b) => a.localeCompare(b, "da"));

  return {
    user: {
      id: user.id,
      name: user.display_name,
      firstName: user.display_name.split(/\s+/)[0] ?? user.display_name,
      initials: initials(user.display_name),
      title: user.job_title ?? "",
      teamName: teamNames.join(", "),
    },
    grants,
  };
});

/** Server-side guard: the session, or a redirect to /login. */
export async function requireSession(): Promise<Session> {
  const session = await getServerSession();
  if (!session) redirect("/login");
  return session;
}

/**
 * Server-side permission check for a page or action. Returns the session when the
 * requirement is met, otherwise null — the caller renders the access-denied state
 * without loading any protected data.
 */
export async function authorize(requirement: PermissionRequirement): Promise<Session | null> {
  const session = await requireSession();
  return meetsRequirement(session.grants, requirement) ? session : null;
}
