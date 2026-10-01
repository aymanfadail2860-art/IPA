import type { Metadata } from "next";

import { AccessDenied } from "@/components/common/access-denied";
import { PageContainer } from "@/components/common/page-container";
import { PageHeader } from "@/components/common/page-header";
import { ADMIN_REQUIREMENT } from "@/config/navigation";
import { demoKnowledgeProducts } from "@/dev/demo/data";
import { isDemoMode } from "@/dev/demo/demo-mode";
import { meetsRequirement } from "@/lib/auth/permissions";
import { authorize } from "@/lib/auth/server-session";
import { listProducts } from "@/lib/knowledge/admin-data";
import { KNOWLEDGE_WRITE } from "@/lib/knowledge/admin-requirements";

import { ProductsView } from "./products-view";

export const metadata: Metadata = { title: "Produkter · Admin" };

export default async function AdminProductsPage() {
  const session = await authorize(ADMIN_REQUIREMENT);
  if (!session) return <AccessDenied />;
  const demo = isDemoMode();
  const products = demo ? demoKnowledgeProducts() : await listProducts();
  return (
    <PageContainer>
      <PageHeader title="Produkter" description="Produkter samler dokumenter og læringsforløb. Et udfaset produkt kan ikke få nye dokumenter." />
      <ProductsView products={products} canWrite={!demo && meetsRequirement(session.grants, KNOWLEDGE_WRITE)} linkable={!demo} />
    </PageContainer>
  );
}
