import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { adminSectionById } from "@/config/admin-sections";
import { SHORTCUTS } from "@/config/shortcuts";
// PHASE 5: mock data only.
import {
  MOCK_ROLE_LABELS,
  MOCK_SESSIONS,
  mockAdminDocuments,
  mockAdminLearningContent,
  mockAdminProducts,
  mockAdminTeams,
  mockAdminUsers,
  mockAdminVersions,
  mockDocumentConflicts,
  mockKnowledgeGaps,
} from "@/mocks";

import { AdminSectionView } from "./admin-section-view";

const SECTIONS = ["products", "documents", "knowledge-base", "learning-content", "users", "teams", "permissions", "versions", "settings"];

export async function generateMetadata(props: PageProps<"/admin/[section]">): Promise<Metadata> {
  const { section } = await props.params;
  return { title: `${adminSectionById(section)?.label ?? "Admin"} · Admin` };
}

export default async function AdminSectionPage(props: PageProps<"/admin/[section]">) {
  const { section } = await props.params;
  if (!SECTIONS.includes(section)) notFound();

  const roles = (Object.keys(MOCK_SESSIONS) as (keyof typeof MOCK_SESSIONS)[]).map((id) => ({
    id,
    label: MOCK_ROLE_LABELS[id],
    grants: MOCK_SESSIONS[id].grants,
  }));

  return (
    <AdminSectionView
      section={section}
      data={{
        documents: mockAdminDocuments,
        products: mockAdminProducts,
        gaps: mockKnowledgeGaps,
        conflicts: mockDocumentConflicts,
        learningContent: mockAdminLearningContent,
        users: mockAdminUsers,
        teams: mockAdminTeams,
        versions: mockAdminVersions,
        roles,
        shortcuts: Object.values(SHORTCUTS),
      }}
    />
  );
}
