import type { Metadata } from "next";

import { hasPermission } from "@/lib/auth/permissions";
import { requireSession } from "@/lib/auth/server-session";
import { listMyCases } from "@/lib/data/cases";

// PHASE 5: mock data only.
import {
  mockAdminTasks,
  mockAssessments,
  mockChanges,
  mockProducts,
  mockProgression,
  mockRecentTraining,
  mockRecommendedTraining,
  mockTeamStatus,
} from "@/mocks";

import { HomeView } from "./home-view";

export const metadata: Metadata = { title: "Home" };

function greetingForNow(): string {
  const hour = Number(
    new Intl.DateTimeFormat("da-DK", { hour: "numeric", hourCycle: "h23", timeZone: "Europe/Copenhagen" }).format(new Date()),
  );
  if (hour < 10) return "God morgen";
  if (hour < 17) return "God eftermiddag";
  return "God aften";
}

export default async function HomePage() {
  const session = await requireSession();
  // RLS: only cases the user owns or is assigned to.
  const cases = hasPermission(session.grants, "advise.case.read") ? await listMyCases() : [];
  const current = mockProducts.find((product) => product.slug === "erhvervsansvar")!;
  return (
    <HomeView
      greeting={greetingForNow()}
      continueLearning={{
        product: current.name,
        href: `/learn/${current.slug}/daekninger`,
        module: mockProgression.currentModule,
        moduleCount: mockProgression.moduleCount,
        moduleTitle: "Undtagelser",
      }}
      recommended={mockRecommendedTraining}
      cases={cases.filter((entry) => entry.status === "active" || entry.status === "awaitingCustomer")}
      recentTraining={mockRecentTraining[0]}
      assessments={mockAssessments}
      progression={mockProgression}
      changes={mockChanges}
      teamStatus={mockTeamStatus}
      adminTasks={mockAdminTasks}
    />
  );
}
