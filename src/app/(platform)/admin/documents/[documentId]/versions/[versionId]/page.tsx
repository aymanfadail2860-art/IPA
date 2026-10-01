import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AccessDenied } from "@/components/common/access-denied";
import { PageContainer } from "@/components/common/page-container";
import { PageHeader } from "@/components/common/page-header";
import { ReviewPanel } from "@/components/knowledge-admin/review-panel";
import { StructureView } from "@/components/knowledge-admin/structure-view";
import { VersionStatusBadge } from "@/components/knowledge-admin/version-status";
import { isDemoMode } from "@/dev/demo/demo-mode";
import { meetsRequirement } from "@/lib/auth/permissions";
import { authorize } from "@/lib/auth/server-session";
import { gapsAfterWithdrawal, getVersionDetail, getVersionRow } from "@/lib/knowledge/admin-data";
import { KNOWLEDGE_MANAGER, KNOWLEDGE_PUBLISH, KNOWLEDGE_WRITE } from "@/lib/knowledge/admin-requirements";
import { danishDate } from "@/lib/knowledge/retrieval-core";
import { isUuid } from "@/lib/knowledge/upload-validation";

export const metadata: Metadata = { title: "Version · Admin" };

/** Version / review screen (docs/07 §12, docs/04 §14.2). */
export default async function AdminVersionPage(props: PageProps<"/admin/documents/[documentId]/versions/[versionId]">) {
  const { documentId, versionId } = await props.params;
  const session = await authorize(KNOWLEDGE_MANAGER);
  if (!session) return <AccessDenied />;
  if (isDemoMode() || !isUuid(documentId) || !isUuid(versionId)) notFound();
  const version = await getVersionRow(versionId);
  if (!version || version.documentId !== documentId) notFound();
  const [detail, withdrawalGaps] = await Promise.all([
    getVersionDetail(versionId),
    version.status === "published" ? gapsAfterWithdrawal(versionId) : Promise.resolve([]),
  ]);

  return (
    <PageContainer>
      <PageHeader
        eyebrow={
          <Link href={`/admin/documents/${documentId}`} className="text-fg-link hover:underline">
            {version.documentTitle}
          </Link>
        }
        title={version.versionLabel ? `Version ${version.versionLabel}` : "Version uden betegnelse"}
        description={`${version.productName}`}
        actions={<VersionStatusBadge version={version} today={danishDate(new Date())} />}
      />
      <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <section aria-label="Dokument" className="min-w-0">
          <h2 className="mb-3 text-heading-3">Struktur</h2>
          <StructureView chunks={detail.chunks} />
        </section>
        <ReviewPanel
          version={version}
          detail={detail}
          withdrawalGaps={withdrawalGaps}
          canWrite={meetsRequirement(session.grants, KNOWLEDGE_WRITE)}
          canPublish={meetsRequirement(session.grants, KNOWLEDGE_PUBLISH)}
        />
      </div>
    </PageContainer>
  );
}
