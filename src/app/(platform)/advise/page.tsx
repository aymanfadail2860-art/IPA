import type { Metadata } from "next";

import { hasPermission } from "@/lib/auth/permissions";
import { requireSession } from "@/lib/auth/server-session";
import { listMyCases } from "@/lib/data/cases";

import { AdviseOverview } from "./advise-overview";

export const metadata: Metadata = { title: "Advise" };

export default async function AdvisePage() {
  const session = await requireSession();
  const canRead = hasPermission(session.grants, "advise.case.read");
  // RLS returns only cases the user owns or is assigned to — the same rule for every role.
  const cases = canRead ? await listMyCases() : [];
  return <AdviseOverview cases={cases} canRead={canRead} />;
}
