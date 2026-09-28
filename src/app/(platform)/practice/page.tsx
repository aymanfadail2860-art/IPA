import { Dumbbell, Target } from "lucide-react";
import type { Metadata } from "next";

import { DisabledReason } from "@/components/common/disabled-reason";
import { PageContainer } from "@/components/common/page-container";
import { PageHeader } from "@/components/common/page-header";
import { Section } from "@/components/common/section";
import { AISuggestion } from "@/components/knowledge/ai-suggestion";
import { LockedState } from "@/components/knowledge/locked-state";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/lib/format";
// PHASE 5: mock data only.
import { mockLatestFeedback, mockRecentTraining, mockRecommendedTraining, mockTrainingForms } from "@/mocks";

export const metadata: Metadata = { title: "Practice" };

const SESSION_REASON = "Træningssessioner kræver AI-integrationen, som bygges i en senere fase.";

export default function PracticePage() {
  return (
    <PageContainer>
      <PageHeader
        display
        title="Practice"
        description="Træn anvendelsen af din viden i sikre rammer — uden risiko for en kunde. Feedbacken efter hver træning er sektionens egentlige produkt."
      />

      <Section title="Træningsformer">
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {mockTrainingForms.map((form) => (
            <li key={form.id}>
              <Card className="flex h-full flex-col">
                <CardTitle className="flex items-center gap-2">
                  <Dumbbell className="size-4 text-fg-secondary" aria-hidden />
                  {form.name}
                </CardTitle>
                <CardDescription className="mt-2 flex-1">{form.trains}</CardDescription>
                {form.copilotLockedDuringSession ? (
                  <LockedState className="mt-4" title="Copilot er slået fra under selve rollespillet">
                    Brug Copilot før rollespillet til forberedelse og bagefter til refleksion.
                  </LockedState>
                ) : null}
                <p className="mt-4 text-caption text-fg-tertiary">{form.lastActivity ?? "Ikke prøvet endnu"}</p>
                <div className="mt-4">
                  <DisabledReason reason={SESSION_REASON}>
                    <Button variant="secondary" size="sm" disabled>
                      Konfigurér træning
                    </Button>
                  </DisabledReason>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      </Section>

      <div className="grid gap-10 lg:grid-cols-2">
        <Section title="Anbefalet næste træning">
          <Card>
            <p className="mb-2 flex items-center gap-2 text-label text-fg-secondary">
              <Target className="size-4" aria-hidden />
              Anbefalet
            </p>
            <CardTitle>
              {mockRecommendedTraining.form} · {mockRecommendedTraining.product}
            </CardTitle>
            <CardDescription className="mt-1">{mockRecommendedTraining.reason}</CardDescription>
          </Card>
        </Section>

        <Section title="Seneste træning">
          <Card className="p-0">
            <ul className="divide-y divide-border-subtle">
              {mockRecentTraining.map((session) => (
                <li key={session.id} className="px-6 py-4">
                  <p className="text-body font-medium text-fg-primary">
                    {session.form} · {session.product}
                  </p>
                  <p className="text-caption text-fg-tertiary">{formatDate(session.completedAt)}</p>
                </li>
              ))}
            </ul>
          </Card>
        </Section>
      </div>

      <Section title="Seneste feedback" description={`${mockLatestFeedback.form} · ${formatDate(mockLatestFeedback.completedAt)}`}>
        <AISuggestion label="AI-genereret feedback · ikke vurderet" title="Samlet vurdering">
          <p>{mockLatestFeedback.overall}</p>
          <h4 className="pt-2 text-label font-semibold text-fg-primary">Styrker</h4>
          <ul className="list-disc space-y-1 pl-5">
            {mockLatestFeedback.strengths.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <h4 className="pt-2 text-label font-semibold text-fg-primary">Forbedringspunkter</h4>
          <ul className="list-disc space-y-1 pl-5">
            {mockLatestFeedback.improvements.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </AISuggestion>
      </Section>
    </PageContainer>
  );
}
