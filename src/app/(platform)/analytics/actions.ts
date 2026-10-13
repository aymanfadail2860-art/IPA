"use server";

import { hasPermission } from "@/lib/auth/permissions";
import { sessionInArea } from "@/lib/auth/server-session";
import { logIndividualAccess } from "@/lib/data/identity";

/**
 * Opening an employee view is an individual-level access and is logged in audit
 * (docs/03 §10). The database refuses the log — and thereby the view — outside the
 * leader's scope.
 */
export async function openEmployeeView(subjectId: string): Promise<{ allowed: boolean }> {
  // Not in the beta (B-035, L2): the area is hidden, and so is its action.
  const session = await sessionInArea("analytics");
  if (!session || !hasPermission(session.grants, "analytics.team.read")) return { allowed: false };
  return { allowed: await logIndividualAccess(subjectId, "learning.progress.read") };
}
