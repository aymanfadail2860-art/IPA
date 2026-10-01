import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AccessDenied } from "@/components/common/access-denied";
import { adminSectionById } from "@/config/admin-sections";
import { ADMIN_REQUIREMENT } from "@/config/navigation";
import { authorize } from "@/lib/auth/server-session";
import { getRoleMatrix, listTeamsForAdmin, listUsersForAdmin } from "@/lib/data/identity";
// Learning content is a later phase: mock data. Products, documents, Knowledge Base, versions and
// settings have their own routes backed by the database (docs/07 §12).
import { mockAdminLearningContent } from "@/mocks";

import { AdminSectionView } from "./admin-section-view";

const SECTIONS = ["learning-content", "users", "teams", "permissions"];
/** Sections backed by the identity database require identity.user.manage (also enforced by RLS). */
const IDENTITY_SECTIONS = ["users", "teams", "permissions"];

export async function generateMetadata(props: PageProps<"/admin/[section]">): Promise<Metadata> {
  const { section } = await props.params;
  return { title: `${adminSectionById(section)?.label ?? "Admin"} · Admin` };
}

export default async function AdminSectionPage(props: PageProps<"/admin/[section]">) {
  const { section } = await props.params;
  if (!SECTIONS.includes(section)) notFound();
  // Checked in the page, not only in the layout (layouts cannot block their page's output).
  if (!(await authorize(ADMIN_REQUIREMENT))) return <AccessDenied />;

  let identityData: Awaited<ReturnType<typeof loadIdentity>> = { users: [], teams: [], matrix: { roles: [], rows: [] } };
  if (IDENTITY_SECTIONS.includes(section)) {
    if (!(await authorize({ allOf: ["identity.user.manage"] }))) return <AccessDenied />;
    identityData = await loadIdentity(section);
  }

  return (
    <AdminSectionView
      section={section}
      data={{
        learningContent: mockAdminLearningContent,
        ...identityData,
      }}
    />
  );
}

async function loadIdentity(section: string) {
  const [users, teams, matrix] = await Promise.all([
    section === "users" ? listUsersForAdmin() : [],
    section === "teams" ? listTeamsForAdmin() : [],
    section === "permissions" ? getRoleMatrix() : { roles: [], rows: [] },
  ]);
  return { users, teams, matrix };
}
