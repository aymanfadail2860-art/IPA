import type { StructureChunk } from "@/lib/knowledge/admin-data";

/**
 * Structure view of a version (docs/07 §12, docs/04 §14.2): the normalized text as chunks,
 * with heading chain, pages and chunk boundaries. A repeated lead-in is shown as context,
 * separated from the chunk's own text (B-005).
 */
export function StructureView({ chunks }: { chunks: readonly StructureChunk[] }) {
  if (chunks.length === 0) return <p className="text-body text-fg-secondary">Der er endnu ingen tekst at vise. Versionen er ikke færdigbehandlet.</p>;
  return (
    <ol className="space-y-3" aria-label="Dokumentets struktur">
      {chunks.map((chunk) => (
        <li key={chunk.id} className="rounded-md border border-border-subtle bg-surface-raised p-4">
          <p className="mb-2 flex flex-wrap items-center justify-between gap-2 text-caption text-fg-tertiary">
            <span>{chunk.headingPath.length > 0 ? chunk.headingPath.join(" › ") : "Uden overskrift"}</span>
            <span className="font-mono">
              Chunk {chunk.index + 1} · {chunk.kind === "list" ? "liste" : chunk.kind === "table" ? "tabel" : "tekst"} · side{" "}
              {chunk.pageStart === chunk.pageEnd ? chunk.pageStart : `${chunk.pageStart}–${chunk.pageEnd}`}
            </span>
          </p>
          {chunk.leadIn ? (
            <p className="mb-2 border-l-2 border-border-strong pl-3 text-caption text-fg-secondary">
              <span className="sr-only">Gentaget indledning: </span>
              {chunk.leadIn}
            </p>
          ) : null}
          <p className="text-body whitespace-pre-wrap text-fg-primary">{chunk.text}</p>
        </li>
      ))}
    </ol>
  );
}
