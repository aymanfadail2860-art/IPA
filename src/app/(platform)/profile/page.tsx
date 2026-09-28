import type { Metadata } from "next";

import type { PermissionGrant, PermissionKey } from "@/lib/auth/permissions";
import { requireSession } from "@/lib/auth/server-session";
import { getMyVisibility } from "@/lib/data/identity";
// Learning, competencies and history are later phases: development mock data.
import {
  mockCompetencies,
  mockCompetencyLevelLabels,
  mockDevelopmentAreas,
  mockHistory,
  mockProgression,
  mockStrengths,
} from "@/mocks";

import { ProfileView, type LeaderVisibility } from "./profile-view";

export const metadata: Metadata = { title: "Min profil" };

export default async function ProfilePage() {
  await requireSession();
  // Synlighed: derived from the leaders' actual scopes and permissions in the database.
  const rows = await getMyVisibility();
  const leaders = new Map<string, LeaderVisibility>();
  for (const row of rows) {
    const leader = leaders.get(row.leaderId) ?? { id: row.leaderId, name: row.leaderName, teamNames: row.teamNames, grants: [] };
    leader.grants = [...leader.grants, { key: row.permission as PermissionKey, scope: "team" } satisfies PermissionGrant];
    leaders.set(row.leaderId, leader);
  }

  return (
    <ProfileView
      progression={mockProgression}
      strengths={mockStrengths}
      developmentAreas={mockDevelopmentAreas}
      competencies={mockCompetencies}
      levelLabels={mockCompetencyLevelLabels}
      history={mockHistory}
      leaders={[...leaders.values()]}
    />
  );
}
