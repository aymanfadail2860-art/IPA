import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AccessDenied } from "@/components/common/access-denied";
import { PageContainer } from "@/components/common/page-container";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState } from "@/components/states/empty-state";
import { Card } from "@/components/ui/card";
import { ADMIN_REQUIREMENT } from "@/config/navigation";
import { isDemoMode } from "@/dev/demo/demo-mode";
import { authorize } from "@/lib/auth/server-session";
import { listDocuments, listProducts } from "@/lib/knowledge/admin-data";
import { DOCUMENT_TYPES } from "@/lib/knowledge/document-types";
import { isUuid } from "@/lib/knowledge/upload-validation";

export const metadata: Metadata = { title: "Produkt · Admin" };

/** Product page with its documents (docs/07 §12). Learning paths are linked in a later phase. */
export default async function AdminProductPage(props: PageProps<"/admin/products/[productId]">) {
  const { productId } = await props.params;
  if (!(await authorize(ADMIN_REQUIREMENT))) return <AccessDenied />;
  if (isDemoMode() || !isUuid(productId)) notFound();
  const [products, documents] = await Promise.all([listProducts(), listDocuments(productId)]);
  const product = products.find((entry) => entry.id === productId);
  if (!product) notFound();
  return (
    <PageContainer>
      <PageHeader eyebrow="Produkt" title={product.name} description={product.category ?? undefined} />
      {documents.length === 0 ? (
        <EmptyState title="Ingen dokumenter">Upload det første dokument til produktet under Dokumenter.</EmptyState>
      ) : (
        <Card className="p-0">
          <ul className="divide-y divide-border-subtle">
            {documents.map((document) => (
              <li key={document.id} className="flex flex-wrap items-center justify-between gap-2 px-6 py-3">
                <Link href={`/admin/documents/${document.id}`} className="font-medium text-fg-link hover:underline">
                  {document.title}
                </Link>
                <span className="text-caption text-fg-secondary">
                  {DOCUMENT_TYPES.find((type) => type.key === document.documentType)?.label ?? document.documentType} · {document.versionCount}{" "}
                  {document.versionCount === 1 ? "version" : "versioner"}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </PageContainer>
  );
}
