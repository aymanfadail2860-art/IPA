import type { Metadata } from "next";

import { AccessDenied } from "@/components/common/access-denied";
import { PageContainer } from "@/components/common/page-container";
import { PageHeader } from "@/components/common/page-header";
import { RetrievalStatus } from "@/components/knowledge-admin/retrieval-status";
import { ADMIN_REQUIREMENT } from "@/config/navigation";
import { isDemoMode } from "@/dev/demo/demo-mode";
import { forceInsufficientAllowed } from "@/dev/knowledge/force-insufficient";
import { authorize } from "@/lib/auth/server-session";
import { listProducts } from "@/lib/knowledge/admin-data";
import { getRetrievalAvailability } from "@/lib/knowledge/retrieval";

import { RetrievalTool } from "./retrieval-tool";

export const metadata: Metadata = { title: "Afprøv retrieval · Admin" };

/** Knowledge Base → Afprøv retrieval (docs/07 §12.1): knowledge.document.read + Admin access. */
export default async function RetrievalTestPage() {
  if (!(await authorize(ADMIN_REQUIREMENT)) || !(await authorize({ allOf: ["knowledge.document.read"] }))) return <AccessDenied />;
  const demo = isDemoMode();
  const [products, availability] = await Promise.all([
    demo ? Promise.resolve([]) : listProducts().then((rows) => rows.filter((product) => product.status === "active")),
    getRetrievalAvailability(),
  ]);
  return (
    <PageContainer>
      <PageHeader
        eyebrow="Knowledge Base"
        title="Afprøv retrieval"
        description="Viser resultatet af retrieval for dig — med dine adgange — og intet andet. Værktøjet ændrer ingen data, og forespørgslen gemmes ikke."
      />
      <RetrievalStatus availability={availability} />
      {demo ? null : <RetrievalTool products={products} devTools={forceInsufficientAllowed()} />}
    </PageContainer>
  );
}
