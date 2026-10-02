"use client";

import { Info, ShieldAlert } from "lucide-react";
import { useEffect, useState } from "react";

import { LockedState } from "@/components/knowledge/locked-state";
import { RetrievalProgress, type RetrievalStep } from "@/components/knowledge/retrieval-progress";
import { SourceCard } from "@/components/knowledge/source-card";
import { UnverifiableAnswer } from "@/components/knowledge/unverifiable-answer";
import { ErrorState } from "@/components/states/error-state";
import { Button } from "@/components/ui/button";
import type { CopilotResult } from "@/lib/ai/copilot-view";
import { DEVELOPMENT_ANSWER_LABEL, GATEWAY_UNAVAILABLE_TITLE } from "@/lib/ai/outcome";
import type { SourceReference } from "@/types/domain";

import { CopilotAnswer } from "./copilot-answer";
import type { CopilotMode, QuestionEntry } from "./use-copilot-questions";

const STEP_LABELS = ["Søger i vidensgrundlaget", "Finder relevante afsnit", "Vurderer grundlaget"];

/** The retrieval steps while an answer is formed (docs/04 §8.4). */
function Pending({ question, compact }: { question: string; compact: boolean }) {
  const [active, setActive] = useState(0);
  useEffect(() => {
    if (active >= STEP_LABELS.length - 1) return;
    const timer = window.setTimeout(() => setActive((step) => step + 1), 350);
    return () => window.clearTimeout(timer);
  }, [active]);
  const steps: RetrievalStep[] = STEP_LABELS.map((label, index) => ({ label, state: index < active ? "done" : index === active ? "active" : "pending" }));
  return (
    <article aria-label={`Spørgsmål: ${question}`} aria-busy="true" className="space-y-4">
      <h2 className={compact ? "text-heading-3 text-fg-primary" : "text-heading-2 text-fg-primary"}>{question}</h2>
      <RetrievalProgress steps={steps} />
    </article>
  );
}

function Heading({ question, compact }: { question: string; compact: boolean }) {
  return <h2 className={compact ? "text-heading-3 text-fg-primary" : "text-heading-2 text-fg-primary"}>{question}</h2>;
}

/**
 * One question and its result. Five looks that can never be confused (docs/04 §16, B-016):
 * an answer, "insufficient" (inside CopilotAnswer), "kan ikke dokumenteres", the lock, and a
 * system error.
 */
export function CopilotQuestion({
  entry,
  mode,
  compact = false,
  inlineSources = false,
  activeSourceId,
  onSelectSource,
  onFollowUp,
  onRetry,
}: {
  entry: QuestionEntry;
  mode: CopilotMode;
  compact?: boolean;
  inlineSources?: boolean;
  activeSourceId?: string | null;
  onSelectSource?: (source: SourceReference) => void;
  onFollowUp?: (question: string) => void;
  onRetry?: (question: string) => void;
}) {
  const result: CopilotResult | null = entry.result;
  if (!result) return <Pending question={entry.question} compact={compact} />;

  switch (result.kind) {
    case "exchange":
      return (
        <div className="space-y-3">
          {mode === "demo" ? (
            <p className="w-fit rounded-md bg-surface-sunken px-2 py-1 text-caption text-fg-secondary">Mock-svar · fiktive data · ingen AI</p>
          ) : result.development ? (
            <p role="status" className="flex w-fit items-center gap-2 rounded-md border border-warning/40 bg-warning-subtle px-3 py-1.5 text-caption font-medium">
              <ShieldAlert className="size-3.5 shrink-0" aria-hidden />
              {DEVELOPMENT_ANSWER_LABEL}
            </p>
          ) : null}
          <CopilotAnswer
            exchange={result.exchange}
            compact={compact}
            inlineSources={inlineSources}
            activeSourceId={activeSourceId}
            onSelectSource={onSelectSource}
            onFollowUp={onFollowUp}
            insufficientActions={mode === "live" ? null : undefined}
          />
        </div>
      );
    case "unverifiable":
      return (
        <article aria-label={`Svar på: ${entry.question}`} className="space-y-4">
          <Heading question={entry.question} compact={compact} />
          <UnverifiableAnswer>
            {result.sources.map((source) => (
              <SourceCard key={source.id} source={source} highlighted={activeSourceId === source.id} />
            ))}
          </UnverifiableAnswer>
        </article>
      );
    case "locked":
      return (
        <article aria-label={`Spørgsmål: ${entry.question}`} className="space-y-4">
          <Heading question={entry.question} compact={compact} />
          <LockedState title={result.message}>Copilot er tilgængelig igen, så snart du er færdig.</LockedState>
        </article>
      );
    case "error":
      return (
        <article aria-label={`Spørgsmål: ${entry.question}`} className="space-y-4">
          <Heading question={entry.question} compact={compact} />
          <ErrorState
            title={GATEWAY_UNAVAILABLE_TITLE}
            actions={
              onRetry ? (
                <Button variant="secondary" size="sm" onClick={() => onRetry(entry.question)}>
                  Prøv igen
                </Button>
              ) : undefined
            }
          >
            {result.message} Det er en systemfejl — ikke et svar om vidensgrundlaget.
          </ErrorState>
        </article>
      );
    case "notice":
      return (
        <article aria-label={`Spørgsmål: ${entry.question}`} className="space-y-4">
          <Heading question={entry.question} compact={compact} />
          <div role="status" className="flex items-start gap-3 rounded-md border border-info/30 bg-info-subtle px-4 py-3">
            <Info className="mt-0.5 size-4 shrink-0 text-info" aria-hidden />
            <p className="text-body text-fg-primary">{result.message}</p>
          </div>
        </article>
      );
  }
}
