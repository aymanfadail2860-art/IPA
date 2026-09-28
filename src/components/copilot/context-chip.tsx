"use client";

import { X } from "lucide-react";

/** ContextChip — shows the Copilot context and lets the user remove it (§15.2). */
export function ContextChip({ context, onRemove }: { context: string; onRemove?: () => void }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border-subtle bg-surface-sunken py-0.5 pr-1 pl-3 text-label text-fg-secondary">
      <span className="truncate">
        <span className="text-fg-tertiary">Kontekst: </span>
        {context}
      </span>
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          aria-label="Fjern kontekst og stil et generelt spørgsmål"
          className="inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-full hover:bg-surface-raised"
        >
          <X className="size-3" aria-hidden />
        </button>
      ) : null}
    </span>
  );
}
