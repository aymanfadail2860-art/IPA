"use client";

import { Info } from "lucide-react";
import { useId, useState } from "react";

import { InitialsAvatar } from "@/components/common/avatar-stack";
import { PageContainer } from "@/components/common/page-container";
import { PageHeader } from "@/components/common/page-header";
import { Section } from "@/components/common/section";
import { DataTable, type DataTableColumn } from "@/components/data/data-table";
import { DensityToggle, type TableDensity } from "@/components/data/density-toggle";
import { KeyMetric } from "@/components/data/key-metric";
import { LineChart } from "@/components/data/line-chart";
import { ProgressIndicator } from "@/components/data/progress-indicator";
import { PageBreadcrumbs } from "@/components/shell/breadcrumbs";
import { EmptyState } from "@/components/states/empty-state";
import { Card } from "@/components/ui/card";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { formatDate } from "@/lib/format";
import type { Competency, TeamMemberRow } from "@/types/domain";

/**
 * Analytics — the leader's cockpit (docs/04-ui-ux-design.md §12). Team → employee drill-down.
 * Customer cases are never shown here, not even as titles.
 */
export function AnalyticsView({
  teams,
  metrics,
  developmentAreas,
  trend,
  members,
  competencies,
}: {
  teams: readonly { id: string; name: string; parent: string | null }[];
  metrics: readonly { id: string; label: string; value: string; explanation: string }[];
  developmentAreas: readonly { area: string; employees: number }[];
  trend: readonly { month: string; value: number }[];
  members: readonly TeamMemberRow[];
  competencies: readonly Competency[];
}) {
  const teamSelectId = useId();
  const periodSelectId = useId();
  const [teamId, setTeamId] = useState(teams[0]?.id ?? "");
  const [density, setDensity] = useState<TableDensity>("comfortable");
  const [selected, setSelected] = useState<TeamMemberRow | null>(null);
  const team = teams.find((entry) => entry.id === teamId);
  const maxArea = Math.max(...developmentAreas.map((entry) => entry.employees), 1);

  const columns: DataTableColumn<TeamMemberRow>[] = [
    {
      id: "name",
      header: "Navn",
      sortValue: (row) => row.name,
      cell: (row) => (
        <button type="button" onClick={() => setSelected(row)} className="flex cursor-pointer items-center gap-3 text-left font-medium text-fg-primary hover:underline">
          <InitialsAvatar initials={row.initials} name={row.name} size="sm" />
          {row.name}
        </button>
      ),
    },
    { id: "learning", header: "Læring", align: "right", sortValue: (row) => row.learningPercent, cell: (row) => <span className="tabular">{row.learningPercent} %</span> },
    { id: "assessment", header: "Assessment", cell: (row) => row.assessments },
    {
      id: "competencies",
      header: "Kompetencer under mål",
      align: "right",
      sortValue: (row) => row.competenciesBelowTarget,
      cell: (row) => <span className="tabular">{row.competenciesBelowTarget}</span>,
    },
    { id: "last", header: "Seneste aktivitet", sortValue: (row) => row.lastActive, cell: (row) => <span className="text-fg-secondary">{formatDate(row.lastActive)}</span> },
  ];

  if (teams.length === 0) {
    return (
      <PageContainer>
        <PageHeader display title="Analytics" />
        <EmptyState title="Du er ikke leder for et team endnu">Kontakt en administrator for at få tildelt et lederscope.</EmptyState>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <PageBreadcrumbs items={[{ label: "Analytics", href: "/analytics" }, { label: team?.name ?? "" }]} />
      <PageHeader
        display
        title="Analytics"
        description="Teamets læring og kompetence. Kundecases indgår ikke."
        actions={
          <div className="flex flex-wrap gap-3">
            <div>
              <label htmlFor={teamSelectId} className="mb-1 block text-label text-fg-secondary">
                Team
              </label>
              <select
                id={teamSelectId}
                value={teamId}
                onChange={(event) => setTeamId(event.target.value)}
                className="h-9 rounded-md border border-border-strong/60 bg-surface-raised px-3 text-body"
              >
                {teams.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.parent ? `  ${entry.name}` : `${entry.name} (inkl. underteams)`}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor={periodSelectId} className="mb-1 block text-label text-fg-secondary">
                Periode
              </label>
              <select id={periodSelectId} defaultValue="90" className="h-9 rounded-md border border-border-strong/60 bg-surface-raised px-3 text-body">
                <option value="30">Seneste 30 dage</option>
                <option value="90">Seneste 90 dage</option>
                <option value="365">Seneste 12 måneder</option>
              </select>
            </div>
          </div>
        }
      />

      <Section title="Nøgletal">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {metrics.map((metric) => (
            <KeyMetric key={metric.id} label={metric.label} value={metric.value} explanation={metric.explanation} />
          ))}
        </div>
      </Section>

      <div className="hidden gap-10 md:grid lg:grid-cols-2">
        <Section title="Udviklingsområder i teamet">
          <Card className="space-y-4">
            {developmentAreas.map((entry) => (
              <ProgressIndicator
                key={entry.area}
                label={entry.area}
                value={entry.employees}
                max={maxArea}
                valueText={`${entry.employees} medarbejdere`}
              />
            ))}
          </Card>
        </Section>
        <Section title="Tendens">
          <LineChart title="Gennemførte læringsforløb" description="Andel af tildelte forløb, gennemført pr. måned" data={trend.map((point) => ({ label: point.month, value: point.value }))} />
        </Section>
      </div>

      <Section title="Medarbejdere" className="hidden md:block" action={<DensityToggle value={density} onChange={setDensity} />}>
        <DataTable
          caption={`Medarbejdere i ${team?.name}`}
          columns={columns}
          rows={members}
          density={density}
          getRowId={(row) => row.id}
          getRowLabel={(row) => row.name}
          rowActions={[{ label: "Åbn medarbejdervisning", onSelect: setSelected }]}
          emptyState={<EmptyState title="Ingen medarbejdere i teamet" />}
        />
      </Section>

      <p className="text-caption text-fg-secondary md:hidden">På mobil vises kun nøgletal. Brug en større skærm for teamoversigt og medarbejdere.</p>

      <Sheet open={selected !== null} onOpenChange={(open) => (open ? undefined : setSelected(null))}>
        <SheetContent side="right" className="w-full overflow-y-auto bg-surface-raised p-6 sm:max-w-lg">
          {selected ? (
            <div className="space-y-6">
              <SheetTitle className="flex items-center gap-3 text-heading-2">
                <InitialsAvatar initials={selected.initials} name={selected.name} />
                {selected.name}
              </SheetTitle>
              <SheetDescription className="flex items-start gap-2 rounded-md bg-surface-sunken px-3 py-2 text-caption text-fg-secondary">
                <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                Visningen er registreret. Du ser de samme kategorier som medarbejderen i Min profil.
              </SheetDescription>
              <Section title="Læringsprogression">
                <ProgressIndicator label="Tildelte forløb" value={selected.learningPercent} valueText={`${selected.learningPercent} %`} />
              </Section>
              <Section title="Assessment-resultater">
                <p className="text-body text-fg-primary">{selected.assessments}</p>
              </Section>
              <Section title="Kompetencer">
                <div className="space-y-3">
                  {competencies.map((competency) => (
                    <ProgressIndicator key={competency.id} label={competency.name} value={competency.level} max={4} valueText={`${competency.level} af 4`} />
                  ))}
                </div>
                <p className="text-caption text-fg-tertiary">Eksempelværdier — de samme fiktive kompetencer vises for alle medarbejdere.</p>
              </Section>
            </div>
          ) : null}
        </SheetContent>
      </Sheet>
    </PageContainer>
  );
}
