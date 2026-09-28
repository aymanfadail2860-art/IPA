import { GitCompare } from "lucide-react";

import { cn } from "@/lib/utils";
import type { SourceReference } from "@/types/domain";

import { SourceCard } from "./source-card";

/**
 * ConflictView — two contradicting sources side by side. The platform never decides a
 * conflict automatically (arch §16); it shows both and says the conflict is reported.
 */
export function ConflictView({
  sources,
  className,
}: {
  sources: readonly [SourceReference, SourceReference];
  className?: string;
}) {
  return (
    <section
      aria-label="Konflikt mellem kilder"
      className={cn("rounded-lg border border-knowledge-conflict/30 bg-knowledge-conflict-subtle p-4", className)}
    >
      <p className="mb-3 flex items-center gap-2 text-label font-semibold text-knowledge-conflict">
        <GitCompare className="size-4" aria-hidden />
        Konflikt mellem kilder · ingen afgørelse
      </p>
      <div className="grid gap-3 md:grid-cols-2">
        {sources.map((source) => (
          <SourceCard key={source.id} source={source} />
        ))}
      </div>
      <p className="mt-3 text-caption text-fg-secondary">
        Konflikten er meldt til fagligt ansvarlig. Platformen vælger ikke, hvilken kilde der gælder.
      </p>
    </section>
  );
}
