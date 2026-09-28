"use client";

import { ArrowUp } from "lucide-react";
import { useId, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { ContextChip } from "./context-chip";

/**
 * CopilotInput — a question field, not a search bar (§6). Carries the context chip.
 * The label is visible to screen readers; the placeholder is never the only label.
 */
export function CopilotInput({
  onSubmit,
  context,
  onRemoveContext,
  label = "Spørg Copilot",
  placeholder = "Spørg om et produkt, en dækning eller en regel",
  size = "md",
  autoFocus = false,
  className,
  inputId,
}: {
  onSubmit: (question: string) => void;
  context?: string | null;
  onRemoveContext?: () => void;
  label?: string;
  placeholder?: string;
  size?: "md" | "lg";
  autoFocus?: boolean;
  className?: string;
  inputId?: string;
}) {
  const [value, setValue] = useState("");
  const generatedId = useId();
  const id = inputId ?? generatedId;

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const question = value.trim();
    if (!question) return;
    onSubmit(question);
    setValue("");
  }

  return (
    <form
      onSubmit={handleSubmit}
      className={cn(
        "rounded-lg border border-border-subtle bg-surface-raised p-2 transition-colors focus-within:border-focus-ring",
        className,
      )}
    >
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      {context ? (
        <div className="px-2 pt-1 pb-2">
          <ContextChip context={context} onRemove={onRemoveContext} />
        </div>
      ) : null}
      <div className="flex items-end gap-2">
        <textarea
          id={id}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
          rows={1}
          autoFocus={autoFocus}
          placeholder={placeholder}
          className={cn(
            "max-h-40 min-h-9 flex-1 resize-none bg-transparent px-2 py-1.5 text-fg-primary outline-none placeholder:text-fg-tertiary focus-visible:outline-none",
            size === "lg" ? "text-[1rem] leading-6" : "text-body",
          )}
        />
        <Button type="submit" variant="primary" size="icon" aria-label="Send spørgsmål" disabled={!value.trim()}>
          <ArrowUp aria-hidden />
        </Button>
      </div>
    </form>
  );
}
