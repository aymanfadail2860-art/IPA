import { ClipboardCheck, Clock, FileText, Lock, Monitor, Smartphone, Timer } from "lucide-react";
import type { Metadata } from "next";

import { DisabledReason } from "@/components/common/disabled-reason";
import { PageContainer } from "@/components/common/page-container";
import { PageHeader } from "@/components/common/page-header";
import { Section } from "@/components/common/section";
import { ProgressIndicator } from "@/components/data/progress-indicator";
import { LockedState } from "@/components/knowledge/locked-state";
import { StatusBadge } from "@/components/status/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { ASSESSMENT_STATUS, DEVICE_POLICY } from "@/config/domain-status";
import { formatDate } from "@/lib/format";
// PHASE 5: mock data only.
import { mockAssessments, mockCompetencies, mockCompetencyLevelLabels } from "@/mocks";

export const metadata: Metadata = { title: "Assessment" };

export default function AssessmentPage() {
  const results = mockAssessments.filter((item) => item.result);
  return (
    <PageContainer>
      <PageHeader
        display
        title="Assessment"
        description="Tests og cases, der dokumenterer din kompetence. Resultaterne indgår i din kompetenceprofil."
      />

      <LockedState title="Copilot og AI-hjælp er slået fra under en prøve">
        Prøven måler din egen faglige kunnen. Når du har afleveret, er Copilot tilbage og kan hjælpe dig med at gennemgå
        dine svar.
      </LockedState>

      <Section title="Prøver">
        <ul className="grid gap-4 md:grid-cols-2">
          {mockAssessments.map((item) => {
            const status = ASSESSMENT_STATUS[item.status];
            const DeviceIcon = item.devicePolicy === "mobileAllowed" ? Smartphone : Monitor;
            return (
              <li key={item.id}>
                <Card className="flex h-full flex-col">
                  <div className="flex items-start justify-between gap-3">
                    <p className="flex items-center gap-2 text-label text-fg-secondary">
                      {item.type === "test" ? <ClipboardCheck className="size-4" aria-hidden /> : <FileText className="size-4" aria-hidden />}
                      {item.type === "test" ? "Test" : "Case"} · {item.product}
                    </p>
                    <StatusBadge status={status.status} label={status.label} />
                  </div>
                  <CardTitle className="mt-2">{item.title}</CardTitle>
                  <dl className="mt-3 flex flex-1 flex-wrap gap-x-5 gap-y-1.5 text-body text-fg-secondary">
                    <div className="flex items-center gap-1.5">
                      <dt className="sr-only">Varighed</dt>
                      {item.timeLimited ? <Timer className="size-4" aria-hidden /> : <Clock className="size-4" aria-hidden />}
                      <dd>
                        {item.timeLimited ? `Tidsgrænse ${item.durationMinutes} min.` : `Ca. ${item.durationMinutes} min. · ingen tidsgrænse`}
                      </dd>
                    </div>
                    {item.questions ? (
                      <div>
                        <dt className="sr-only">Spørgsmål</dt>
                        <dd>{item.questions} spørgsmål</dd>
                      </div>
                    ) : null}
                    <div className="flex items-center gap-1.5">
                      <dt className="sr-only">Enhedspolitik</dt>
                      <DeviceIcon className="size-4" aria-hidden />
                      <dd>{DEVICE_POLICY[item.devicePolicy]}</dd>
                    </div>
                  </dl>
                  {item.prerequisite ? (
                    <p className="mt-3 flex items-center gap-1.5 text-body text-fg-secondary">
                      <Lock className="size-4" aria-hidden />
                      Forudsætning: {item.prerequisite}
                    </p>
                  ) : null}
                  {item.result ? (
                    <p className="mt-3 text-body text-fg-primary">
                      {item.result.score} · {formatDate(item.result.completedAt)}
                    </p>
                  ) : null}
                  {item.status === "available" ? (
                    <div className="mt-4">
                      <DisabledReason reason="Prøveafvikling bygges i en senere fase.">
                        <Button variant="primary" size="sm" disabled>
                          Gå til startside
                        </Button>
                      </DisabledReason>
                    </div>
                  ) : null}
                </Card>
              </li>
            );
          })}
        </ul>
      </Section>

      <div className="grid gap-10 lg:grid-cols-2">
        <Section title="Resultater">
          <Card className="p-0">
            <ul className="divide-y divide-border-subtle">
              {results.map((item) => (
                <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 px-6 py-4">
                  <span>
                    <span className="block text-body font-medium text-fg-primary">{item.title}</span>
                    <span className="block text-caption text-fg-tertiary">
                      {item.result!.score} · {formatDate(item.result!.completedAt)}
                    </span>
                  </span>
                  <StatusBadge status={ASSESSMENT_STATUS[item.status].status} label={ASSESSMENT_STATUS[item.status].label} />
                </li>
              ))}
            </ul>
          </Card>
        </Section>
        <Section title="Kompetencer" description="Opgøres her i Assessment og vises i Min profil.">
          <Card className="space-y-4">
            {mockCompetencies.map((competency) => (
              <ProgressIndicator
                key={competency.id}
                label={competency.name}
                value={competency.level}
                max={4}
                valueText={`${mockCompetencyLevelLabels[competency.level]} (${competency.level} af 4)`}
              />
            ))}
          </Card>
        </Section>
      </div>
    </PageContainer>
  );
}
