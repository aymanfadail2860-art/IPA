"use client";

import { GitCompare, Upload } from "lucide-react";
import { useState } from "react";

import { DisabledReason } from "@/components/common/disabled-reason";
import { PageContainer } from "@/components/common/page-container";
import { PageHeader } from "@/components/common/page-header";
import { Section } from "@/components/common/section";
import { DataTable, type DataTableColumn } from "@/components/data/data-table";
import { DensityToggle, type TableDensity } from "@/components/data/density-toggle";
import { Timeline } from "@/components/data/timeline";
import { EmptyState } from "@/components/states/empty-state";
import { StatusBadge } from "@/components/status/status-badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { adminSectionById } from "@/config/admin-sections";
import { PIPELINE_STAGE } from "@/config/domain-status";
import type { ShortcutDefinition } from "@/config/shortcuts";
import type { PermissionGrant, PermissionKey } from "@/lib/auth/permissions";
import { formatDate } from "@/lib/format";
import type { AdminDocument, KnowledgeGap, PipelineStage } from "@/types/domain";

interface AdminData {
  documents: readonly AdminDocument[];
  products: readonly { id: string; name: string; category: string; documents: number; learningPaths: number; status: string }[];
  gaps: readonly KnowledgeGap[];
  conflicts: readonly { id: string; topic: string; left: string; right: string; reportedAt: string }[];
  learningContent: readonly { id: string; title: string; modules: number; lessons: number; quizzes: number; updatedAt: string; status: string }[];
  users: readonly { id: string; name: string; email: string; roles: string; teams: string; status: string }[];
  teams: readonly { id: string; name: string; depth: number; members: number; leaders: string }[];
  versions: readonly { id: string; document: string; version: string; event: string; at: string }[];
  roles: readonly { id: string; label: string; grants: readonly PermissionGrant[] }[];
  shortcuts: readonly ShortcutDefinition[];
}

const PERMISSION_KEYS: PermissionKey[] = [
  "learning.progress.read",
  "practice.session.write",
  "assessment.result.read",
  "advise.case.read",
  "advise.case.write",
  "analytics.team.read",
  "knowledge.document.read",
  "knowledge.document.read_historical",
  "knowledge.document.write",
  "knowledge.version.publish",
  "identity.user.manage",
  "system.settings.manage",
];

const RETENTION_CATEGORIES = [
  "AI-samtaler",
  "Retrieval-logs",
  "Kundecases",
  "Læringsdata",
  "Assessment-data",
  "Analytics-hændelser",
  "Audit-logs",
];

type DocumentTab = "all" | PipelineStage;

function DocumentsSection({ documents }: { documents: readonly AdminDocument[] }) {
  const [tab, setTab] = useState<DocumentTab>("readyForReview");
  const [density, setDensity] = useState<TableDensity>("compact");
  const tabs: { id: DocumentTab; label: string }[] = [
    { id: "readyForReview", label: "Klar til review" },
    { id: "processing", label: "Behandles" },
    { id: "failed", label: "Fejl" },
    { id: "partial", label: "Delvist behandlet" },
    { id: "active", label: "Aktive" },
    { id: "all", label: "Alle" },
  ];
  const rows = tab === "all" ? documents : documents.filter((document) => document.stage === tab);
  const columns: DataTableColumn<AdminDocument>[] = [
    {
      id: "title",
      header: "Dokument",
      sortValue: (row) => row.title,
      cell: (row) => (
        <span>
          <span className="block font-medium text-fg-primary">{row.title}</span>
          <span className="block text-caption text-fg-tertiary">{row.type}</span>
        </span>
      ),
    },
    { id: "product", header: "Produkt", sortValue: (row) => row.product, cell: (row) => row.product },
    { id: "version", header: "Version", cell: (row) => <span className="font-mono text-mono">v{row.version}</span> },
    {
      id: "stage",
      header: "Status",
      cell: (row) => (
        <span className="space-y-1">
          <StatusBadge status={PIPELINE_STAGE[row.stage].status} label={PIPELINE_STAGE[row.stage].label} />
          {row.detail ? <span className="block text-caption text-fg-secondary">{row.detail}</span> : null}
        </span>
      ),
    },
    { id: "valid", header: "Gyldig fra", cell: (row) => (row.validFrom ? formatDate(row.validFrom) : "—") },
    { id: "updated", header: "Opdateret", sortValue: (row) => row.updatedAt, cell: (row) => formatDate(row.updatedAt) },
  ];

  return (
    <Section
      title="Dokumenter"
      action={
        <div className="flex items-center gap-2">
          <DensityToggle value={density} onChange={setDensity} />
          <DisabledReason reason="Upload kræver Storage og ingestion-worker, som bygges i en senere fase.">
            <Button variant="secondary" size="sm" disabled>
              <Upload aria-hidden />
              Upload
            </Button>
          </DisabledReason>
        </div>
      }
    >
      <Tabs value={tab} onValueChange={(value) => setTab(value as DocumentTab)}>
        <TabsList variant="line" aria-label="Dokumentstatus">
          {tabs.map((entry) => {
            const count = entry.id === "all" ? documents.length : documents.filter((document) => document.stage === entry.id).length;
            return (
              <TabsTrigger key={entry.id} value={entry.id}>
                {entry.label}
                <span className="tabular rounded-sm bg-surface-sunken px-1.5 text-caption">{count}</span>
              </TabsTrigger>
            );
          })}
        </TabsList>
      </Tabs>
      <DataTable
        caption="Dokumenter"
        columns={columns}
        rows={rows}
        density={density}
        getRowId={(row) => row.id}
        getRowLabel={(row) => `${row.title} v${row.version}`}
        emptyState={
          <EmptyState title={tab === "readyForReview" ? "Intet afventer faglig godkendelse" : "Ingen dokumenter med denne status"} />
        }
      />
    </Section>
  );
}

/** Admin sub-sections. Desktop-optimised tables with mock rows (phase 5). */
export function AdminSectionView({ section, data }: { section: string; data: AdminData }) {
  const meta = adminSectionById(section);
  const [density, setDensity] = useState<TableDensity>("compact");

  let content: React.ReactNode = null;

  switch (section) {
    case "documents":
      content = <DocumentsSection documents={data.documents} />;
      break;
    case "products":
      content = (
        <DataTable
          caption="Produkter"
          density={density}
          columns={[
            { id: "name", header: "Produkt", sortValue: (row) => row.name, cell: (row) => <span className="font-medium">{row.name}</span> },
            { id: "category", header: "Kategori", sortValue: (row) => row.category, cell: (row) => row.category },
            { id: "documents", header: "Dokumenter", align: "right", cell: (row) => <span className="tabular">{row.documents}</span> },
            { id: "paths", header: "Læringsforløb", align: "right", cell: (row) => <span className="tabular">{row.learningPaths}</span> },
            {
              id: "status",
              header: "Status",
              cell: (row) => <StatusBadge status={row.status === "Aktiv" ? "success" : "neutral"} label={row.status} />,
            },
          ]}
          rows={data.products}
          getRowId={(row) => row.id}
          getRowLabel={(row) => row.name}
          emptyState={<EmptyState title="Ingen produkter endnu" />}
        />
      );
      break;
    case "knowledge-base":
      content = (
        <div className="space-y-10">
          <Section title="Videnshuller" description="Spørgsmål uden tilstrækkelig dokumentation, sorteret efter hyppighed.">
            <DataTable
              caption="Videnshuller"
              density={density}
              columns={[
                { id: "question", header: "Emne", cell: (row) => <span className="font-medium">{row.question}</span> },
                { id: "product", header: "Produkt", cell: (row) => row.product },
                {
                  id: "count",
                  header: "Forespørgsler",
                  align: "right",
                  sortValue: (row) => row.occurrences,
                  cell: (row) => <StatusBadge status="insufficient" label={`${row.occurrences}`} />,
                },
                { id: "last", header: "Senest", sortValue: (row) => row.lastSeen, cell: (row) => formatDate(row.lastSeen) },
              ]}
              rows={[...data.gaps].sort((a, b) => b.occurrences - a.occurrences)}
              getRowId={(row) => row.id}
              getRowLabel={(row) => row.question}
              emptyState={<EmptyState title="Ingen videnshuller">Copilot har fundet dokumentation til alle spørgsmål i perioden.</EmptyState>}
            />
          </Section>
          <Section title="Konfliktkø" description="Modstridende kilder afgøres aldrig automatisk.">
            {data.conflicts.map((conflict) => (
              <Card key={conflict.id} className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="flex items-center gap-2 text-heading-3">
                    <GitCompare className="size-4 text-knowledge-conflict" aria-hidden />
                    {conflict.topic}
                  </p>
                  <span className="text-caption text-fg-tertiary">Meldt {formatDate(conflict.reportedAt)}</span>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <p className="rounded-md border-l-4 border-l-knowledge-conflict bg-knowledge-conflict-subtle px-4 py-3 text-body">{conflict.left}</p>
                  <p className="rounded-md border-l-4 border-l-knowledge-conflict bg-knowledge-conflict-subtle px-4 py-3 text-body">{conflict.right}</p>
                </div>
              </Card>
            ))}
          </Section>
        </div>
      );
      break;
    case "learning-content":
      content = (
        <DataTable
          caption="Læringsindhold"
          density={density}
          columns={[
            { id: "title", header: "Forløb", sortValue: (row) => row.title, cell: (row) => <span className="font-medium">{row.title}</span> },
            { id: "modules", header: "Moduler", align: "right", cell: (row) => <span className="tabular">{row.modules}</span> },
            { id: "lessons", header: "Lektioner", align: "right", cell: (row) => <span className="tabular">{row.lessons}</span> },
            { id: "quizzes", header: "Quizzer", align: "right", cell: (row) => <span className="tabular">{row.quizzes}</span> },
            { id: "updated", header: "Opdateret", sortValue: (row) => row.updatedAt, cell: (row) => formatDate(row.updatedAt) },
            {
              id: "status",
              header: "Status",
              cell: (row) => <StatusBadge status={row.status === "Publiceret" ? "success" : "neutral"} label={row.status} />,
            },
          ]}
          rows={data.learningContent}
          getRowId={(row) => row.id}
          getRowLabel={(row) => row.title}
          emptyState={<EmptyState title="Intet læringsindhold endnu" />}
        />
      );
      break;
    case "users":
      content = (
        <DataTable
          caption="Brugere"
          density={density}
          columns={[
            {
              id: "name",
              header: "Navn",
              sortValue: (row) => row.name,
              cell: (row) => (
                <span>
                  <span className="block font-medium">{row.name}</span>
                  <span className="block text-caption text-fg-tertiary">{row.email}</span>
                </span>
              ),
            },
            { id: "roles", header: "Roller", cell: (row) => row.roles },
            { id: "teams", header: "Teams", cell: (row) => row.teams },
            {
              id: "status",
              header: "Status",
              cell: (row) => <StatusBadge status={row.status === "Aktiv" ? "success" : "info"} label={row.status} />,
            },
          ]}
          rows={data.users}
          getRowId={(row) => row.id}
          getRowLabel={(row) => row.name}
          emptyState={<EmptyState title="Ingen brugere endnu" />}
        />
      );
      break;
    case "teams":
      content = (
        <Card className="p-0">
          <ul className="divide-y divide-border-subtle" aria-label="Teamhierarki">
            {data.teams.map((team) => (
              <li key={team.id} className="flex flex-wrap items-center justify-between gap-2 px-6 py-3" style={{ paddingLeft: `${1.5 + team.depth * 1.5}rem` }}>
                <span className="text-body font-medium text-fg-primary">
                  {team.depth > 0 ? <span className="mr-1 text-fg-tertiary" aria-hidden>└</span> : null}
                  {team.name}
                </span>
                <span className="text-body text-fg-secondary">
                  {team.members} medlemmer · Lederscope: {team.leaders}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      );
      break;
    case "permissions":
      content = (
        <div className="space-y-4">
          <p className="max-w-3xl text-body text-fg-secondary">
            Roller er samlinger af permissions. Systemet kontrollerer altid permission og scope — aldrig rollenavnet.
            Matrixen viser udviklingsdataenes rollesæt.
          </p>
          <div className="overflow-x-auto rounded-lg border border-border-subtle bg-surface-raised">
            <table className="w-full text-body">
              <caption className="sr-only">Permissions pr. rolle med scope</caption>
              <thead>
                <tr className="border-b border-border-subtle text-label text-fg-secondary">
                  <th scope="col" className="px-4 py-2.5 text-left">Permission</th>
                  {data.roles.map((role) => (
                    <th key={role.id} scope="col" className="px-4 py-2.5 text-left">
                      {role.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {PERMISSION_KEYS.map((key) => (
                  <tr key={key} className="border-b border-border-subtle last:border-0">
                    <th scope="row" className="px-4 py-2 text-left font-mono text-mono font-normal text-fg-primary">
                      {key}
                    </th>
                    {data.roles.map((role) => {
                      const scopes = role.grants.filter((grant) => grant.key === key).map((grant) => grant.scope);
                      return (
                        <td key={role.id} className="px-4 py-2 text-fg-secondary">
                          {scopes.length > 0 ? scopes.join(" + ") : <span aria-label="Ingen adgang">—</span>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      );
      break;
    case "versions":
      content = (
        <Card>
          <Timeline items={data.versions.map((entry) => ({ id: entry.id, at: entry.at, text: `${entry.document} · v${entry.version}`, detail: entry.event }))} />
        </Card>
      );
      break;
    case "settings":
      content = (
        <div className="grid gap-10 xl:grid-cols-2">
          <Section title="Tastaturgenveje" description="Defineret ét sted som konfiguration og kan slås fra organisationsbredt.">
            <Card className="p-0">
              <ul className="divide-y divide-border-subtle">
                {data.shortcuts.map((shortcut) => (
                  <li key={shortcut.id} className="flex items-center justify-between gap-3 px-6 py-3">
                    <span className="text-body text-fg-primary">{shortcut.description}</span>
                    <span className="flex items-center gap-3">
                      <kbd className="rounded-sm border border-border-subtle bg-surface-sunken px-1.5 font-mono text-caption">
                        ⌘/Ctrl + {shortcut.key.toUpperCase()}
                      </kbd>
                      <StatusBadge status={shortcut.enabled ? "success" : "neutral"} label={shortcut.enabled ? "Slået til" : "Slået fra"} />
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          </Section>
          <Section title="Retention pr. datakategori" description="Hver kategori får sin egen politik. Perioderne er endnu ikke fastlagt.">
            <Card className="p-0">
              <ul className="divide-y divide-border-subtle">
                {RETENTION_CATEGORIES.map((category) => (
                  <li key={category} className="flex items-center justify-between gap-3 px-6 py-3">
                    <span className="text-body text-fg-primary">{category}</span>
                    <StatusBadge status="neutral" label="Ikke fastlagt" />
                  </li>
                ))}
              </ul>
            </Card>
          </Section>
        </div>
      );
      break;
  }

  const showDensity = ["products", "learning-content", "users", "knowledge-base"].includes(section);

  return (
    <PageContainer>
      <PageHeader title={meta?.label ?? "Admin"} actions={showDensity ? <DensityToggle value={density} onChange={setDensity} /> : undefined} />
      {content}
    </PageContainer>
  );
}
