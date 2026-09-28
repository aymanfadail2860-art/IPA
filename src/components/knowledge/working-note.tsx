"use client";

import { NotebookPen } from "lucide-react";
import { useId } from "react";

import { DisabledActionNote } from "@/components/common/disabled-action-note";

import { cn } from "@/lib/utils";

/**
 * WorkingNote — the adviser's own considerations. Sunken surface, no border, pencil icon
 * and the label "Din note". Not part of the authoritative case and never included in the
 * summary (arch §9).
 */
export function WorkingNote({
  value,
  onChange,
  label = "Din note",
  helpText = "Kun til dit eget arbejde. Noten indgår ikke i sagens opsummering.",
  readOnlyReason,
  className,
}: {
  value: string;
  onChange?: (value: string) => void;
  label?: string;
  helpText?: string;
  /** Shows the note read-only, with a visible reason why it cannot be edited here. */
  readOnlyReason?: string;
  className?: string;
}) {
  const id = useId();
  const editable = Boolean(onChange) && !readOnlyReason;
  return (
    <div data-content-status="working-note" className={cn("rounded-lg bg-note-personal-subtle p-5", className)}>
      <label htmlFor={editable ? id : undefined} className="mb-2 flex items-center gap-2 text-label font-semibold text-note-personal">
        <NotebookPen className="size-4" aria-hidden />
        {label}
      </label>
      {editable ? (
        <textarea
          id={id}
          value={value}
          onChange={(event) => onChange?.(event.target.value)}
          rows={3}
          aria-describedby={`${id}-help`}
          className="w-full resize-y rounded-md border border-border-subtle bg-surface-raised px-3 py-2 text-body text-fg-primary focus-visible:border-focus-ring"
        />
      ) : (
        <p id={id} className="text-body whitespace-pre-line text-fg-primary">
          {value || "Ingen note endnu."}
        </p>
      )}
      {readOnlyReason ? <DisabledActionNote reason={readOnlyReason} className="mt-2" /> : null}
      <p id={`${id}-help`} className="mt-2 text-caption text-fg-secondary">
        {helpText}
      </p>
    </div>
  );
}
