import { ArrowRight, ShieldCheck } from "lucide-react";

import { cn } from "@/lib/utils";

interface Stage {
  label: string;
  count: number;
}

function StageList({ stages, tone }: { stages: readonly Stage[]; tone: "technical" | "approval" }) {
  return (
    <ol className="flex flex-wrap items-center gap-2">
      {stages.map((stage, index) => (
        <li key={stage.label} className="flex items-center gap-2">
          {index > 0 ? <ArrowRight className="size-4 text-fg-tertiary" aria-hidden /> : null}
          <span
            className={cn(
              "inline-flex items-center gap-2 rounded-md border px-3 py-2 text-body",
              tone === "approval"
                ? "border-knowledge-authoritative/30 bg-knowledge-authoritative-subtle text-fg-primary"
                : "border-border-subtle bg-surface-sunken text-fg-primary",
            )}
          >
            {stage.label}
            <span className="tabular rounded-sm bg-surface-raised px-1.5 text-label font-semibold">{stage.count}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

/**
 * PipelineStatus — the document pipeline as a status chain with a CLEAR BREAK between
 * technical processing and professional approval (docs/04-ui-ux-design.md §14.1). No part
 * of the automatic processing can make a document authoritative.
 */
export function PipelineStatus({ technical, approval }: { technical: readonly Stage[]; approval: readonly Stage[] }) {
  return (
    <div className="grid rounded-lg border border-border-subtle bg-surface-raised md:grid-cols-[1fr_auto_1fr]">
      <section aria-labelledby="pipeline-technical" className="space-y-3 p-6">
        <h3 id="pipeline-technical" className="text-label font-semibold tracking-wide text-fg-secondary uppercase">
          Teknisk behandling
        </h3>
        <StageList stages={technical} tone="technical" />
        <p className="text-caption text-fg-tertiary">Automatisk. Gør aldrig et dokument autoritativt.</p>
      </section>
      <div aria-hidden className="mx-6 border-t-4 border-double border-border-strong md:mx-0 md:my-6 md:border-t-0 md:border-l-4" />
      <section aria-labelledby="pipeline-approval" className="space-y-3 p-6">
        <h3 id="pipeline-approval" className="flex items-center gap-2 text-label font-semibold tracking-wide text-knowledge-authoritative uppercase">
          <ShieldCheck className="size-4" aria-hidden />
          Faglig godkendelse
        </h3>
        <StageList stages={approval} tone="approval" />
        <p className="text-caption text-fg-tertiary">Kræver et menneske. Kun her bliver viden gældende.</p>
      </section>
    </div>
  );
}
