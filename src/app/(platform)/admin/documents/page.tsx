import type { Metadata } from "next";

import { AccessDenied } from "@/components/common/access-denied";
import { PageContainer } from "@/components/common/page-container";
import { PageHeader } from "@/components/common/page-header";
import { UploadDialog } from "@/components/knowledge-admin/upload-dialog";
import { demoKnowledgeProducts, demoKnowledgeVersions } from "@/dev/demo/data";
import { isDemoMode } from "@/dev/demo/demo-mode";
import { authorize } from "@/lib/auth/server-session";
import { listDocuments, listProducts, listVersions } from "@/lib/knowledge/admin-data";
import { KNOWLEDGE_MANAGER, KNOWLEDGE_WRITE } from "@/lib/knowledge/admin-requirements";
import { meetsRequirement } from "@/lib/auth/permissions";
import { danishDate } from "@/lib/knowledge/retrieval-core";

import { DocumentsView } from "./documents-view";

export const metadata: Metadata = { title: "Dokumenter · Admin" };

export default async function AdminDocumentsPage() {
  // Read with knowledge.document.write or knowledge.version.publish (docs/07 §12).
  const session = await authorize(KNOWLEDGE_MANAGER);
  if (!session) return <AccessDenied />;
  const demo = isDemoMode();
  const canWrite = meetsRequirement(session.grants, KNOWLEDGE_WRITE);
  const [versions, products, documents] = demo
    ? [demoKnowledgeVersions(), demoKnowledgeProducts(), []]
    : await Promise.all([listVersions(), listProducts(), listDocuments()]);

  return (
    <PageContainer>
      <PageHeader
        title="Dokumenter"
        description="Teknisk behandling sker automatisk. Et dokument bliver først autoritativt, når en fagligt ansvarlig godkender det."
        actions={canWrite && !demo ? <UploadDialog products={products} documents={documents} /> : undefined}
      />
      <DocumentsView versions={versions} today={danishDate(new Date())} linkable={!demo} />
    </PageContainer>
  );
}
