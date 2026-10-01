"use client";

import { useState } from "react";

import { PageContainer } from "@/components/common/page-container";
import { PageHeader } from "@/components/common/page-header";
import { DataTable } from "@/components/data/data-table";
import { DensityToggle, type TableDensity } from "@/components/data/density-toggle";
import { EmptyState } from "@/components/states/empty-state";
import { StatusBadge } from "@/components/status/status-badge";
import { Card } from "@/components/ui/card";
import { adminSectionById } from "@/config/admin-sections";
import type { AdminTeamRow, AdminUserRow, RoleMatrix } from "@/lib/data/identity";
import { formatDate } from "@/lib/format";

interface AdminData {
  learningContent: readonly { id: string; title: string; modules: number; lessons: number; quizzes: number; updatedAt: string; status: string }[];
  /** From the database (identity schema, RLS: identity.user.manage). */
  users: readonly AdminUserRow[];
  teams: readonly AdminTeamRow[];
  matrix: RoleMatrix;
}


/** Admin sub-sections without their own route: learning content (mock, later phase) and identity (phase 6). */
export function AdminSectionView({ section, data }: { section: string; data: AdminData }) {
  const meta = adminSectionById(section);
  const [density, setDensity] = useState<TableDensity>("compact");

  let content: React.ReactNode = null;

  switch (section) {
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
                  {row.title ? <span className="block text-caption text-fg-tertiary">{row.title}</span> : null}
                </span>
              ),
            },
            { id: "roles", header: "Roller", cell: (row) => (row.roles.length > 0 ? row.roles.join(", ") : "Ingen roller") },
            { id: "teams", header: "Teams", cell: (row) => (row.teams.length > 0 ? row.teams.join(", ") : "—") },
            {
              id: "status",
              header: "Status",
              cell: (row) => (
                <StatusBadge status={row.status === "active" ? "success" : "neutral"} label={row.status === "active" ? "Aktiv" : "Inaktiv"} />
              ),
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
                  {team.members} {team.members === 1 ? "medlem" : "medlemmer"} · Lederscope:{" "}
                  {team.leaders.length > 0 ? team.leaders.join(", ") : "ingen"}
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
            Roller er samlinger af standardpermissions. Systemet kontrollerer altid permission og scope — aldrig
            rollenavnet. Matrixen læses direkte fra databasen.
          </p>
          <div className="overflow-x-auto rounded-lg border border-border-subtle bg-surface-raised">
            <table className="w-full text-body">
              <caption className="sr-only">Permissions pr. rolle med scope</caption>
              <thead>
                <tr className="border-b border-border-subtle text-label text-fg-secondary">
                  <th scope="col" className="px-4 py-2.5 text-left">Permission</th>
                  {data.matrix.roles.map((role) => (
                    <th key={role.key} scope="col" className="px-4 py-2.5 text-left">
                      {role.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.matrix.rows.map((row) => (
                  <tr key={row.permission} className="border-b border-border-subtle last:border-0">
                    <th scope="row" className="px-4 py-2 text-left font-normal text-fg-primary">
                      <span className="block font-mono text-mono">{row.permission}</span>
                      <span className="block text-caption text-fg-tertiary">{row.description}</span>
                    </th>
                    {data.matrix.roles.map((role) => {
                      const scopes = row.scopes[role.key] ?? [];
                      return (
                        <td key={role.key} className="px-4 py-2 text-fg-secondary">
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
  }

  const showDensity = ["learning-content", "users"].includes(section);

  return (
    <PageContainer>
      <PageHeader title={meta?.label ?? "Admin"} actions={showDensity ? <DensityToggle value={density} onChange={setDensity} /> : undefined} />
      {content}
    </PageContainer>
  );
}
