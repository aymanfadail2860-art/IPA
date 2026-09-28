import { History } from "lucide-react";

import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * HistoricalBanner — fixed marking over an entire historical answer. It cannot be hidden
 * or collapsed: a historical answer without marking is a wrong answer (§8.3, arch §12).
 */
export function HistoricalBanner({ asOf, className }: { asOf: string; className?: string }) {
  return (
    <div
      role="note"
      className={cn(
        "flex items-start gap-3 rounded-md border border-knowledge-historical/30 bg-knowledge-historical-subtle px-4 py-3 text-knowledge-historical",
        className,
      )}
    >
      <History className="mt-0.5 size-4 shrink-0" aria-hidden />
      <p className="text-body">
        <strong className="font-semibold">Historisk svar — gældende pr. {formatDate(asOf)}.</strong>{" "}
        Ikke nødvendigvis gældende i dag.
      </p>
    </div>
  );
}
