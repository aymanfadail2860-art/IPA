import type { Status } from "@/config/status";
import { formatDate, formatValidTo } from "@/lib/format";
import type { SourceReference } from "@/types/domain";

/** Maps a source to its status role and the validity text shown on the card. */
export function sourceStatus(source: SourceReference): { status: Status; label: string } {
  if (source.validity === "deactivated") {
    return { status: "neutral", label: "Ikke længere del af vidensgrundlaget" };
  }
  if (source.validity === "historical") {
    const period = source.validTo
      ? `${formatDate(source.validFrom)} – ${formatValidTo(source.validTo)}`
      : `fra ${formatDate(source.validFrom)}`;
    return { status: "historical", label: `Historisk — gjaldt ${period}` };
  }
  return { status: "authoritative", label: `Gældende fra ${formatDate(source.validFrom)}` };
}

/** Accessible name, e.g. "Kilde 1: Betingelser for Erhvervsansvar, version 3". */
export function sourceAccessibleName(source: SourceReference): string {
  return `Kilde ${source.number}: ${source.documentTitle}, version ${source.version}`;
}

export function sourceLocation(source: SourceReference): string {
  return [`Version ${source.version}`, source.section, source.page ? `side ${source.page}` : null]
    .filter(Boolean)
    .join(" · ");
}
