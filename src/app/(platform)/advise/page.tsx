import type { Metadata } from "next";

import { hasPermission } from "@/lib/auth/permissions";
import { requireArea } from "@/lib/auth/server-session";
import { listMyCases } from "@/lib/data/cases";

import { AdviseOverview } from "./advise-overview";

export const metadata: Metadata = { title: "Advise" };

export default async function AdvisePage() {
  // Advise is postponed in the beta (B-035): not served there.
  const session = await requireArea("advise");
  const canRead = hasPermission(session.grants, "advise.case.read");
  // RLS returns only cases the user owns or is assigned to — the same rule for every role.
  const cases = canRead ? await listMyCases() : [];
  return <AdviseOverview cases={cases} canRead={canRead} />;
}
