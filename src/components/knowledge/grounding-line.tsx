import { STATUSES, type KnowledgeStatus } from "@/config/status";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { AnswerKind, SourceReference } from "@/types/domain";

/**
 * GroundingLine — one line that summarises what an answer rests on: number of sources,
 * current or historical, conflicts yes/no. Always present, also when everything is in
 * order — the absence of a warning is itself information (docs/04-ui-ux-design.md §8.2).
 */
export function GroundingLine({
  kind,
  sources,
  historicalAsOf,
  className,
}: {
  kind: AnswerKind;
  sources: readonly SourceReference[];
  historicalAsOf?: string;
  className?: string;
}) {
  const count = sources.length;
  const sourceText = `${count} ${count === 1 ? "kilde" : "kilder"}`;

  const variants: Record<AnswerKind, { status: KnowledgeStatus; text: string }> = {
    complete: { status: "authoritative", text: `${sourceText} · gældende · ingen konflikter` },
    conflict: { status: "conflict", text: `${sourceText} · gældende · kilderne er i konflikt` },
    insufficient: {
      status: "insufficient",
      text: `Utilstrækkeligt grundlag · ${count} delvist relevant${count === 1 ? "" : "e"} afsnit`,
    },
    historical: {
      status: "historical",
      text: `${sourceText} · historisk pr. ${historicalAsOf ? formatDate(historicalAsOf) : "valgt dato"}`,
    },
  };

  const { status, text } = variants[kind];
  const definition = STATUSES[status];
  const Icon = definition.icon;

  return (
    <p
      className={cn(
        "flex items-center gap-2 rounded-md px-3 py-2 text-label",
        definition.subtleClass,
        definition.textClass,
        className,
      )}
    >
      <span className="font-semibold text-fg-primary">Grundlag</span>
      <Icon className="size-4 shrink-0" aria-hidden />
      <span>{text}</span>
    </p>
  );
}
