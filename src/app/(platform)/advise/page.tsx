import type { Metadata } from "next";

// PHASE 5: mock data only — fictional companies, no customer data.
import { mockCases } from "@/mocks";

import { AdviseOverview } from "./advise-overview";

export const metadata: Metadata = { title: "Advise" };

export default function AdvisePage() {
  return <AdviseOverview cases={mockCases} />;
}
