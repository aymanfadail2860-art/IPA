import type { Metadata } from "next";
import Link from "next/link";

import { AccessDenied } from "@/components/common/access-denied";
import { PageContainer } from "@/components/common/page-container";
import { PageHeader } from "@/components/common/page-header";
import { VersionStatusBadge } from "@/components/knowledge-admin/version-status";
import { EmptyState } from "@/components/states/empty-state";
import { StatusBadge } from "@/components/status/status-badge";
import { Card } from "@/components/ui/card";
import { demoKnowledgeVersions } from "@/dev/demo/data";
import { isDemoMode } from "@/dev/demo/demo-mode";
import { authorize } from "@/lib/auth/server-session";
import { listGaps, listVersions } from "@/lib/knowledge/admin-data";
import { KNOWLEDGE_MANAGER } from "@/lib/knowledge/admin-requirements";
import { GAP_KIND_LABEL, type AdminVersionRow, type ValidityGap } from "@/lib/knowledge/admin-types";
import { danishDate } from "@/lib/knowledge/retrieval-core";
import { formatDate, formatValidTo } from "@/lib/format";

export const metadata: Metadata = { title: "Versioner · Admin" };

type Entry = { kind: "version"; at: string; version: AdminVersionRow } | { kind: "gap"; at: string; gap: ValidityGap };

function period(from: string | null, to: string | null): string {
  if (!from) return "Ingen gyldighed angivet";
  return `${formatDate(from)} – ${to ? formatValidTo(to) : "ingen slutdato"}`;
}

/**
 * Versioner (docs/07 §12): a timeline per document with validity periods, publication,
 * supersession, withdrawal — and gaps in validity marked "Kræver opmærksomhed" (B-006).
 */
export default async function AdminVersionsPage() {
  if (!(await authorize(KNOWLEDGE_MANAGER))) return <AccessDenied />;
  const demo = isDemoMode();
  const [versions, gaps] = demo ? [demoKnowledgeVersions(), []] : await Promise.all([listVersions(), listGaps()]);
  const today = danishDate(new Date());
  const byDocument = new Map<string, { title: string; entries: Entry[] }>();
  for (const version of versions) {
    const document = byDocument.get(version.documentId) ?? { title: version.documentTitle, entries: [] };
    document.entries.push({ kind: "version", at: version.validFrom ?? version.uploadedAt.slice(0, 10), version });
    byDocument.set(version.documentId, document);
  }
  for (const gap of gaps) byDocument.get(gap.documentId)?.entries.push({ kind: "gap", at: gap.from, gap });
  const documents = [...byDocument.entries()].sort((a, b) => a[1].title.localeCompare(b[1].title, "da"));

  return (
    <PageContainer>
      <PageHeader title="Versioner" description="Gyldighedsperioder pr. dokument. Erstattet og historisk er afledt af datoerne; intet ændres automatisk." />
      {documents.length === 0 ? <EmptyState title="Ingen versioner endnu">Upload et dokument under Dokumenter.</EmptyState> : null}
      <div className="space-y-6">
        {documents.map(([documentId, document]) => (
          <Card key={documentId} className="space-y-3">
            <h2 className="text-heading-3">
              {demo ? (
                document.title
              ) : (
                <Link href={`/admin/documents/${documentId}`} className="text-fg-link hover:underline">
                  {document.title}
                </Link>
              )}
            </h2>
            <ol className="relative space-y-3 border-l border-border-subtle pl-4">
              {document.entries
                .sort((a, b) => a.at.localeCompare(b.at))
                .map((entry) =>
                  entry.kind === "gap" ? (
                    <li key={`gap-${entry.gap.from}-${entry.gap.language}`} className="flex flex-wrap items-center gap-2">
                      <StatusBadge status="warning" label="Kræver opmærksomhed" />
                      <span className="text-body">
                        Hul i gyldigheden ({GAP_KIND_LABEL[entry.gap.kind].toLowerCase()}): {period(entry.gap.from, entry.gap.to)}
                      </span>
                    </li>
                  ) : (
                    <li key={entry.version.id} className="flex flex-wrap items-center justify-between gap-2">
                      <span>
                        <span className="block font-medium text-fg-primary">{entry.version.versionLabel ? `Version ${entry.version.versionLabel}` : "Version uden betegnelse"}</span>
                        <span className="block text-caption text-fg-secondary">
                          {period(entry.version.validFrom, entry.version.validTo)} · {entry.version.language}
                          {entry.version.supersededBy ? " · erstattet af en senere version" : ""}
                        </span>
                      </span>
                      <VersionStatusBadge version={entry.version} today={today} />
                    </li>
                  ),
                )}
            </ol>
          </Card>
        ))}
      </div>
    </PageContainer>
  );
}
