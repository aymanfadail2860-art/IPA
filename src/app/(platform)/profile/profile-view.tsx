"use client";

import { BookOpen, CircleCheck, ClipboardCheck, Dumbbell, Eye, EyeOff, TrendingUp, type LucideIcon } from "lucide-react";
import { useState } from "react";

import { Chip } from "@/components/common/chip";
import { PageContainer } from "@/components/common/page-container";
import { PageHeader } from "@/components/common/page-header";
import { Section } from "@/components/common/section";
import { ProgressIndicator } from "@/components/data/progress-indicator";
import { EmptyState } from "@/components/states/empty-state";
import { StatusBadge } from "@/components/status/status-badge";
import { Card, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { leaderVisibility } from "@/config/visibility";
import type { PermissionGrant } from "@/lib/auth/permissions";

export interface LeaderVisibility {
  id: string;
  name: string;
  teamNames: string[];
  grants: PermissionGrant[];
}
import { useSession } from "@/lib/auth/session";
import { formatDate } from "@/lib/format";
import type { Competency, HistoryEntry } from "@/types/domain";

const HISTORY_KIND: Record<HistoryEntry["kind"], { label: string; icon: LucideIcon }> = {
  learn: { label: "Learn", icon: BookOpen },
  practice: { label: "Practice", icon: Dumbbell },
  assessment: { label: "Assessment", icon: ClipboardCheck },
};

/**
 * Min profil (docs/04-ui-ux-design.md §13): Overblik, Kompetencer, Historik, Synlighed.
 * Reflective, not administrative — the user's own mirror.
 */
export function ProfileView({
  progression,
  strengths,
  developmentAreas,
  competencies,
  levelLabels,
  history,
  leaders,
}: {
  progression: { pathsInProgress: number; pathsCompleted: number; pathsAssigned: number; overallPercent: number; currentPath: string; currentModule: number };
  strengths: readonly string[];
  developmentAreas: readonly string[];
  competencies: readonly Competency[];
  levelLabels: Record<number, string>;
  history: readonly HistoryEntry[];
  /** Leaders whose explicit scope covers the user, with their team-scoped permissions. */
  leaders: readonly LeaderVisibility[];
}) {
  const { user } = useSession();
  const [kind, setKind] = useState<HistoryEntry["kind"] | null>(null);

  return (
    <PageContainer className="max-w-5xl">
      <PageHeader display title="Min profil" description={`${user.name} · ${user.title} · ${user.teamName}`} />

      <Tabs defaultValue="overview" className="gap-8">
        <TabsList variant="line" aria-label="Min profil">
          <TabsTrigger value="overview">Overblik</TabsTrigger>
          <TabsTrigger value="competencies">Kompetencer</TabsTrigger>
          <TabsTrigger value="history">Historik</TabsTrigger>
          <TabsTrigger value="visibility">Synlighed</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-10">
          <Section title="Progression">
            <Card>
              <p className="text-body text-fg-primary">
                I gang med <span className="font-medium">{progression.currentPath}</span>, modul {progression.currentModule} af 11
              </p>
              <ProgressIndicator
                className="mt-4"
                label="Tildelte forløb gennemført"
                value={progression.pathsCompleted}
                max={progression.pathsAssigned}
                valueText={`${progression.pathsCompleted} af ${progression.pathsAssigned}`}
              />
            </Card>
          </Section>
          <div className="grid gap-10 md:grid-cols-2">
            <Section title="Styrker">
              <Card>
                <ul className="space-y-3">
                  {strengths.map((item) => (
                    <li key={item} className="flex gap-2 text-body">
                      <CircleCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
                      {item}
                    </li>
                  ))}
                </ul>
              </Card>
            </Section>
            <Section title="Udviklingsområder">
              <Card>
                <ul className="space-y-3">
                  {developmentAreas.map((item) => (
                    <li key={item} className="flex gap-2 text-body">
                      <TrendingUp className="mt-0.5 size-4 shrink-0 text-info" aria-hidden />
                      {item}
                    </li>
                  ))}
                </ul>
              </Card>
            </Section>
          </div>
        </TabsContent>

        <TabsContent value="competencies">
          <Section title="Kompetenceprofil" description="Niveauet opgøres i Assessment. Her ser du det samlede billede og hvad der ligger bag.">
            <ul className="divide-y divide-border-subtle rounded-lg border border-border-subtle bg-surface-raised">
              {competencies.map((competency) => (
                <li key={competency.id} className="grid gap-3 px-6 py-4 md:grid-cols-[1fr_16rem] md:items-center">
                  <div>
                    <p className="text-body font-medium text-fg-primary">{competency.name}</p>
                    <p className="text-caption text-fg-secondary">Grundlag: {competency.basis}</p>
                  </div>
                  <div className="space-y-1.5">
                    <ProgressIndicator
                      label={levelLabels[competency.level]}
                      value={competency.level}
                      max={4}
                      valueText={`${competency.level} af 4`}
                    />
                    {competency.level < competency.target ? (
                      <StatusBadge status="info" label={`Mål: ${levelLabels[competency.target]}`} />
                    ) : (
                      <StatusBadge status="success" label="Mål nået" />
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </Section>
        </TabsContent>

        <TabsContent value="history" className="space-y-4">
          <div role="group" aria-label="Filtrér historik" className="flex flex-wrap gap-2">
            <Chip selected={kind === null} onClick={() => setKind(null)}>
              Alt
            </Chip>
            {(Object.keys(HISTORY_KIND) as HistoryEntry["kind"][]).map((entry) => (
              <Chip key={entry} selected={kind === entry} onClick={() => setKind(kind === entry ? null : entry)}>
                {HISTORY_KIND[entry].label}
              </Chip>
            ))}
          </div>
          <ul className="divide-y divide-border-subtle rounded-lg border border-border-subtle bg-surface-raised">
            {history
              .filter((entry) => !kind || entry.kind === kind)
              .map((entry) => {
                const Icon = HISTORY_KIND[entry.kind].icon;
                return (
                  <li key={entry.id} className="flex items-start gap-3 px-6 py-4">
                    <Icon className="mt-0.5 size-4 shrink-0 text-fg-secondary" aria-hidden />
                    <div className="flex-1">
                      <p className="text-body font-medium text-fg-primary">{entry.title}</p>
                      <p className="text-body text-fg-secondary">{entry.detail}</p>
                    </div>
                    <time dateTime={entry.at} className="shrink-0 text-caption text-fg-tertiary">
                      {formatDate(entry.at)}
                    </time>
                  </li>
                );
              })}
          </ul>
        </TabsContent>

        <TabsContent value="visibility">
          <Section title="Hvem kan se dine data">
            {leaders.length > 0 ? (
              <div className="space-y-4">
                {leaders.map((leader) => {
                  const visibility = leaderVisibility(leader.grants);
                  return (
                    <Card key={leader.id} className="space-y-6">
                      <p className="text-body text-fg-primary">
                        <span className="font-semibold">{leader.name}</span> (leder for {leader.teamNames.join(", ")}) kan
                        se:
                      </p>
                      <ul className="space-y-2">
                        {visibility.canSee.map((category) => (
                          <li key={category.id} className="flex items-center gap-2 text-body text-fg-primary">
                            <Eye className="size-4 text-success" aria-hidden />
                            <span className="sr-only">Kan se: </span>
                            {category.label}
                          </li>
                        ))}
                      </ul>
                      <div>
                        <p className="mb-2 text-body font-semibold text-fg-primary">Kan ikke se:</p>
                        <ul className="space-y-2">
                          {visibility.cannotSee.map((category) => (
                            <li key={category.id} className="flex items-center gap-2 text-body text-fg-secondary">
                              <EyeOff className="size-4" aria-hidden />
                              <span className="sr-only">Kan ikke se: </span>
                              {category.label}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </Card>
                  );
                })}
                <p className="text-caption text-fg-secondary">
                  Listen er dannet ud fra de lederscopes og rettigheder, der faktisk er tildelt i systemet. Den viser, hvilke
                  kategorier af data der er synlige — ikke hvornår de er set.
                </p>
              </div>
            ) : (
              <EmptyState icon={Eye} title="Ingen leder har adgang til dine data">
                Ingen leder har i dag et lederscope, der omfatter dine teams.
              </EmptyState>
            )}
          </Section>
          <Card className="mt-6">
            <CardTitle>Din egen adgang</CardTitle>
            <p className="mt-1 text-body text-fg-secondary">Du ser altid dine egne data. Ingen andre medarbejderes data vises for dig her.</p>
          </Card>
        </TabsContent>
      </Tabs>
    </PageContainer>
  );
}
