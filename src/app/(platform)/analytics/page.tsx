import type { Metadata } from "next";

import { AccessDenied } from "@/components/common/access-denied";
import { ANALYTICS_REQUIREMENT } from "@/config/navigation";
import { authorize } from "@/lib/auth/server-session";
import { getEmployeesInScope, getMyScopedTeams } from "@/lib/data/identity";
// Learning and assessment figures belong to domains built in later phases: example data.
import { mockLearningTrend, mockTeamDevelopmentAreas, mockTeamMetrics } from "@/mocks";

import { AnalyticsView } from "./analytics-view";

export const metadata: Metadata = { title: "Analytics" };

export default async function AnalyticsPage() {
  // Server-side guard: the page is not served without analytics.team.read.
  const session = await authorize(ANALYTICS_REQUIREMENT);
  if (!session) return <AccessDenied />;

  // Teams and employees come from the leader's explicit scope in the database (RLS).
  const teams = await getMyScopedTeams();
  const employees = await getEmployeesInScope(teams, session.user.id);

  return (
    <AnalyticsView
      teams={teams}
      employees={employees}
      exampleMetrics={mockTeamMetrics}
      exampleDevelopmentAreas={mockTeamDevelopmentAreas}
      exampleTrend={mockLearningTrend}
    />
  );
}
