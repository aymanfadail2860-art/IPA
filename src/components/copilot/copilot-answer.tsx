"use client";

import { Check, Copy, ThumbsDown, ThumbsUp } from "lucide-react";
import { Fragment, useState } from "react";

import { ConflictView } from "@/components/knowledge/conflict-view";
import { GroundingLine } from "@/components/knowledge/grounding-line";
import { HistoricalBanner } from "@/components/knowledge/historical-banner";
import { InsufficientEvidence } from "@/components/knowledge/insufficient-evidence";
import { SourceCard } from "@/components/knowledge/source-card";
import { SourceMarker } from "@/components/knowledge/source-marker";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { AnswerParagraph, CopilotExchange, SourceReference } from "@/types/domain";

import { FollowUpChips } from "./follow-up-chips";

function Paragraph({
  paragraph,
  sources,
  activeSourceId,
  onSelectSource,
}: {
  paragraph: AnswerParagraph;
  sources: readonly SourceReference[];
  activeSourceId?: string | null;
  onSelectSource?: (source: SourceReference) => void;
}) {
  return (
    <p>
      {paragraph.map((segment, index) => {
        if (typeof segment === "string") return <Fragment key={index}>{segment}</Fragment>;
        const source = sources.find((entry) => entry.number === segment.source);
        if (!source) return null;
        return (
          <SourceMarker key={index} source={source} active={activeSourceId === source.id} onSelect={onSelectSource} />
        );
      })}
    </p>
  );
}

/**
 * CopilotAnswer (AIAnswer) — the fixed anatomy of a professional answer (§8.2):
 * the question as a calm heading, the answer with inline source markers, the grounding
 * line, follow-up chips and actions. Special states (insufficient, conflict, historical)
 * are designed as equal answers, not as errors (§8.3).
 */
export function CopilotAnswer({
  exchange,
  activeSourceId,
  onSelectSource,
  onFollowUp,
  inlineSources = false,
  compact = false,
}: {
  exchange: CopilotExchange;
  activeSourceId?: string | null;
  onSelectSource?: (source: SourceReference) => void;
  onFollowUp?: (question: string) => void;
  /** Narrow context panel: sources are listed under the answer instead of in a column. */
  inlineSources?: boolean;
  compact?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [feedback, setFeedback] = useState<"up" | "down" | null>(null);

  const body = (
    <div className={cn("space-y-3 text-fg-primary", compact ? "text-body" : "text-[0.9375rem] leading-7")}>
      {exchange.paragraphs.map((paragraph, index) => (
        <Paragraph
          key={index}
          paragraph={paragraph}
          sources={exchange.sources}
          activeSourceId={activeSourceId}
          onSelectSource={onSelectSource}
        />
      ))}
    </div>
  );

  async function copyAnswer() {
    const text = exchange.paragraphs
      .map((paragraph) =>
        paragraph.map((segment) => (typeof segment === "string" ? segment : `[${segment.source}]`)).join(""),
      )
      .join("\n\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard not available — nothing to report in a mock */
    }
  }

  return (
    <article aria-label={`Svar på: ${exchange.question}`} className="space-y-4">
      <h2 className={cn("text-fg-primary", compact ? "text-heading-3" : "text-heading-2")}>{exchange.question}</h2>

      {exchange.kind === "historical" && exchange.historicalAsOf ? <HistoricalBanner asOf={exchange.historicalAsOf} /> : null}

      {exchange.kind === "insufficient" ? (
        <InsufficientEvidence
          actions={
            <>
              <Button size="sm" variant="secondary" onClick={() => onFollowUp?.("Omformulér spørgsmålet")}>
                Omformulér
              </Button>
              <Button size="sm" variant="secondary" onClick={() => onFollowUp?.("Søg kun i Erhvervsansvar")}>
                Søg i et bestemt produkt
              </Button>
              <Button size="sm" variant="ghost">
                Kontakt fagligt ansvarlig
              </Button>
            </>
          }
        >
          {body}
        </InsufficientEvidence>
      ) : (
        body
      )}

      {exchange.kind === "conflict" && exchange.sources.length === 2 && !inlineSources ? (
        <ConflictView sources={[exchange.sources[0], exchange.sources[1]]} />
      ) : null}

      <GroundingLine kind={exchange.kind} sources={exchange.sources} historicalAsOf={exchange.historicalAsOf} />

      {inlineSources ? (
        <div className="space-y-2">
          <h3 className="text-caption font-medium text-fg-tertiary">Kilder</h3>
          {exchange.sources.map((source) => (
            <SourceCard key={source.id} source={source} highlighted={activeSourceId === source.id} />
          ))}
        </div>
      ) : null}

      <FollowUpChips questions={exchange.followUps} onSelect={onFollowUp} />

      <div className="flex flex-wrap items-center gap-1 border-t border-border-subtle pt-3">
        <Button variant="ghost" size="sm" onClick={copyAnswer}>
          {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
          {copied ? "Kopieret" : "Kopiér"}
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Svaret var brugbart"
          aria-pressed={feedback === "up"}
          onClick={() => setFeedback(feedback === "up" ? null : "up")}
          className={cn(feedback === "up" && "bg-accent-subtle")}
        >
          <ThumbsUp aria-hidden />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Svaret var ikke brugbart"
          aria-pressed={feedback === "down"}
          onClick={() => setFeedback(feedback === "down" ? null : "down")}
          className={cn(feedback === "down" && "bg-accent-subtle")}
        >
          <ThumbsDown aria-hidden />
        </Button>
        {feedback ? (
          <span role="status" className="text-caption text-fg-secondary">
            Tak for din feedback.
          </span>
        ) : null}
      </div>
    </article>
  );
}
