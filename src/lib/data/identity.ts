import "server-only";

import { isDemoMode } from "@/dev/demo/demo-mode";
import { readDemoRole } from "@/dev/demo/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  demoAdminTeams,
  demoAdminUsers,
  demoEmployeesInScope,
  demoRoleMatrix,
  demoScopedTeams,
  demoVisibility,
} from "@/dev/demo/data";
import type { ScopedEmployee, TeamNode } from "@/types/domain";

/* Identity reads for the UI. Every query runs as the signed-in user under RLS. */

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]!.toUpperCase()).join("");
}

/** Teams in the signed-in leader's scope (explicit leader_scopes, incl. descendants where set). */
export async function getMyScopedTeams(): Promise<TeamNode[]> {
  if (isDemoMode()) return demoScopedTeams(await readDemoRole());
  const supabase = await createSupabaseServerClient();
  const identity = supabase.schema("identity");
  const { data: ids } = await identity.rpc("my_scoped_team_ids");
  const teamIds = ((ids ?? []) as unknown[]).map((row) => (typeof row === "string" ? row : (row as Record<string, string>).my_scoped_team_ids));
  if (teamIds.length === 0) return [];
  const { data } = await identity.from("teams").select("id, name, parent_team_id").in("id", teamIds).order("name");
  return ((data ?? []) as { id: string; name: string; parent_team_id: string | null }[]).map((row) => ({
    id: row.id,
    name: row.name,
    parentId: row.parent_team_id,
  }));
}

/** Employees in the signed-in leader's scope, with the scoped teams they belong to. */
export async function getEmployeesInScope(teams: readonly TeamNode[], myUserId: string): Promise<ScopedEmployee[]> {
  if (teams.length === 0) return [];
  if (isDemoMode()) return demoEmployeesInScope(teams, myUserId);
  const supabase = await createSupabaseServerClient();
  const identity = supabase.schema("identity");
  const teamName = new Map(teams.map((team) => [team.id, team.name]));
  const { data: memberships } = await identity
    .from("team_memberships")
    .select("user_id, team_id")
    .in("team_id", [...teamName.keys()]);
  const byUser = new Map<string, string[]>();
  for (const row of (memberships ?? []) as { user_id: string; team_id: string }[]) {
    if (row.user_id === myUserId) continue;
    byUser.set(row.user_id, [...(byUser.get(row.user_id) ?? []), teamName.get(row.team_id)!]);
  }
  if (byUser.size === 0) return [];
  const { data: users } = await identity.from("users").select("id, display_name").in("id", [...byUser.keys()]).order("display_name");
  return ((users ?? []) as { id: string; display_name: string }[]).map((row) => ({
    id: row.id,
    name: row.display_name,
    initials: initials(row.display_name),
    teams: (byUser.get(row.id) ?? []).sort((a, b) => a.localeCompare(b, "da")),
  }));
}

export interface VisibilityRow {
  leaderId: string;
  leaderName: string;
  teamNames: string[];
  permission: string;
}

/** Which leaders can see the signed-in user's data, and under which permissions (docs/04 §13.1). */
export async function getMyVisibility(): Promise<VisibilityRow[]> {
  if (isDemoMode()) return demoVisibility(await readDemoRole());
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.schema("identity").rpc("my_visibility");
  return ((data ?? []) as { leader_id: string; leader_name: string; team_names: string[]; permission: string }[]).map((row) => ({
    leaderId: row.leader_id,
    leaderName: row.leader_name,
    teamNames: row.team_names,
    permission: row.permission,
  }));
}

/** Logs a leader's individual-level view as an access event (docs/03 §10). */
export async function logIndividualAccess(subjectId: string, permission: "learning.progress.read" | "assessment.result.read") {
  // The demo has no audit log (B-003); the caller has already checked analytics.team.read.
  if (isDemoMode()) return true;
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.schema("identity").rpc("log_individual_access", { p_subject_id: subjectId, p_permission: permission });
  return !error;
}

export interface AdminUserRow {
  id: string;
  name: string;
  title: string | null;
  status: string;
  roles: string[];
  teams: string[];
}

/** Users with roles and teams — readable only with identity.user.manage (RLS). */
export async function listUsersForAdmin(): Promise<AdminUserRow[]> {
  if (isDemoMode()) return demoAdminUsers();
  const supabase = await createSupabaseServerClient();
  const identity = supabase.schema("identity");
  const [{ data: users }, { data: userRoles }, { data: memberships }] = await Promise.all([
    identity.from("users").select("id, display_name, job_title, status").order("display_name"),
    identity.from("user_roles").select("user_id, roles(name)"),
    identity.from("team_memberships").select("user_id, teams(name)"),
  ]);
  const rolesBy = new Map<string, string[]>();
  for (const row of (userRoles ?? []) as unknown as { user_id: string; roles: { name: string } | null }[]) {
    if (row.roles) rolesBy.set(row.user_id, [...(rolesBy.get(row.user_id) ?? []), row.roles.name]);
  }
  const teamsBy = new Map<string, string[]>();
  for (const row of (memberships ?? []) as unknown as { user_id: string; teams: { name: string } | null }[]) {
    if (row.teams) teamsBy.set(row.user_id, [...(teamsBy.get(row.user_id) ?? []), row.teams.name]);
  }
  return ((users ?? []) as { id: string; display_name: string; job_title: string | null; status: string }[]).map((row) => ({
    id: row.id,
    name: row.display_name,
    title: row.job_title,
    status: row.status,
    roles: (rolesBy.get(row.id) ?? []).sort(),
    teams: (teamsBy.get(row.id) ?? []).sort((a, b) => a.localeCompare(b, "da")),
  }));
}

export interface AdminTeamRow {
  id: string;
  name: string;
  depth: number;
  members: number;
  leaders: string[];
}

/** The team hierarchy with member counts and leader scopes — identity.user.manage (RLS). */
export async function listTeamsForAdmin(): Promise<AdminTeamRow[]> {
  if (isDemoMode()) return demoAdminTeams();
  const supabase = await createSupabaseServerClient();
  const identity = supabase.schema("identity");
  const [{ data: teams }, { data: memberships }, { data: scopes }, { data: users }] = await Promise.all([
    identity.from("teams").select("id, name, parent_team_id").order("name"),
    identity.from("team_memberships").select("team_id"),
    identity.from("leader_scopes").select("team_id, include_descendants, user_id"),
    identity.from("users").select("id, display_name"),
  ]);
  const nameOf = new Map(((users ?? []) as { id: string; display_name: string }[]).map((row) => [row.id, row.display_name]));
  const rows = (teams ?? []) as { id: string; name: string; parent_team_id: string | null }[];
  const children = new Map<string | null, typeof rows>();
  for (const row of rows) children.set(row.parent_team_id, [...(children.get(row.parent_team_id) ?? []), row]);
  const memberCount = new Map<string, number>();
  for (const row of (memberships ?? []) as { team_id: string }[]) memberCount.set(row.team_id, (memberCount.get(row.team_id) ?? 0) + 1);
  const leadersBy = new Map<string, string[]>();
  for (const row of (scopes ?? []) as { team_id: string; include_descendants: boolean; user_id: string }[]) {
    const label = `${nameOf.get(row.user_id) ?? "Ukendt"}${row.include_descendants ? " (inkl. underteams)" : ""}`;
    leadersBy.set(row.team_id, [...(leadersBy.get(row.team_id) ?? []), label]);
  }
  const ordered: AdminTeamRow[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const row of children.get(parent) ?? []) {
      ordered.push({ id: row.id, name: row.name, depth, members: memberCount.get(row.id) ?? 0, leaders: leadersBy.get(row.id) ?? [] });
      walk(row.id, depth + 1);
    }
  };
  walk(null, 0);
  return ordered;
}

export interface RoleMatrix {
  roles: { key: string; name: string }[];
  rows: { permission: string; description: string; scopes: Record<string, string[]> }[];
}

/** The permission catalogue and role bundles as stored in the database. */
export async function getRoleMatrix(): Promise<RoleMatrix> {
  if (isDemoMode()) return demoRoleMatrix();
  const supabase = await createSupabaseServerClient();
  const identity = supabase.schema("identity");
  const [{ data: roles }, { data: permissions }, { data: rolePermissions }] = await Promise.all([
    identity.from("roles").select("id, key, name"),
    identity.from("permissions").select("id, key, description").order("key"),
    identity.from("role_permissions").select("role_id, permission_id, scope"),
  ]);
  const order = ["advisor", "leader", "administrator"];
  const roleList = ((roles ?? []) as { id: string; key: string; name: string }[]).sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
  const roleKey = new Map(roleList.map((role) => [role.id, role.key]));
  return {
    roles: roleList.map((role) => ({ key: role.key, name: role.name })),
    rows: ((permissions ?? []) as { id: string; key: string; description: string }[]).map((permission) => {
      const scopes: Record<string, string[]> = {};
      for (const row of (rolePermissions ?? []) as { role_id: string; permission_id: string; scope: string }[]) {
        if (row.permission_id !== permission.id) continue;
        const key = roleKey.get(row.role_id)!;
        scopes[key] = [...(scopes[key] ?? []), row.scope].sort();
      }
      return { permission: permission.key, description: permission.description, scopes };
    }),
  };
}
