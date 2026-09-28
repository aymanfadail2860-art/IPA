"use client";

import { Check, Pencil, Sparkles, X } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { SourceReference } from "@/types/domain";

import { SourceCard } from "./source-card";

/**
 * AISuggestion — AI-generated content awaiting human assessment.
 *
 * The AI signature (docs/04-ui-ux-design.md §3.4, §10.2): DASHED border + tinted surface +
 * a clear "AI-forslag" label. The dashed border is reserved for exactly this — no other
 * component in the product may use it (enforced by src/tests/ai-signature.test.ts).
 * Italics are never used as an AI marker.
 *
 * A suggestion cannot drift into a conclusion: acceptance is an explicit action, after
 * which the item is rendered as <ValidatedConclusion> instead.
 */
export function AISuggestion({
  title,
  children,
  label = "AI-forslag · ikke vurderet",
  sources,
  onAccept,
  onEditAndAccept,
  onReject,
  className,
}: {
  title?: string;
  children: ReactNode;
  label?: string;
  sources?: readonly SourceReference[];
  onAccept?: () => void;
  onEditAndAccept?: () => void;
  onReject?: () => void;
  className?: string;
}) {
  const hasActions = Boolean(onAccept || onEditAndAccept || onReject);

  return (
    <article
      aria-label={`${label}${title ? `: ${title}` : ""}`}
      data-content-status="ai-suggestion"
      className={cn(
        "rounded-lg border border-dashed border-ai-suggestion/60 border-l-[3px] border-l-ai-suggestion bg-ai-suggestion-subtle p-5",
        className,
      )}
    >
      <p className="mb-2 flex items-center gap-2 text-label font-semibold text-ai-suggestion">
        <Sparkles className="size-4" aria-hidden />
        {label}
      </p>
      {title ? <h3 className="text-heading-3 text-fg-primary">{title}</h3> : null}
      <div className="mt-1 space-y-2 text-body text-fg-primary">{children}</div>

      {sources && sources.length > 0 ? (
        <div className="mt-4 space-y-2">
          <p className="text-caption font-medium text-fg-secondary">Kilder for forslaget</p>
          {sources.map((source) => (
            <SourceCard key={source.id} source={source} />
          ))}
        </div>
      ) : null}

      {hasActions ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {onAccept ? (
            <Button size="sm" variant="secondary" onClick={onAccept}>
              <Check aria-hidden />
              Acceptér
            </Button>
          ) : null}
          {onEditAndAccept ? (
            <Button size="sm" variant="ghost" onClick={onEditAndAccept}>
              <Pencil aria-hidden />
              Redigér og acceptér
            </Button>
          ) : null}
          {onReject ? (
            <Button size="sm" variant="ghost" onClick={onReject}>
              <X aria-hidden />
              Forkast
            </Button>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
