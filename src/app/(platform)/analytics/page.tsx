import type { Metadata } from "next";

import { RequirePermission } from "@/components/common/require-permission";
// PHASE 5: mock data only.
import {
  mockCompetencies,
  mockLearningTrend,
  mockTeamDevelopmentAreas,
  mockTeamMembers,
  mockTeamMetrics,
  mockTeams,
} from "@/mocks";

import { AnalyticsView } from "./analytics-view";

export const metadata: Metadata = { title: "Analytics" };

export default function AnalyticsPage() {
  return (
    <RequirePermission requirement={{ anyOf: ["analytics.team.read"] }}>
      <AnalyticsView
        teams={mockTeams}
        metrics={mockTeamMetrics}
        developmentAreas={mockTeamDevelopmentAreas}
        trend={mockLearningTrend}
        members={mockTeamMembers}
        competencies={mockCompetencies}
      />
    </RequirePermission>
  );
}
