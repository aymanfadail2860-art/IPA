"use client";

import { Info } from "lucide-react";
import { useEffect, useState } from "react";

import { RetrievalProgress, type RetrievalStep } from "@/components/knowledge/retrieval-progress";

const STEP_LABELS = ["Søger i vidensgrundlaget", "Finder relevante afsnit", "Vurderer grundlaget"];

/**
 * PHASE 5 placeholder for a newly asked question. It demonstrates the retrieval state and
 * then says honestly that Copilot is not connected yet. No search or AI call happens.
 * Replaced by the real server-side flow (AI Gateway + Knowledge Engine) in a later phase.
 */
export function PendingQuestion({ question, compact = false }: { question: string; compact?: boolean }) {
  const [activeStep, setActiveStep] = useState(0);

  useEffect(() => {
    if (activeStep > STEP_LABELS.length) return;
    const timer = window.setTimeout(() => setActiveStep((step) => step + 1), 700);
    return () => window.clearTimeout(timer);
  }, [activeStep]);

  const steps: RetrievalStep[] = STEP_LABELS.map((label, index) => ({
    label,
    state: index < activeStep ? "done" : index === activeStep ? "active" : "pending",
  }));

  return (
    <article aria-label={`Spørgsmål: ${question}`} className="space-y-4">
      <h2 className={compact ? "text-heading-3 text-fg-primary" : "text-heading-2 text-fg-primary"}>{question}</h2>
      <RetrievalProgress steps={steps} />
      {activeStep > STEP_LABELS.length - 1 ? (
        <div role="status" className="flex items-start gap-3 rounded-md border border-info/30 bg-info-subtle px-4 py-3">
          <Info className="mt-0.5 size-4 shrink-0 text-info" aria-hidden />
          <p className="text-body text-fg-primary">
            <strong className="font-semibold">Copilot er ikke forbundet til vidensgrundlaget i denne udviklingsversion.</strong>{" "}
            Søgetrinnene ovenfor er en demonstration af tilstanden — der er ikke udført en rigtig søgning, og der
            gives ikke et svar. Vælg en eksempelsamtale for at se, hvordan svar og kilder vises.
          </p>
        </div>
      ) : null}
    </article>
  );
}
