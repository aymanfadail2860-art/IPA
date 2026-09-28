"use client";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { SourceReference } from "@/types/domain";

import { sourceAccessibleName, sourceLocation } from "./source-validity";

/**
 * SourceMarker — level 1 of the citation UX: a small numbered mark in running text.
 * Hover or focus shows document and section; click highlights the source card.
 * Screen readers hear "Kilde 1: Betingelser for Erhvervsansvar, version 3".
 */
export function SourceMarker({
  source,
  active = false,
  onSelect,
}: {
  source: SourceReference;
  active?: boolean;
  onSelect?: (source: SourceReference) => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={sourceAccessibleName(source)}
          aria-pressed={active}
          onClick={() => onSelect?.(source)}
          className={cn(
            "mx-0.5 inline-flex h-[1.15rem] min-w-[1.15rem] -translate-y-px cursor-pointer items-center justify-center rounded-sm px-1 align-middle font-mono text-[0.6875rem] leading-none font-medium transition-colors",
            active
              ? "bg-brand text-fg-inverse"
              : "bg-brand-subtle text-brand hover:bg-brand hover:text-fg-inverse",
          )}
        >
          {source.number}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-72">
        <p className="font-semibold">{source.documentTitle}</p>
        <p className="opacity-90">{sourceLocation(source)}</p>
      </TooltipContent>
    </Tooltip>
  );
}
