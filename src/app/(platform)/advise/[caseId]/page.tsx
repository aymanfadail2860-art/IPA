import type { Metadata } from "next";

import { AccessDenied } from "@/components/common/access-denied";
import { composeCase, emptyWorkspaceContent } from "@/lib/advise/workspace";
import { requireSession } from "@/lib/auth/server-session";
import { getCase } from "@/lib/data/cases";
// Work-area content is a later phase; only the dev seed fixture case has mock content.
import { mockCaseWorkspaceContent } from "@/mocks/advise";

import { CaseWorkspace } from "./case-workspace";

export const metadata: Metadata = { title: "Kundecase" };

export default async function CasePage(props: PageProps<"/advise/[caseId]">) {
  await requireSession();
  const { caseId } = await props.params;
  const { area } = await props.searchParams;

  // RLS: a case the user is not a participant in is indistinguishable from one that does
  // not exist — the page reveals nothing about it.
  const summary = await getCase(caseId);
  if (!summary) return <AccessDenied title="Du har ikke adgang til denne sag" />;

  const customerCase = composeCase(summary, mockCaseWorkspaceContent(summary.id) ?? emptyWorkspaceContent());
  const areaId =
    typeof area === "string" && customerCase.workAreas.some((entry) => entry.id === area) ? area : customerCase.currentAreaId;
  return <CaseWorkspace customerCase={customerCase} areaId={areaId} />;
}
