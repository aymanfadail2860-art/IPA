import type { Metadata } from "next";

// PHASE 5: mock data only.
import { mockProducts, mockProgression } from "@/mocks";

import { LearnOverview } from "./learn-overview";

export const metadata: Metadata = { title: "Learn" };

export default function LearnPage() {
  return <LearnOverview products={mockProducts} progression={mockProgression} />;
}
