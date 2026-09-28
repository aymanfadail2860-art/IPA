import type { Metadata } from "next";
import { notFound } from "next/navigation";

// PHASE 5: mock data only — fictional companies, no customer data.
import { mockCaseById } from "@/mocks";

import { CaseWorkspace } from "./case-workspace";

export async function generateMetadata(props: PageProps<"/advise/[caseId]">): Promise<Metadata> {
  const { caseId } = await props.params;
  return { title: mockCaseById(caseId)?.companyName ?? "Advise" };
}

export default async function CasePage(props: PageProps<"/advise/[caseId]">) {
  const { caseId } = await props.params;
  const { area } = await props.searchParams;
  const customerCase = mockCaseById(caseId);
  if (!customerCase) notFound();
  const areaId = typeof area === "string" && customerCase.workAreas.some((entry) => entry.id === area) ? area : customerCase.currentAreaId;
  return <CaseWorkspace customerCase={customerCase} areaId={areaId} />;
}
