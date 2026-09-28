"use client";

import { Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * AIRequestTrigger — on-demand AI in Advise (docs/04-ui-ux-design.md §10.4). The AI section
 * starts empty with one action; the adviser thinks first and asks actively.
 *
 * Deliberately NOT dashed: the dashed border belongs only to AI content that awaits human
 * assessment, and the trigger is not content.
 */
export function AIRequestTrigger({
  label,
  description,
  loading = false,
  onRequest,
  className,
}: {
  label: string;
  description?: string;
  loading?: boolean;
  onRequest: () => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-start gap-3 rounded-lg border border-border-subtle bg-surface-raised p-5 sm:flex-row sm:items-center sm:justify-between",
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <Sparkles className="mt-0.5 size-4 shrink-0 text-ai-suggestion" aria-hidden />
        <p className="text-body text-fg-secondary">
          {description ?? "AI-forslag vises først, når du beder om dem."}
        </p>
      </div>
      <Button variant="secondary" size="sm" onClick={onRequest} loading={loading}>
        <Sparkles aria-hidden className="text-ai-suggestion" />
        {label}
      </Button>
    </div>
  );
}
