"use client";

import {
  ArrowRight,
  BookOpen,
  BriefcaseBusiness,
  ClipboardCheck,
  Dumbbell,
  Info,
  Target,
  TriangleAlert,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { PageContainer } from "@/components/common/page-container";
import { Section } from "@/components/common/section";
import { CopilotInput } from "@/components/copilot/copilot-input";
import { ProgressIndicator } from "@/components/data/progress-indicator";
import { EmptyState } from "@/components/states/empty-state";
import { StatusBadge } from "@/components/status/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle, InteractiveCard } from "@/components/ui/card";
import { ASSESSMENT_STATUS, CASE_STATUS } from "@/config/domain-status";
import { hasPermission } from "@/lib/auth/permissions";
import { useSession } from "@/lib/auth/session";
import { formatDate, formatShortDate } from "@/lib/format";
import type { AssessmentItem, CaseSummary, TrainingSessionSummary } from "@/types/domain";

interface HomeViewProps {
  greeting: string;
  continueLearning: { product: string; href: string; module: number; moduleCount: number; moduleTitle: string };
  recommended: { form: string; product: string; reason: string };
  /** Active cases the user owns or is assigned to (loaded server-side under RLS). */
  cases: readonly CaseSummary[];
  recentTraining: TrainingSessionSummary;
  assessments: readonly AssessmentItem[];
  progression: { pathsInProgress: number; pathsCompleted: number; pathsAssigned: number; overallPercent: number };
  changes: readonly { id: string; product: string; change: string; validFrom: string; affectsActiveCases: number }[];
  teamStatus: { team: string; learningPercent: number; assessmentsThisMonth: number; developmentAreaTop: string };
  adminTasks: { readyForReview: number; conflicts: number; knowledgeGaps: number };
}

/**
 * Home — a cockpit, not a dashboard (docs/04-ui-ux-design.md §6). Priority:
 * what should I do now → how is it going → what is new.
 */
export function HomeView(props: HomeViewProps) {
  const { user, grants } = useSession();
  const router = useRouter();
  const isLeader = hasPermission(grants, "analytics.team.read", "team");
  const isAdmin = hasPermission(grants, "knowledge.document.write");
  const canSeeCases = hasPermission(grants, "advise.case.read");
  const cases = props.cases;
  const availableAssessments = props.assessments.filter((item) => item.status === "available");
  const sortedChanges = [...props.changes].sort((a, b) => b.affectsActiveCases - a.affectsActiveCases);

  return (
    <PageContainer className="max-w-6xl">
      <div className="space-y-6">
        <h1 className="text-display text-fg-primary">
          {props.greeting}, {user.firstName}
        </h1>
        <CopilotInput
          size="lg"
          label="Spørg Copilot"
          placeholder="Spørg Copilot om et produkt, en dækning eller en regel"
          onSubmit={(question) => router.push(`/copilot?q=${encodeURIComponent(question)}`)}
        />
      </div>

      <Section title="Næste skridt">
        <div className="grid gap-4 md:grid-cols-2">
          <InteractiveCard href={props.continueLearning.href}>
            <p className="mb-3 flex items-center gap-2 text-label text-fg-secondary">
              <BookOpen className="size-4" aria-hidden />
              Fortsæt læring
            </p>
            <CardTitle>{props.continueLearning.product}</CardTitle>
            <CardDescription className="mt-1">
              Modul {props.continueLearning.module} af {props.continueLearning.moduleCount} ·{" "}
              {props.continueLearning.moduleTitle}
            </CardDescription>
            <ProgressIndicator
              className="mt-4"
              label="Produktforløb"
              value={props.continueLearning.module - 1}
              max={props.continueLearning.moduleCount}
              valueText={`${props.continueLearning.module - 1} af ${props.continueLearning.moduleCount} moduler`}
            />
          </InteractiveCard>
          <InteractiveCard href="/practice">
            <p className="mb-3 flex items-center gap-2 text-label text-fg-secondary">
              <Target className="size-4" aria-hidden />
              Anbefalet aktivitet
            </p>
            <CardTitle>
              {props.recommended.form} · {props.recommended.product}
            </CardTitle>
            <CardDescription className="mt-1">{props.recommended.reason}</CardDescription>
            <p className="mt-4 inline-flex items-center gap-1 text-label font-medium text-fg-link">
              Start træning <ArrowRight className="size-3.5" aria-hidden />
            </p>
          </InteractiveCard>
        </div>
      </Section>

      {isLeader ? (
        <Section title="Mit team">
          <InteractiveCard href="/analytics" className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="flex items-start gap-3">
              <Users className="mt-0.5 size-5 text-fg-secondary" aria-hidden />
              <div>
                <CardTitle>{props.teamStatus.team}</CardTitle>
                <CardDescription>
                  {props.teamStatus.learningPercent} % af tildelte forløb gennemført ·{" "}
                  {props.teamStatus.assessmentsThisMonth} prøver bestået denne måned
                </CardDescription>
              </div>
            </div>
            <p className="text-body text-fg-secondary">
              Største udviklingsområde: <span className="font-medium text-fg-primary">{props.teamStatus.developmentAreaTop}</span>
            </p>
          </InteractiveCard>
        </Section>
      ) : null}

      {isAdmin ? (
        <Section title="Til forvaltning">
          <div className="grid gap-4 sm:grid-cols-3">
            <InteractiveCard href="/admin/documents">
              <StatusBadge status="warning" label="Til review" />
              <p className="tabular mt-3 text-heading-1">{props.adminTasks.readyForReview}</p>
              <CardDescription>dokumenter afventer faglig godkendelse</CardDescription>
            </InteractiveCard>
            <InteractiveCard href="/admin/knowledge-base">
              <StatusBadge status="conflict" label="Konflikter" />
              <p className="tabular mt-3 text-heading-1">{props.adminTasks.conflicts}</p>
              <CardDescription>modstridende kilder i konfliktkøen</CardDescription>
            </InteractiveCard>
            <InteractiveCard href="/admin/knowledge-base">
              <StatusBadge status="insufficient" label="Videnshuller" />
              <p className="tabular mt-3 text-heading-1">{props.adminTasks.knowledgeGaps}</p>
              <CardDescription>emner uden tilstrækkelig dokumentation</CardDescription>
            </InteractiveCard>
          </div>
        </Section>
      ) : null}

      <Section title="Mit arbejde">
        <div className="space-y-4">
          {canSeeCases ? (
            <Card>
              <div className="mb-4 flex items-center justify-between gap-4">
                <CardTitle as="h3" className="flex items-center gap-2">
                  <BriefcaseBusiness className="size-4 text-fg-secondary" aria-hidden />
                  Aktive kundecases ({cases.length})
                </CardTitle>
                <Link href="/advise" className="text-label font-medium text-fg-link hover:underline">
                  Se alle <span aria-hidden>→</span>
                </Link>
              </div>
              {cases.length === 0 ? (
                <EmptyState
                  icon={BriefcaseBusiness}
                  title="Ingen aktive sager"
                  action={
                    <Button asChild variant="secondary" size="sm">
                      <Link href="/advise">Opret kundecase</Link>
                    </Button>
                  }
                />
              ) : (
                <ul className="divide-y divide-border-subtle">
                  {cases.map((entry) => {
                    return (
                      <li key={entry.id}>
                        <Link
                          href={`/advise/${entry.id}`}
                          className="-mx-2 flex flex-wrap items-center justify-between gap-2 rounded-md px-2 py-3 hover:bg-surface-sunken"
                        >
                          <span>
                            <span className="block text-body font-medium text-fg-primary">{entry.companyName}</span>
                            <span className="block text-caption text-fg-secondary">
                              Opdateret {formatShortDate(entry.updatedAt)}
                            </span>
                          </span>
                          <StatusBadge status={CASE_STATUS[entry.status].status} label={CASE_STATUS[entry.status].label} />
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
          ) : null}
          <div className="grid gap-4 md:grid-cols-2">
            <InteractiveCard href="/practice">
              <p className="mb-3 flex items-center gap-2 text-label text-fg-secondary">
                <Dumbbell className="size-4" aria-hidden />
                Seneste Practice
              </p>
              <CardTitle>
                {props.recentTraining.form} · {props.recentTraining.product}
              </CardTitle>
              <CardDescription className="mt-1">
                Gennemført {formatDate(props.recentTraining.completedAt)}. Feedback er klar.
              </CardDescription>
            </InteractiveCard>
            <InteractiveCard href="/assessment">
              <p className="mb-3 flex items-center gap-2 text-label text-fg-secondary">
                <ClipboardCheck className="size-4" aria-hidden />
                Assessment
              </p>
              <CardTitle>
                {availableAssessments.length} {availableAssessments.length === 1 ? "prøve" : "prøver"} klar til at tage
              </CardTitle>
              <div className="mt-3 flex flex-wrap gap-2">
                {availableAssessments.map((item) => (
                  <StatusBadge key={item.id} status={ASSESSMENT_STATUS[item.status].status} label={item.title} />
                ))}
              </div>
            </InteractiveCard>
          </div>
        </div>
      </Section>

      <div className="grid gap-10 lg:grid-cols-5">
        <Section title="Min udvikling" className="lg:col-span-2">
          <Card>
            <p className="text-body text-fg-primary">
              {props.progression.pathsInProgress} forløb i gang · {props.progression.pathsCompleted} af{" "}
              {props.progression.pathsAssigned} tildelte gennemført
            </p>
            <ProgressIndicator
              className="mt-3"
              label="Samlet progression"
              value={props.progression.overallPercent}
              valueText={`${props.progression.overallPercent} %`}
            />
            <Link href="/profile" className="mt-4 inline-flex items-center gap-1 text-label font-medium text-fg-link hover:underline">
              Se Min profil <ArrowRight className="size-3.5" aria-hidden />
            </Link>
          </Card>
        </Section>

        <Section title="Nyt siden sidst" titleId="nyt-siden-sidst" className="lg:col-span-3">
          <Card className="p-0">
            <ul className="divide-y divide-border-subtle">
              {sortedChanges.map((change) => (
                <li key={change.id} className="px-6 py-4">
                  {change.affectsActiveCases > 0 ? (
                    <p className="mb-1.5 inline-flex items-center gap-1.5 text-label font-medium text-warning">
                      <TriangleAlert className="size-3.5" aria-hidden />
                      Berører {change.affectsActiveCases} af dine aktive sager
                    </p>
                  ) : null}
                  <p className="text-body font-medium text-fg-primary">{change.product}</p>
                  <p className="text-body text-fg-secondary">{change.change}</p>
                  <p className="mt-1 text-caption text-fg-tertiary">Gælder fra {formatDate(change.validFrom)}</p>
                </li>
              ))}
            </ul>
          </Card>
          <p className="flex items-center gap-2 text-caption text-fg-tertiary">
            <Info className="size-3.5" aria-hidden />
            Ændringer, der berører dine aktive sager, står øverst.
          </p>
        </Section>
      </div>
    </PageContainer>
  );
}
