"use client";

import Link from "next/link";
import { useState } from "react";

import { DataTable, type DataTableColumn } from "@/components/data/data-table";
import { DensityToggle, type TableDensity } from "@/components/data/density-toggle";
import { VersionStatusBadge } from "@/components/knowledge-admin/version-status";
import { EmptyState } from "@/components/states/empty-state";
import { StatusBadge } from "@/components/status/status-badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DOCUMENT_TABS, type AdminVersionRow, type DocumentTabId } from "@/lib/knowledge/admin-types";
import { DOCUMENT_TYPES } from "@/lib/knowledge/document-types";
import { formatDate } from "@/lib/format";

const typeLabel = (key: string) => DOCUMENT_TYPES.find((type) => type.key === key)?.label ?? key;

/** Document list with a tab per status (docs/07 §12, docs/04 §14.1). */
export function DocumentsView({ versions, today, linkable }: { versions: readonly AdminVersionRow[]; today: string; linkable: boolean }) {
  const [tab, setTab] = useState<DocumentTabId>("processed");
  const [density, setDensity] = useState<TableDensity>("compact");
  const current = DOCUMENT_TABS.find((entry) => entry.id === tab)!;
  const rows = versions.filter((version) => (current.statuses as readonly string[]).includes(version.status));

  const columns: DataTableColumn<AdminVersionRow>[] = [
    {
      id: "title",
      header: "Dokument",
      sortValue: (row) => row.documentTitle,
      cell: (row) => (
        <span>
          {linkable ? (
            <Link href={`/admin/documents/${row.documentId}/versions/${row.id}`} className="block font-medium text-fg-link hover:underline">
              {row.documentTitle}
            </Link>
          ) : (
            <span className="block font-medium text-fg-primary">{row.documentTitle}</span>
          )}
          <span className="block text-caption text-fg-tertiary">{typeLabel(row.documentType)}</span>
        </span>
      ),
    },
    { id: "product", header: "Produkt", sortValue: (row) => row.productName, cell: (row) => row.productName },
    { id: "version", header: "Version", cell: (row) => <span className="font-mono text-mono">{row.versionLabel ?? "—"}</span> },
    {
      id: "status",
      header: "Status",
      cell: (row) => (
        <span className="flex flex-col gap-1">
          <VersionStatusBadge version={row} today={today} />
          {row.documentHasGap ? <StatusBadge status="warning" label="Hul i gyldigheden" /> : null}
          {row.errorMessage ? <span className="text-caption text-fg-secondary">{row.errorMessage}</span> : null}
        </span>
      ),
    },
    { id: "valid", header: "Gyldig fra", cell: (row) => (row.validFrom ? formatDate(row.validFrom) : "—") },
    { id: "updated", header: "Opdateret", sortValue: (row) => row.updatedAt, cell: (row) => formatDate(row.updatedAt) },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs value={tab} onValueChange={(value) => setTab(value as DocumentTabId)}>
          <TabsList variant="line" aria-label="Dokumentstatus">
            {DOCUMENT_TABS.map((entry) => (
              <TabsTrigger key={entry.id} value={entry.id}>
                {entry.label}
                <span className="tabular rounded-sm bg-surface-sunken px-1.5 text-caption">
                  {versions.filter((version) => (entry.statuses as readonly string[]).includes(version.status)).length}
                </span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <DensityToggle value={density} onChange={setDensity} />
      </div>
      <DataTable
        caption="Dokumentversioner"
        columns={columns}
        rows={rows}
        density={density}
        getRowId={(row) => row.id}
        getRowLabel={(row) => `${row.documentTitle} ${row.versionLabel ?? ""}`}
        emptyState={<EmptyState title={tab === "processed" ? "Intet afventer faglig godkendelse" : "Ingen versioner med denne status"} />}
      />
    </div>
  );
}
