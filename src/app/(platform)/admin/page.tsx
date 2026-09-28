import type { Metadata } from "next";
import Link from "next/link";

import { PipelineStatus } from "@/components/admin/pipeline-status";
import { AccessDenied } from "@/components/common/access-denied";
import { PageContainer } from "@/components/common/page-container";
import { PageHeader } from "@/components/common/page-header";
import { Section } from "@/components/common/section";
import { StatusBadge } from "@/components/status/status-badge";
import { Card } from "@/components/ui/card";
import { PIPELINE_STAGE } from "@/config/domain-status";
import { ADMIN_REQUIREMENT } from "@/config/navigation";
import { authorize } from "@/lib/auth/server-session";
import { formatDate } from "@/lib/format";
// PHASE 5: mock data only.
import { mockAdminDocuments, mockDocumentConflicts, mockKnowledgeGaps } from "@/mocks";
import type { PipelineStage } from "@/types/domain";

export const metadata: Metadata = { title: "Admin" };

function count(stage: PipelineStage) {
  return mockAdminDocuments.filter((document) => document.stage === stage).length;
}

export default async function AdminOverviewPage() {
  // Authorization is checked in the page itself: a layout renders in parallel with its page
  // and cannot stop the page's output from being sent.
  if (!(await authorize(ADMIN_REQUIREMENT))) return <AccessDenied />;

  const review = mockAdminDocuments.filter((document) => document.stage === "readyForReview");
  const problems = mockAdminDocuments.filter((document) => document.stage === "failed" || document.stage === "partial");

  return (
    <PageContainer>
      <PageHeader title="Admin" description="Forvaltning af produkter, dokumenter, vidensgrundlag, læringsindhold og brugere." />

      <Section title="Dokumentpipeline">
        <PipelineStatus
          technical={[
            { label: "Uploadet", count: count("uploaded") },
            { label: "Behandles", count: count("processing") },
            { label: "Klar til review", count: count("readyForReview") },
          ]}
          approval={[
            { label: "Godkendt", count: count("approved") },
            { label: "Aktiv", count: count("active") },
          ]}
        />
      </Section>

      <div className="grid gap-10 xl:grid-cols-2">
        <Section
          title={`Klar til review (${review.length})`}
          action={<Link href="/admin/documents" className="text-label font-medium text-fg-link hover:underline">Alle dokumenter →</Link>}
        >
          <Card className="p-0">
            <ul className="divide-y divide-border-subtle">
              {review.map((document) => (
                <li key={document.id} className="flex flex-wrap items-center justify-between gap-2 px-6 py-4">
                  <span>
                    <span className="block text-body font-medium text-fg-primary">
                      {document.title} <span className="font-mono text-caption text-fg-tertiary">v{document.version}</span>
                    </span>
                    <span className="block text-caption text-fg-secondary">
                      {document.product} · gyldig fra {document.validFrom ? formatDate(document.validFrom) : "—"}
                    </span>
                  </span>
                  <StatusBadge status={PIPELINE_STAGE[document.stage].status} label={PIPELINE_STAGE[document.stage].label} />
                </li>
              ))}
            </ul>
          </Card>
        </Section>

        <Section title="Kræver handling">
          <Card className="p-0">
            <ul className="divide-y divide-border-subtle">
              {problems.map((document) => (
                <li key={document.id} className="px-6 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-body font-medium text-fg-primary">{document.title}</span>
                    <StatusBadge status={PIPELINE_STAGE[document.stage].status} label={PIPELINE_STAGE[document.stage].label} />
                  </div>
                  <p className="text-body text-fg-secondary">{document.detail}</p>
                </li>
              ))}
              {mockDocumentConflicts.map((conflict) => (
                <li key={conflict.id} className="px-6 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-body font-medium text-fg-primary">{conflict.topic}</span>
                    <StatusBadge status="conflict" label="Konflikt mellem kilder" />
                  </div>
                  <p className="text-body text-fg-secondary">{conflict.left}</p>
                  <p className="text-body text-fg-secondary">{conflict.right}</p>
                </li>
              ))}
            </ul>
          </Card>
        </Section>
      </div>

      <Section
        title="Videnshuller"
        description="Spørgsmål, Copilot ikke kunne besvare med tilstrækkelig dokumentation — sorteret efter hyppighed."
        action={<Link href="/admin/knowledge-base" className="text-label font-medium text-fg-link hover:underline">Knowledge Base →</Link>}
      >
        <Card className="p-0">
          <ul className="divide-y divide-border-subtle">
            {mockKnowledgeGaps.slice(0, 3).map((gap) => (
              <li key={gap.id} className="flex flex-wrap items-center justify-between gap-2 px-6 py-4">
                <span>
                  <span className="block text-body font-medium text-fg-primary">{gap.question}</span>
                  <span className="block text-caption text-fg-secondary">{gap.product}</span>
                </span>
                <StatusBadge status="insufficient" label={`${gap.occurrences} forespørgsler`} />
              </li>
            ))}
          </ul>
        </Card>
      </Section>
    </PageContainer>
  );
}
