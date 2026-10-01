import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AccessDenied } from "@/components/common/access-denied";
import { PageContainer } from "@/components/common/page-container";
import { PageHeader } from "@/components/common/page-header";
import { UploadDialog } from "@/components/knowledge-admin/upload-dialog";
import { StatusBadge } from "@/components/status/status-badge";
import { isDemoMode } from "@/dev/demo/demo-mode";
import { meetsRequirement } from "@/lib/auth/permissions";
import { authorize } from "@/lib/auth/server-session";
import { getDocument, grantCandidates, listConflicts, listGaps, listGrants, listProducts, listVersions } from "@/lib/knowledge/admin-data";
import { KNOWLEDGE_MANAGER, KNOWLEDGE_PUBLISH, KNOWLEDGE_WRITE } from "@/lib/knowledge/admin-requirements";
import { DOCUMENT_TYPES } from "@/lib/knowledge/document-types";
import { danishDate } from "@/lib/knowledge/retrieval-core";
import { isUuid } from "@/lib/knowledge/upload-validation";

import { DocumentView } from "./document-view";

export const metadata: Metadata = { title: "Dokument · Admin" };

/** Document (docs/07 §12): overview with the tabs Versioner, Adgang, Konflikter. */
export default async function AdminDocumentPage(props: PageProps<"/admin/documents/[documentId]">) {
  const { documentId } = await props.params;
  const session = await authorize(KNOWLEDGE_MANAGER);
  if (!session) return <AccessDenied />;
  if (isDemoMode() || !isUuid(documentId)) notFound();
  const document = await getDocument(documentId);
  if (!document) notFound();
  const canWrite = meetsRequirement(session.grants, KNOWLEDGE_WRITE);
  const [versions, grants, conflicts, gaps, products, candidates] = await Promise.all([
    listVersions(documentId),
    listGrants(documentId),
    listConflicts({ documentId }),
    listGaps(documentId),
    listProducts(),
    canWrite ? grantCandidates() : Promise.resolve({ teams: [], users: [] }),
  ]);
  const today = danishDate(new Date());
  const current = versions.find((version) => version.status === "published" && (version.validFrom ?? "") <= today && (!version.validTo || version.validTo > today));

  return (
    <PageContainer>
      <PageHeader
        eyebrow={document.productName}
        title={document.title}
        description={`${DOCUMENT_TYPES.find((type) => type.key === document.documentType)?.label ?? document.documentType} · Kilde: ${
          document.sourceType === "manual_upload" ? "manuel upload" : document.sourceType
        } · Gældende version: ${current ? (current.versionLabel ?? "uden betegnelse") : "ingen"}`}
        actions={
          <>
            {gaps.length > 0 ? <StatusBadge status="warning" label="Hul i gyldigheden" /> : null}
            {canWrite ? <UploadDialog products={products} documents={[]} fixedDocument={{ id: document.id, title: document.title }} /> : null}
          </>
        }
      />
      <DocumentView
        document={document}
        versions={versions}
        grants={grants}
        conflicts={conflicts}
        gaps={gaps}
        products={products}
        candidates={candidates}
        today={today}
        canWrite={canWrite}
        canPublish={meetsRequirement(session.grants, KNOWLEDGE_PUBLISH)}
      />
    </PageContainer>
  );
}
