"use client";

import { ArrowRight, GitCompare, Quote } from "lucide-react";

import { StatusBadge } from "@/components/status/status-badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { SourceReference } from "@/types/domain";

import { sourceAccessibleName, sourceLocation, sourceStatus } from "./source-validity";

/**
 * SourceCard — level 2 of the citation UX (docs/04-ui-ux-design.md §17). Always shows
 * number, title, version, section and page, a short excerpt and validity with icon + text.
 * Variants: current, historical (tinted), in conflict (conflict edge) and deactivated.
 * A repeated lead-in is shown as context above the excerpt, visually separated from the
 * quoted passage, so "undtagelse 7" can be read with the list it belongs to (B-005).
 */
export function SourceCard({
  source,
  highlighted = false,
  onOpen,
  className,
}: {
  source: SourceReference;
  highlighted?: boolean;
  onOpen?: (source: SourceReference) => void;
  className?: string;
}) {
  const { status, label } = sourceStatus(source);
  const inConflict = source.conflictsWith !== undefined;

  return (
    <article
      id={`source-${source.id}`}
      aria-label={sourceAccessibleName(source)}
      data-highlighted={highlighted || undefined}
      className={cn(
        "rounded-lg border bg-surface-raised p-4 transition-colors",
        source.validity === "historical" && "bg-knowledge-historical-subtle",
        inConflict ? "border-l-4 border-border-subtle border-l-knowledge-conflict" : "border-border-subtle",
        highlighted && "ring-2 ring-focus-ring",
        className,
      )}
    >
      <header className="flex gap-3">
        <span
          aria-hidden
          className="mt-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-sm bg-brand-subtle px-1 font-mono text-caption font-medium text-brand"
        >
          {source.number}
        </span>
        <div className="min-w-0">
          <h3 className="text-label font-semibold text-fg-primary">{source.documentTitle}</h3>
          <p className="font-mono text-caption text-fg-tertiary">{sourceLocation(source)}</p>
        </div>
      </header>

      {source.leadIn ? (
        <p className="mt-3 border-l-2 border-border-strong pl-2 text-caption text-fg-tertiary">
          <span className="sr-only">Indledning til uddraget: </span>
          {source.leadIn}
        </p>
      ) : null}
      <blockquote className={cn("flex gap-2 text-body text-fg-secondary", source.leadIn ? "mt-1.5" : "mt-3")}>
        <Quote className="mt-0.5 size-3.5 shrink-0 text-fg-tertiary" aria-hidden />
        <p className="line-clamp-4">{source.excerpt}</p>
      </blockquote>

      <footer className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusBadge status={status} label={label} />
          {inConflict ? (
            <span className="inline-flex items-center gap-1.5 text-label text-knowledge-conflict">
              <GitCompare className="size-3.5" aria-hidden />
              Modstrider kilde [{source.conflictsWith}]
            </span>
          ) : null}
        </div>
        {onOpen ? (
          <Button variant="link" size="sm" onClick={() => onOpen(source)}>
            Åbn
            <ArrowRight aria-hidden />
            <span className="sr-only">{sourceAccessibleName(source)}</span>
          </Button>
        ) : null}
      </footer>
    </article>
  );
}
