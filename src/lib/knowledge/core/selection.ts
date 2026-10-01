/**
 * Evidence selection (docs/07 §8.3). Deterministic rules; the numbers are configuration:
 *
 *   * sorted by rerank score
 *   * a minimum score below which a chunk never becomes evidence
 *   * at most `maxPerVersion` chunks per version, so one document cannot fill the result
 *   * at most `topK` chunks
 *   * neighbouring chunks of the same section are merged when both are selected
 *
 * Phase 7 does NOT judge whether the evidence is sufficient — that needs the grounding layer.
 */

export interface SelectionConfig {
  topK: number;
  maxPerVersion: number;
  minScore: number;
}

export interface SelectableChunk {
  chunkId: string;
  versionId: string;
  chunkIndex: number;
  headingPath: string[];
  score: number;
  rank: number;
  text: string;
  charStart: number;
  charEnd: number;
}

/**
 * Selects chunks and groups selected neighbours. Each group is one evidence item, best first.
 */
export function selectChunks<T extends SelectableChunk>(ranked: T[], config: SelectionConfig): T[][] {
  const sorted = [...ranked].sort((a, b) => b.score - a.score || a.rank - b.rank);
  const perVersion = new Map<string, number>();
  const chosen: T[] = [];
  for (const chunk of sorted) {
    if (chosen.length >= config.topK) break;
    if (chunk.score < config.minScore) continue;
    const count = perVersion.get(chunk.versionId) ?? 0;
    if (count >= config.maxPerVersion) continue;
    perVersion.set(chunk.versionId, count + 1);
    chosen.push(chunk);
  }

  const byPosition = [...chosen].sort((a, b) => (a.versionId < b.versionId ? -1 : a.versionId > b.versionId ? 1 : a.chunkIndex - b.chunkIndex));
  const groups: T[][] = [];
  for (const chunk of byPosition) {
    const group = groups[groups.length - 1];
    const last = group?.[group.length - 1];
    if (group && last && isNeighbour(last, chunk)) group.push(chunk);
    else groups.push([chunk]);
  }
  const best = (group: T[]) => group.reduce((top, chunk) => (chunk.score > top.score || (chunk.score === top.score && chunk.rank < top.rank) ? chunk : top));
  return groups.sort((a, b) => best(b).score - best(a).score || best(a).rank - best(b).rank);
}

/** Same version, consecutive chunks, same section (heading chain) and textually adjacent. */
function isNeighbour(a: SelectableChunk, b: SelectableChunk): boolean {
  return (
    a.versionId === b.versionId &&
    b.chunkIndex === a.chunkIndex + 1 &&
    a.headingPath.length === b.headingPath.length &&
    a.headingPath.every((heading, i) => heading === b.headingPath[i]) &&
    mergeExcerpt([a, b]) !== null
  );
}

/**
 * The exact source text of [first.charStart, last.charEnd) rebuilt from adjacent chunks.
 *
 * Chunk texts are exact slices of the version's normalized text. Within a section, the text
 * between two consecutive chunks is either repeated (sentence overlap) or only the block
 * separator ("\n" inside a list/table, "\n\n" between blocks — see the worker's structure
 * step). Anything else is not merged (returns null), so a merged excerpt is never invented.
 */
export function mergeExcerpt(chunks: Pick<SelectableChunk, "text" | "charStart" | "charEnd">[]): string | null {
  let text = "";
  let end: number | null = null;
  for (const chunk of chunks) {
    if (end === null) {
      text = chunk.text;
    } else if (chunk.charStart <= end) {
      const repeated = end - chunk.charStart;
      if (repeated > chunk.text.length) return null;
      text += chunk.text.slice(repeated);
    } else {
      const gap = chunk.charStart - end;
      if (gap > 2) return null;
      text += "\n".repeat(gap) + chunk.text;
    }
    end = Math.max(end ?? chunk.charEnd, chunk.charEnd);
  }
  return text;
}
