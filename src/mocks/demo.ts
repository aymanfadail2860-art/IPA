/**
 * ⚠ MOCK DATA — DEVELOPMENT ONLY. Demo mode without login (decision B-003), used only when no database is
 * connected (src/dev/demo/demo-mode.ts). Built from the fictional development fixtures in
 * scripts/seed-fixtures.mjs, so the demo shows the same people, teams and cases as the
 * local seed. The functions below imitate what RLS would return for each fixture user —
 * they are a preview, not access control. Must never be used as or mixed with production data.
 */
import type { PermissionGrant, PermissionKey } from "@/lib/auth/permissions";
import type { Session } from "@/lib/auth/session";
import type { DemoRole } from "@/dev/demo/demo-mode";
import type { CaseParticipant, CaseStatus, CaseSummary, ScopedEmployee, TeamNode } from "@/types/domain";

import { SEED_CASES, SEED_TEAMS, SEED_USERS } from "../../scripts/seed-fixtures.mjs";

type SeedUser = (typeof SEED_USERS)[number];
type RoleKey = "advisor" | "leader" | "administrator";

/** Role bundles as in supabase/migrations/20260929000200_identity_catalog.sql (kept in sync by a test). */
export const DEMO_ROLE_BUNDLES: Record<RoleKey, PermissionGrant[]> = {
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

const ROLE_NAMES: Record<RoleKey, string> = { advisor: "Rådgiver", leader: "Leder", administrator: "Administrator" };

const PERMISSION_DESCRIPTIONS: Record<PermissionKey, string> = {
  "learning.progress.read": "Læse læringsprogression",
  "practice.session.write": "Gennemføre og gemme træningssessioner",
  "assessment.result.read": "Læse Assessment-resultater",
  "advise.case.read": "Læse kundecases, brugeren ejer eller er tildelt",
  "advise.case.write": "Oprette og redigere kundecases, brugeren ejer eller er tildelt",
  "analytics.team.read": "Se Analytics for teams i eget scope",
  "knowledge.document.read": "Læse dokumenter i vidensgrundlaget",
  "knowledge.document.read_historical": "Læse historiske dokumentversioner",
  "knowledge.document.write": "Uploade og redigere dokumenter",
  "knowledge.version.publish": "Godkende og aktivere dokumentversioner",
  "identity.user.manage": "Administrere brugere, roller, teams og lederscopes",
  "system.settings.manage": "Administrere systemindstillinger",
};

/** Which fixture user the demo shows for each role. */
export const DEMO_PERSONAS: Record<DemoRole, SeedUser["key"]> = {
  advisor: "advisorA",
  leader: "leaderNord",
  administrator: "admin",
};

const CASE_STATUS: Record<string, CaseStatus> = {
  draft: "draft",
  active: "active",
  awaiting_customer: "awaitingCustomer",
  closed: "closed",
};

const ACCESS: Record<string, CaseParticipant["access"]> = { editor: "Kan redigere", viewer: "Kan læse" };

const CASE_UPDATED_AT = ["2026-09-24T09:30:00Z", "2026-09-22T13:10:00Z", "2026-09-18T08:45:00Z"];

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]!.toUpperCase()).join("");
}

function userByKey(key: string): SeedUser {
  const user = SEED_USERS.find((candidate) => candidate.key === key);
  if (!user) throw new Error(`Ukendt demobruger: ${key}`);
  return user;
}

/** Stable demo id for a fixture user. */
export function demoUserId(key: string): string {
  return `demo-${key}`;
}

function teamName(id: string): string {
  return SEED_TEAMS.find((team) => team.id === id)?.name ?? "Ukendt team";
}

function grantsOf(user: SeedUser): PermissionGrant[] {
  const seen = new Map<string, PermissionGrant>();
  for (const role of user.roles as RoleKey[]) for (const grant of DEMO_ROLE_BUNDLES[role]) seen.set(`${grant.key}:${grant.scope}`, grant);
  return [...seen.values()];
}

export function demoSession(role: DemoRole): Session {
  const user = userByKey(DEMO_PERSONAS[role]);
  return {
    user: {
      id: demoUserId(user.key),
      name: user.displayName,
      firstName: user.displayName.split(/\s+/)[0] ?? user.displayName,
      initials: initials(user.displayName),
      title: user.jobTitle,
      teamName: user.teams.map(teamName).sort((a, b) => a.localeCompare(b, "da")).join(", "),
    },
    grants: grantsOf(user),
    demo: { role },
  };
}

/** Own and assigned cases, as the database would return them for the persona. */
export function demoCases(role: DemoRole): CaseSummary[] {
  const me = DEMO_PERSONAS[role];
  return SEED_CASES.map((seed, index) => ({ seed, index }))
    .filter(({ seed }) => seed.owner === me || (seed.shares ?? []).some((share) => share.user === me))
    .map(({ seed, index }) => {
      const owner = userByKey(seed.owner);
      const participants: CaseParticipant[] = [
        { userId: demoUserId(owner.key), name: owner.displayName, initials: initials(owner.displayName), access: "Ejer" },
        ...(seed.shares ?? []).map((share) => {
          const user = userByKey(share.user);
          return { userId: demoUserId(user.key), name: user.displayName, initials: initials(user.displayName), access: ACCESS[share.access] ?? "Kan læse" };
        }),
      ];
      return {
        id: seed.id,
        companyName: seed.companyName,
        status: CASE_STATUS[seed.status] ?? "draft",
        updatedAt: CASE_UPDATED_AT[index] ?? CASE_UPDATED_AT[0]!,
        participants,
      };
    });
}

function descendantsOf(teamId: string): string[] {
  const children = SEED_TEAMS.filter((team) => team.parentId === teamId).map((team) => team.id);
  return [teamId, ...children.flatMap(descendantsOf)];
}

function scopedTeamIds(user: SeedUser): string[] {
  const ids = new Set<string>();
  for (const scope of user.leaderScopes ?? []) {
    for (const id of scope.includeDescendants ? descendantsOf(scope.teamId) : [scope.teamId]) ids.add(id);
  }
  return [...ids];
}

export function demoScopedTeams(role: DemoRole): TeamNode[] {
  const ids = scopedTeamIds(userByKey(DEMO_PERSONAS[role]));
  return SEED_TEAMS.filter((team) => ids.includes(team.id))
    .map((team) => ({ id: team.id, name: team.name, parentId: team.parentId ?? null }))
    .sort((a, b) => a.name.localeCompare(b.name, "da"));
}

export function demoEmployeesInScope(teams: readonly TeamNode[], myUserId: string): ScopedEmployee[] {
  const inScope = new Map(teams.map((team) => [team.id, team.name]));
  return SEED_USERS.filter((user) => demoUserId(user.key) !== myUserId)
    .map((user) => ({ user, teams: user.teams.filter((id) => inScope.has(id)).map((id) => inScope.get(id)!) }))
    .filter(({ teams: memberOf }) => memberOf.length > 0)
    .map(({ user, teams: memberOf }) => ({
      id: demoUserId(user.key),
      name: user.displayName,
      initials: initials(user.displayName),
      teams: memberOf.sort((a, b) => a.localeCompare(b, "da")),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "da"));
}

/** Which leaders can see the persona's data (docs/04 §13.1), as my_visibility() would return. */
export function demoVisibility(role: DemoRole) {
  const me = userByKey(DEMO_PERSONAS[role]);
  return SEED_USERS.filter((leader) => leader.key !== me.key && (leader.leaderScopes ?? []).length > 0)
    .flatMap((leader) => {
      const scoped = scopedTeamIds(leader);
      const shared = me.teams.filter((id) => scoped.includes(id)).map(teamName).sort((a, b) => a.localeCompare(b, "da"));
      if (shared.length === 0) return [];
      return grantsOf(leader)
        .filter((grant) => grant.scope === "team")
        .map((grant) => ({ leaderId: demoUserId(leader.key), leaderName: leader.displayName, teamNames: shared, permission: grant.key }));
    });
}

export function demoAdminUsers() {
  return SEED_USERS.map((user) => ({
    id: demoUserId(user.key),
    name: user.displayName,
    title: user.jobTitle,
    status: "active",
    roles: (user.roles as RoleKey[]).map((role) => ROLE_NAMES[role]).sort(),
    teams: user.teams.map(teamName).sort((a, b) => a.localeCompare(b, "da")),
  })).sort((a, b) => a.name.localeCompare(b.name, "da"));
}

export function demoAdminTeams() {
  const rows: { id: string; name: string; depth: number; members: number; leaders: string[] }[] = [];
  const walk = (parentId: string | undefined, depth: number) => {
    for (const team of SEED_TEAMS.filter((candidate) => candidate.parentId === parentId).sort((a, b) => a.name.localeCompare(b.name, "da"))) {
      rows.push({
        id: team.id,
        name: team.name,
        depth,
        members: SEED_USERS.filter((user) => user.teams.includes(team.id)).length,
        leaders: SEED_USERS.flatMap((user) =>
          (user.leaderScopes ?? [])
            .filter((scope) => scope.teamId === team.id)
            .map((scope) => `${user.displayName}${scope.includeDescendants ? " (inkl. underteams)" : ""}`),
        ),
      });
      walk(team.id, depth + 1);
    }
  };
  walk(undefined, 0);
  return rows;
}

export function demoRoleMatrix() {
  const roles: RoleKey[] = ["advisor", "leader", "administrator"];
  return {
    roles: roles.map((key) => ({ key, name: ROLE_NAMES[key] })),
    rows: (Object.keys(PERMISSION_DESCRIPTIONS) as PermissionKey[]).sort().map((permission) => {
      const scopes: Record<string, string[]> = {};
      for (const role of roles) {
        const granted = DEMO_ROLE_BUNDLES[role].filter((grant) => grant.key === permission).map((grant) => grant.scope);
        if (granted.length > 0) scopes[role] = granted.sort();
      }
      return { permission, description: PERMISSION_DESCRIPTIONS[permission], scopes };
    }),
  };
}
