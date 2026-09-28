"use client";

import { BadgeCheck, Undo2 } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { SourceReference } from "@/types/domain";

import { SourceCard } from "./source-card";

/**
 * ValidatedConclusion — a conclusion a human has taken a position on and agreed to.
 * Solid, thick left edge, full-strength surface, bold title and "Valideret af [navn] · [dato]".
 * Part of the authoritative case (arch §9).
 */
export function ValidatedConclusion({
  title,
  children,
  validatedBy,
  validatedAt,
  sources,
  onUndo,
  className,
}: {
  title: string;
  children: ReactNode;
  validatedBy: string;
  validatedAt: string;
  sources?: readonly SourceReference[];
  onUndo?: () => void;
  className?: string;
}) {
  const label = `Valideret af ${validatedBy} · ${formatDate(validatedAt)}`;
  return (
    <article
      aria-label={`Valideret konklusion: ${title}. ${label}`}
      data-content-status="validated"
      className={cn(
        "rounded-lg border border-l-4 border-border-subtle border-l-ai-validated bg-surface-raised p-5",
        className,
      )}
    >
      <p className="mb-2 flex items-center gap-2 text-label font-semibold text-ai-validated">
        <BadgeCheck className="size-4" aria-hidden />
        {label}
      </p>
      <h3 className="text-heading-3 font-semibold text-fg-primary">{title}</h3>
      <div className="mt-1 space-y-2 text-body text-fg-primary">{children}</div>
      {sources && sources.length > 0 ? (
        <div className="mt-4 space-y-2">
          {sources.map((source) => (
            <SourceCard key={source.id} source={source} />
          ))}
        </div>
      ) : null}
      {onUndo ? (
        <div className="mt-4">
          <Button size="sm" variant="ghost" onClick={onUndo}>
            <Undo2 aria-hidden />
            Fortryd validering
          </Button>
        </div>
      ) : null}
    </article>
  );
}
