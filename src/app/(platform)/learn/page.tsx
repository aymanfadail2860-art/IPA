import type { Metadata } from "next";

import { requireSession } from "@/lib/auth/server-session";

// PHASE 5: mock data only.
import { mockProducts, mockProgression } from "@/mocks";

import { LearnOverview } from "./learn-overview";

export const metadata: Metadata = { title: "Learn" };

export default async function LearnPage() {
  await requireSession();
  return <LearnOverview products={mockProducts} progression={mockProgression} />;
}
