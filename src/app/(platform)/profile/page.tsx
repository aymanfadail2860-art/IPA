import type { Metadata } from "next";

// PHASE 5: mock data only.
import {
  MOCK_ADVISOR_LEADER,
  MOCK_SESSIONS,
  mockCompetencies,
  mockCompetencyLevelLabels,
  mockDevelopmentAreas,
  mockHistory,
  mockProgression,
  mockStrengths,
} from "@/mocks";

import { ProfileView } from "./profile-view";

export const metadata: Metadata = { title: "Min profil" };

export default function ProfilePage() {
  return (
    <ProfileView
      progression={mockProgression}
      strengths={mockStrengths}
      developmentAreas={mockDevelopmentAreas}
      competencies={mockCompetencies}
      levelLabels={mockCompetencyLevelLabels}
      history={mockHistory}
      leader={{ ...MOCK_ADVISOR_LEADER, grants: MOCK_SESSIONS.leader.grants }}
    />
  );
}
