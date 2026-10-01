import { Search } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { AccessDenied } from "@/components/common/access-denied";
import { PageContainer } from "@/components/common/page-container";
import { PageHeader } from "@/components/common/page-header";
import { Section } from "@/components/common/section";
import { ConflictCard } from "@/components/knowledge-admin/conflict-card";
import { EmptyState } from "@/components/states/empty-state";
import { StatusBadge } from "@/components/status/status-badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { demoKnowledgeConflicts, demoKnowledgeCoverage } from "@/dev/demo/data";
import { isDemoMode } from "@/dev/demo/demo-mode";
import { meetsRequirement } from "@/lib/auth/permissions";
import { authorize } from "@/lib/auth/server-session";
import { coverage, listConflicts, listGaps, listVersions } from "@/lib/knowledge/admin-data";
import { KNOWLEDGE_MANAGER, KNOWLEDGE_PUBLISH } from "@/lib/knowledge/admin-requirements";
import { GAP_KIND_LABEL } from "@/lib/knowledge/admin-types";
import { DOCUMENT_TYPES } from "@/lib/knowledge/document-types";
import { formatDate, formatValidTo } from "@/lib/format";

import { FlagConflictForm } from "./flag-conflict-form";

export const metadata: Metadata = { title: "Knowledge Base · Admin" };

/**
 * Knowledge Base (docs/07 §12): conflict queue, gaps in validity (B-006) as a state that needs
 * attention, coverage per product and knowledge gaps (empty until Copilot is in use).
 */
export default async function AdminKnowledgeBasePage() {
  const session = await authorize(KNOWLEDGE_MANAGER);
  if (!session) return <AccessDenied />;
  const demo = isDemoMode();
  const canPublish = !demo && meetsRequirement(session.grants, KNOWLEDGE_PUBLISH);
  const [conflicts, gaps, rows, versions] = demo
    ? [demoKnowledgeConflicts(), [], demoKnowledgeCoverage(), []]
    : await Promise.all([listConflicts(), listGaps(), coverage(), listVersions()]);
  const open = conflicts.filter((conflict) => conflict.status === "open");
  const closed = conflicts.filter((conflict) => conflict.status !== "open").slice(0, 10);
  const published = versions
    .filter((version) => version.status === "published")
    .map((version) => ({ id: version.id, label: `${version.documentTitle}${version.versionLabel ? `, version ${version.versionLabel}` : ""}` }));

  return (
    <PageContainer>
      <PageHeader
        title="Knowledge Base"
        description="Modstridende kilder og huller i gyldigheden afgøres aldrig automatisk."
        actions={
          demo ? undefined : (
            <Button asChild variant="secondary" size="sm">
              <Link href="/admin/knowledge-base/retrieval">
                <Search aria-hidden />
                Afprøv retrieval
              </Link>
            </Button>
          )
        }
      />

      <Section title={`Konfliktkø (${open.length})`} description="Begge kilder bevares uændret. Systemet vælger aldrig, hvilken kilde der har ret.">
        <div className="space-y-4">
          {open.length === 0 ? <EmptyState title="Ingen åbne konflikter">Nye kandidater registreres, når dokumenter publiceres.</EmptyState> : null}
          {open.map((conflict) => (
            <ConflictCard key={conflict.id} conflict={conflict} canDecide={canPublish} linkable={!demo} />
          ))}
          {demo ? null : <FlagConflictForm versions={published} />}
        </div>
      </Section>

      <Section title={`Huller i gyldigheden (${gaps.length})`} description="Kræver opmærksomhed. Et hul lukkes kun ved at publicere en ny version.">
        {gaps.length === 0 ? (
          <EmptyState title="Ingen huller i gyldigheden">Alle dokumenter har en gyldig version uden afbrydelser.</EmptyState>
        ) : (
          <Card className="p-0">
            <ul className="divide-y divide-border-subtle">
              {gaps.map((gap) => (
                <li key={`${gap.documentId}-${gap.language}-${gap.from}`} className="flex flex-wrap items-center justify-between gap-2 px-6 py-3">
                  <span>
                    <Link href={`/admin/documents/${gap.documentId}`} className="font-medium text-fg-link hover:underline">
                      {gap.documentTitle}
                    </Link>
                    <span className="block text-caption text-fg-secondary">
                      {GAP_KIND_LABEL[gap.kind]} · fra {formatDate(gap.from)}
                      {gap.to ? ` til og med ${formatValidTo(gap.to)}` : " og fremefter"} · {gap.language}
                    </span>
                  </span>
                  <StatusBadge status="warning" label="Kræver opmærksomhed" />
                </li>
              ))}
            </ul>
          </Card>
        )}
      </Section>

      <Section title="Dækning pr. produkt" description="Dokumenter med en publiceret version pr. dokumenttype.">
        <div className="overflow-x-auto rounded-lg border border-border-subtle bg-surface-raised">
          <table className="w-full text-body">
            <caption className="sr-only">Publicerede dokumenter pr. produkt og dokumenttype</caption>
            <thead>
              <tr className="border-b border-border-subtle text-label text-fg-secondary">
                <th scope="col" className="px-4 py-2.5 text-left">Produkt</th>
                {DOCUMENT_TYPES.map((type) => (
                  <th key={type.key} scope="col" className="px-3 py-2.5 text-right">
                    {type.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.productId} className="border-b border-border-subtle last:border-0">
                  <th scope="row" className="px-4 py-2 text-left font-medium text-fg-primary">
                    {row.productName}
                  </th>
                  {DOCUMENT_TYPES.map((type) => (
                    <td key={type.key} className="tabular px-3 py-2 text-right text-fg-secondary">
                      {row.publishedByType[type.key] ?? <span aria-label="Mangler">—</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Videnshuller" description="Spørgsmål uden tilstrækkelig dokumentation.">
        <EmptyState title="Registreres, når Copilot tages i brug">Videnshuller opstår af AI-forespørgsler, som kommer i en senere fase.</EmptyState>
      </Section>

      {closed.length > 0 ? (
        <Section title="Senest afgjorte konflikter">
          <div className="space-y-4">
            {closed.map((conflict) => (
              <ConflictCard key={conflict.id} conflict={conflict} canDecide={false} />
            ))}
          </div>
        </Section>
      ) : null}
    </PageContainer>
  );
}
