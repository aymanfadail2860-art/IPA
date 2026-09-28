"use client";

import { FlaskConical, Info } from "lucide-react";
import { useId, useMemo, useState, useTransition } from "react";

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
import { ErrorState } from "@/components/states/error-state";
import { Card } from "@/components/ui/card";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import type { ScopedEmployee, TeamNode } from "@/types/domain";

import { openEmployeeView } from "./actions";

function ExampleDataNote() {
  return (
    <p className="flex items-center gap-1.5 text-caption text-fg-secondary">
      <FlaskConical className="size-3.5" aria-hidden />
      Eksempeltal. Lærings- og Assessment-data kommer, når de moduler bygges.
    </p>
  );
}

/** All teams at or below the selected team (the leader's scope already includes them). */
function teamAndDescendants(teams: readonly TeamNode[], rootId: string): Set<string> {
  const result = new Set([rootId]);
  let added = true;
  while (added) {
    added = false;
    for (const team of teams) {
      if (team.parentId && result.has(team.parentId) && !result.has(team.id)) {
        result.add(team.id);
        added = true;
      }
    }
  }
  return result;
}

/**
 * Analytics — the leader's cockpit (docs/04-ui-ux-design.md §12). Teams and employees are the
 * leader's real scope from the database. Customer cases are never shown here.
 */
export function AnalyticsView({
  teams,
  employees,
  exampleMetrics,
  exampleDevelopmentAreas,
  exampleTrend,
}: {
  teams: readonly TeamNode[];
  employees: readonly ScopedEmployee[];
  exampleMetrics: readonly { id: string; label: string; value: string; explanation: string }[];
  exampleDevelopmentAreas: readonly { area: string; employees: number }[];
  exampleTrend: readonly { month: string; value: number }[];
}) {
  const teamSelectId = useId();
  const roots = teams.filter((team) => !team.parentId || !teams.some((other) => other.id === team.parentId));
  const [teamId, setTeamId] = useState(roots[0]?.id ?? teams[0]?.id ?? "");
  const [density, setDensity] = useState<TableDensity>("comfortable");
  const [selected, setSelected] = useState<ScopedEmployee | null>(null);
  const [denied, setDenied] = useState(false);
  const [pending, startTransition] = useTransition();
  const maxArea = Math.max(...exampleDevelopmentAreas.map((entry) => entry.employees), 1);

  const team = teams.find((entry) => entry.id === teamId);
  const visibleTeamNames = useMemo(() => {
    const ids = teamAndDescendants(teams, teamId);
    return new Set(teams.filter((entry) => ids.has(entry.id)).map((entry) => entry.name));
  }, [teams, teamId]);
  const rows = employees.filter((employee) => employee.teams.some((name) => visibleTeamNames.has(name)));

  function openEmployee(employee: ScopedEmployee) {
    startTransition(async () => {
      const result = await openEmployeeView(employee.id);
      setDenied(!result.allowed);
      setSelected(employee);
    });
  }

  const columns: DataTableColumn<ScopedEmployee>[] = [
    {
      id: "name",
      header: "Navn",
      sortValue: (row) => row.name,
      cell: (row) => (
        <button
          type="button"
          onClick={() => openEmployee(row)}
          disabled={pending}
          className="flex cursor-pointer items-center gap-3 text-left font-medium text-fg-primary hover:underline"
        >
          <InitialsAvatar initials={row.initials} name={row.name} size="sm" />
          {row.name}
        </button>
      ),
    },
    { id: "teams", header: "Teams", cell: (row) => <span className="text-fg-secondary">{row.teams.join(", ")}</span> },
  ];

  if (teams.length === 0) {
    return (
      <PageContainer>
        <PageHeader display title="Analytics" />
        <EmptyState title="Du er ikke leder for et team endnu">
          Analytics viser data for de teams, du har fået et lederscope til. Kontakt en administrator.
        </EmptyState>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <PageBreadcrumbs items={[{ label: "Analytics", href: "/analytics" }, { label: team?.name ?? "" }]} />
      <PageHeader
        display
        title="Analytics"
        description="Læring og kompetence for de teams, du har lederscope til. Kundecases indgår ikke."
        actions={
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
              {teams.map((entry) => {
                const hasChildren = teams.some((other) => other.parentId === entry.id);
                return (
                  <option key={entry.id} value={entry.id}>
                    {entry.parentId && teams.some((other) => other.id === entry.parentId) ? "  " : ""}
                    {entry.name}
                    {hasChildren ? " (inkl. underteams)" : ""}
                  </option>
                );
              })}
            </select>
          </div>
        }
      />

      <Section title="Nøgletal">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {exampleMetrics.map((metric) => (
            <KeyMetric key={metric.id} label={metric.label} value={metric.value} explanation={metric.explanation} />
          ))}
        </div>
        <ExampleDataNote />
      </Section>

      <div className="hidden gap-10 md:grid lg:grid-cols-2">
        <Section title="Udviklingsområder i teamet">
          <Card className="space-y-4">
            {exampleDevelopmentAreas.map((entry) => (
              <ProgressIndicator key={entry.area} label={entry.area} value={entry.employees} max={maxArea} valueText={`${entry.employees} medarbejdere`} />
            ))}
          </Card>
          <ExampleDataNote />
        </Section>
        <Section title="Tendens">
          <LineChart
            title="Gennemførte læringsforløb"
            description="Andel af tildelte forløb, gennemført pr. måned"
            data={exampleTrend.map((point) => ({ label: point.month, value: point.value }))}
          />
          <ExampleDataNote />
        </Section>
      </div>

      <Section title="Medarbejdere i dit scope" className="hidden md:block" action={<DensityToggle value={density} onChange={setDensity} />}>
        <DataTable
          caption={`Medarbejdere i ${team?.name ?? "teamet"}`}
          columns={columns}
          rows={rows}
          density={density}
          getRowId={(row) => row.id}
          getRowLabel={(row) => row.name}
          emptyState={<EmptyState title="Ingen medarbejdere i dette team" />}
        />
      </Section>

      <p className="text-caption text-fg-secondary md:hidden">På mobil vises kun nøgletal. Brug en større skærm for medarbejderoversigten.</p>

      <Sheet open={selected !== null} onOpenChange={(open) => (open ? undefined : setSelected(null))}>
        <SheetContent side="right" className="w-full overflow-y-auto bg-surface-raised p-6 sm:max-w-lg">
          {selected ? (
            <div className="space-y-6">
              <SheetTitle className="flex items-center gap-3 text-heading-2">
                <InitialsAvatar initials={selected.initials} name={selected.name} />
                {selected.name}
              </SheetTitle>
              {denied ? (
                <ErrorState variant="access" title="Du har ikke adgang til denne medarbejder" />
              ) : (
                <>
                  <SheetDescription className="flex items-start gap-2 rounded-md bg-surface-sunken px-3 py-2 text-caption text-fg-secondary">
                    <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                    Visningen er registreret. Du ser de samme kategorier som medarbejderen i Min profil.
                  </SheetDescription>
                  <Section title="Teams">
                    <p className="text-body text-fg-primary">{selected.teams.join(", ")}</p>
                  </Section>
                  <EmptyState title="Læringsprogression, Assessment-resultater og kompetencer">
                    Kategorierne vises her, når Learn og Assessment er bygget. Adgangen til dem er allerede afgrænset af
                    dit lederscope.
                  </EmptyState>
                </>
              )}
            </div>
          ) : null}
        </SheetContent>
      </Sheet>
    </PageContainer>
  );
}
