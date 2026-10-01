import type { Metadata } from "next";
import Link from "next/link";

import { PipelineStatus } from "@/components/admin/pipeline-status";
import { AccessDenied } from "@/components/common/access-denied";
import { PageContainer } from "@/components/common/page-container";
import { PageHeader } from "@/components/common/page-header";
import { Section } from "@/components/common/section";
import { VersionStatusBadge } from "@/components/knowledge-admin/version-status";
import { StatusBadge } from "@/components/status/status-badge";
import { Card } from "@/components/ui/card";
import { ADMIN_REQUIREMENT } from "@/config/navigation";
import { demoKnowledgeConflicts, demoKnowledgeVersions } from "@/dev/demo/data";
import { isDemoMode } from "@/dev/demo/demo-mode";
import { meetsRequirement } from "@/lib/auth/permissions";
import { authorize } from "@/lib/auth/server-session";
import { formatDate } from "@/lib/format";
import { listConflicts, listGaps, listVersions } from "@/lib/knowledge/admin-data";
import { KNOWLEDGE_MANAGER } from "@/lib/knowledge/admin-requirements";
import { publishedState, type AdminVersionRow, type VersionStatus } from "@/lib/knowledge/admin-types";
import { danishDate } from "@/lib/knowledge/retrieval-core";
// Knowledge gaps need AI queries (a later phase): mock data.
import { mockKnowledgeGaps } from "@/mocks";

export const metadata: Metadata = { title: "Admin" };

export default async function AdminOverviewPage() {
  // Authorization is checked in the page itself: a layout renders in parallel with its page
  // and cannot stop the page's output from being sent.
  const session = await authorize(ADMIN_REQUIREMENT);
  if (!session) return <AccessDenied />;

  // The document pipeline from the database (docs/07 §12); demo without a database: mock rows (B-003).
  const demo = isDemoMode();
  const manager = meetsRequirement(session.grants, KNOWLEDGE_MANAGER);
  const [versions, conflicts, gaps] = demo
    ? [demoKnowledgeVersions(), demoKnowledgeConflicts(), []]
    : manager
      ? await Promise.all([listVersions(), listConflicts({ status: "open" }), listGaps()])
      : [[], [], []];
  const today = danishDate(new Date());
  const count = (...statuses: VersionStatus[]) => versions.filter((version) => statuses.includes(version.status)).length;
  const published = (key: "future" | "current") =>
    versions.filter((version) => version.status === "published" && publishedState(version, today).key === key).length;
  const review: AdminVersionRow[] = versions.filter((version) => version.status === "processed" || version.status === "under_review");
  const problems = versions.filter((version) => version.status === "processing_failed");
  const link = (version: AdminVersionRow) => (demo ? undefined : `/admin/documents/${version.documentId}/versions/${version.id}`);

  return (
    <PageContainer>
      <PageHeader title="Admin" description="Forvaltning af produkter, dokumenter, vidensgrundlag, læringsindhold og brugere." />

      <Section title="Dokumentpipeline">
        <PipelineStatus
          technical={[
            { label: "Uploadet", count: count("uploaded") },
            { label: "Behandles", count: count("processing") },
            { label: "Klar til review", count: count("processed") },
          ]}
          approval={[
            { label: "Godkendt", count: published("future") },
            { label: "Aktiv", count: published("current") },
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
              {review.length === 0 ? <li className="px-6 py-4 text-body text-fg-secondary">Intet afventer faglig godkendelse.</li> : null}
              {review.slice(0, 8).map((version) => (
                <li key={version.id} className="flex flex-wrap items-center justify-between gap-2 px-6 py-4">
                  <span>
                    <span className="block text-body font-medium text-fg-primary">
                      {link(version) ? (
                        <Link href={link(version)!} className="text-fg-link hover:underline">
                          {version.documentTitle}
                        </Link>
                      ) : (
                        version.documentTitle
                      )}{" "}
                      <span className="font-mono text-caption text-fg-tertiary">{version.versionLabel ?? ""}</span>
                    </span>
                    <span className="block text-caption text-fg-secondary">
                      {version.productName} · gyldig fra {version.validFrom ? formatDate(version.validFrom) : "—"}
                    </span>
                  </span>
                  <VersionStatusBadge version={version} today={today} />
                </li>
              ))}
            </ul>
          </Card>
        </Section>

        <Section title="Kræver handling">
          <Card className="p-0">
            <ul className="divide-y divide-border-subtle">
              {problems.length + conflicts.length + gaps.length === 0 ? (
                <li className="px-6 py-4 text-body text-fg-secondary">Ingen fejl, konflikter eller huller i gyldigheden.</li>
              ) : null}
              {problems.map((version) => (
                <li key={version.id} className="px-6 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-body font-medium text-fg-primary">{version.documentTitle}</span>
                    <VersionStatusBadge version={version} today={today} />
                  </div>
                  {version.errorMessage ? <p className="text-body text-fg-secondary">{version.errorMessage}</p> : null}
                </li>
              ))}
              {conflicts.map((conflict) => (
                <li key={conflict.id} className="px-6 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-body font-medium text-fg-primary">{conflict.description ?? "Konflikt mellem kilder"}</span>
                    <StatusBadge status="conflict" label="Konflikt mellem kilder" />
                  </div>
                  {conflict.passages.slice(0, 2).map((passage) => (
                    <p key={`${passage.side}-${passage.versionId}-${passage.chunk?.id ?? ""}`} className="text-body text-fg-secondary">
                      {passage.documentTitle}
                      {passage.versionLabel ? `, version ${passage.versionLabel}` : ""}
                    </p>
                  ))}
                </li>
              ))}
              {gaps.map((gap) => (
                <li key={`${gap.documentId}-${gap.language}-${gap.from}`} className="flex flex-wrap items-center justify-between gap-2 px-6 py-4">
                  <span className="text-body font-medium text-fg-primary">{gap.documentTitle}</span>
                  <StatusBadge status="warning" label={`Hul i gyldigheden fra ${formatDate(gap.from)}`} />
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
