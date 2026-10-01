import { isDocumentTypeKey } from "./document-types";
import type { Embedder } from "./core/embedding";
import {
  issueEvidenceSet,
  RESTRICTED_CONFLICT_MESSAGE,
  sourceReferenceLabel,
  type EvidenceConflict,
  type EvidenceItem,
  type EvidenceSet,
  type RetrievalMode,
  type TemporalStatus,
} from "./core/evidence";
import { DEFAULT_RRF_K, fuse } from "./core/fusion";
import type { RankReason, Reranker } from "./core/reranker";
import { mergeExcerpt, selectChunks, type SelectableChunk } from "./core/selection";
import { isUuid } from "./upload-validation";

/**
 * The retrieval pipeline (docs/07 §8): permission and metadata filtering and hybrid search in
 * the database (knowledge.search_chunks, security invoker, stable → read-only), then RRF
 * fusion, reranking, evidence selection and the EvidenceSet.
 *
 * This module takes its database client and implementations as parameters so it can be
 * tested. Application code calls retrieveEvidence (retrieval.ts), which always takes the
 * embedder and reranker from the fail-closed registry and runs as the signed-in user.
 *
 * Nothing here stores or logs the query (docs/07 §12.1, §13).
 */

export const MAX_QUERY_CHARS = 1000;

export interface RetrievalRequest {
  query: string;
  mode?: RetrievalMode;
  /** YYYY-MM-DD, required for `as_of`. */
  asOf?: string;
  language?: string;
  productIds?: string[];
  documentIds?: string[];
  documentTypes?: string[];
  topK?: number;
}

export interface RetrievalConfig {
  /** Candidates per retriever (vector, lexical). */
  candidateK: number;
  /** Fused candidates passed to the reranker. */
  rerankN: number;
  /** Evidence chunks returned at most (before neighbours are merged). */
  topK: number;
  maxPerVersion: number;
  minScore: number;
  rrfK: number;
}

/** Configuration, not locked (docs/07 §9). */
export const DEFAULT_RETRIEVAL_CONFIG: RetrievalConfig = Object.freeze({
  candidateK: 50,
  rerankN: 30,
  topK: 8,
  maxPerVersion: 3,
  minScore: 0.1,
  rrfK: DEFAULT_RRF_K,
});

export const MAX_TOP_K = 20;

export type RetrievalErrorCode = "invalid_request" | "denied" | "unavailable";

export class RetrievalError extends Error {
  readonly code: RetrievalErrorCode;
  constructor(code: RetrievalErrorCode, message: string) {
    super(message);
    this.name = "RetrievalError";
    this.code = code;
  }
}

/** The subset of a Supabase client (schema "knowledge") the pipeline needs. */
export interface KnowledgeRpcClient {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { code?: string; message: string } | null }>;
}

export interface RetrievalDeps {
  db: KnowledgeRpcClient;
  /** The embedder of the ACTIVE model and that model's id, or null when no model is active. */
  embedding: { embedder: Embedder; modelId: string } | null;
  reranker: Reranker;
  config?: RetrievalConfig;
  now?: () => Date;
}

/** One row of knowledge.search_chunks. */
export interface SearchRow {
  chunk_id: string;
  chunk_index: number;
  kind: string;
  text: string;
  lead_in: string | null;
  heading: string | null;
  heading_path: string[];
  section_number: string | null;
  page_start: number;
  page_end: number;
  char_start: number;
  char_end: number;
  overlap_chars: number;
  version_id: string;
  version_label: string | null;
  language: string;
  valid_from: string | null;
  valid_to: string | null;
  approved_at: string | null;
  superseded_by: string | null;
  document_id: string;
  document_title: string;
  document_type: string;
  product_id: string;
  product_name: string;
  source_type: string;
  temporal_status: TemporalStatus;
  vector_rank: number | null;
  vector_score: number | null;
  lexical_rank: number | null;
  lexical_score: number | null;
  lexical_terms: string[];
}

interface NormalizedRequest {
  query: string;
  mode: RetrievalMode;
  asOf: string | null;
  language: string;
  productIds: string[] | null;
  documentIds: string[] | null;
  documentTypes: string[] | null;
  topK: number;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function isDate(value: string): boolean {
  if (!DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Validates the request. Only known fields are read — anything else (e.g. a "grade") is ignored. */
export function normalizeRequest(request: RetrievalRequest, config: RetrievalConfig = DEFAULT_RETRIEVAL_CONFIG): NormalizedRequest {
  const query = (request.query ?? "").trim();
  if (query.length === 0) throw new RetrievalError("invalid_request", "Skriv en forespørgsel.");
  if (query.length > MAX_QUERY_CHARS) throw new RetrievalError("invalid_request", `Forespørgslen må højst være ${MAX_QUERY_CHARS} tegn.`);
  const mode = request.mode ?? "current";
  if (mode !== "current" && mode !== "as_of") throw new RetrievalError("invalid_request", "Ukendt tilstand.");
  let asOf: string | null = null;
  if (mode === "as_of") {
    if (!request.asOf || !isDate(request.asOf)) throw new RetrievalError("invalid_request", "Vælg en gyldig dato.");
    asOf = request.asOf;
  }
  const language = request.language ?? "da";
  if (!/^[a-z]{2}$/.test(language)) throw new RetrievalError("invalid_request", "Ukendt sprog.");
  const ids = (values: string[] | undefined, label: string) => {
    if (values === undefined || values.length === 0) return null;
    if (values.length > 100 || !values.every(isUuid)) throw new RetrievalError("invalid_request", `Ugyldigt filter: ${label}.`);
    return [...new Set(values)];
  };
  const types = request.documentTypes?.length ? [...new Set(request.documentTypes)] : null;
  if (types && !types.every(isDocumentTypeKey)) {
    throw new RetrievalError("invalid_request", "Ugyldigt filter: dokumenttype.");
  }
  const topK = Math.min(MAX_TOP_K, Math.max(1, Math.floor(request.topK ?? config.topK)));
  return { query, mode, asOf, language, productIds: ids(request.productIds, "produkt"), documentIds: ids(request.documentIds, "dokument"), documentTypes: types, topK };
}

/** Today's date in Danish time — the date the database uses for `current` (docs/07 §3.4). */
export function danishDate(now: Date): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Copenhagen" }).format(now);
}

export async function runRetrieval(request: RetrievalRequest, deps: RetrievalDeps): Promise<EvidenceSet> {
  const config = deps.config ?? DEFAULT_RETRIEVAL_CONFIG;
  const now = (deps.now ?? (() => new Date()))();
  const normalized = normalizeRequest(request, config);

  const queryEmbedding = deps.embedding ? (await deps.embedding.embedder.embed([normalized.query]))[0] : null;
  if (deps.embedding && (!queryEmbedding || queryEmbedding.length !== deps.embedding.embedder.dimensions)) {
    throw new RetrievalError("unavailable", "Forespørgslen kunne ikke embeddes.");
  }

  const date = normalized.asOf ?? danishDate(now);
  const search = (documentIds: string[] | null, candidateK: number) =>
    rpcRows<SearchRow>(deps.db, "search_chunks", {
      p_query: normalized.query,
      p_query_embedding: queryEmbedding ? `[${queryEmbedding.join(",")}]` : null,
      p_model_id: deps.embedding?.modelId ?? null,
      p_mode: normalized.mode,
      p_as_of: normalized.asOf,
      p_language: normalized.language,
      p_product_ids: documentIds ? null : normalized.productIds,
      p_document_ids: documentIds ?? normalized.documentIds,
      p_document_types: documentIds ? null : normalized.documentTypes,
      p_candidate_k: candidateK,
    });
  const rows = await search(null, config.candidateK);

  const fused = fuse(
    rows.map((row) => ({ ...row, chunkId: row.chunk_id, vectorRank: row.vector_rank, lexicalRank: row.lexical_rank })),
    config.rrfK,
  );
  const reranked = await deps.reranker.rerank({
    query: normalized.query,
    topN: config.rerankN,
    candidates: fused.slice(0, config.rerankN).map((row) => ({
      chunkId: row.chunk_id,
      text: row.text,
      headingPath: row.heading_path,
      retrieval: {
        ...(row.vector_rank !== null ? { vectorRank: row.vector_rank } : {}),
        ...(row.lexical_rank !== null ? { lexicalRank: row.lexical_rank } : {}),
        ...(row.vector_score !== null ? { vectorScore: row.vector_score } : {}),
        ...(row.lexical_score !== null ? { lexicalScore: row.lexical_score } : {}),
        fusedScore: row.fusedScore,
      },
    })),
  });

  const byId = new Map(fused.map((row) => [row.chunk_id, row]));
  const ranked: RankedChunk[] = reranked.ranked.flatMap((entry) => {
    const row = byId.get(entry.chunkId);
    if (!row) return []; // A reranker can only reorder the candidates it was given.
    return [{
      row,
      chunkId: row.chunk_id,
      versionId: row.version_id,
      chunkIndex: row.chunk_index,
      headingPath: row.heading_path,
      text: row.text,
      charStart: row.char_start,
      charEnd: row.char_end,
      score: Math.min(1, Math.max(0, entry.score)),
      rank: entry.rank,
      reasons: entry.reasons,
    }];
  });
  const rankedById = new Map(ranked.map((chunk) => [chunk.chunkId, chunk]));

  const drafts: Draft[] = selectChunks(ranked, { topK: normalized.topK, maxPerVersion: config.maxPerVersion, minScore: config.minScore }).map(
    (group) => ({ chunks: group, links: new Map(), restricted: false }),
  );

  await attachConflicts(drafts, {
    date,
    conflicts: (chunkIds) => rpcRows<ConflictRow>(deps.db, "evidence_conflicts", { p_chunk_ids: chunkIds, p_date: date }),
    chunks: (chunkIds, versionIds) => rpcRows<SearchRow>(deps.db, "evidence_chunks", { p_chunk_ids: chunkIds, p_version_ids: versionIds, p_date: date }),
    bestOfDocument: async (documentId, versionId) =>
      (await search([documentId], CONFLICT_SEARCH_K)).find((row) => row.version_id === versionId) ?? null,
    counterpart: (row) => rankedById.get(row.chunk_id) ?? counterpartChunk(row),
  });

  const items = drafts.map((draft, i) => toItem(draft, i, drafts));

  return issueEvidenceSet({
    query: {
      text: normalized.query,
      mode: normalized.mode,
      asOf: date,
      language: normalized.language,
      filters: {
        ...(normalized.productIds ? { productIds: normalized.productIds } : {}),
        ...(normalized.documentIds ? { documentIds: normalized.documentIds } : {}),
        ...(normalized.documentTypes ? { documentTypes: normalized.documentTypes } : {}),
      },
    },
    embedder: deps.embedding?.embedder ?? null,
    reranker: deps.reranker,
    candidateCount: rows.length,
    generatedAt: now.toISOString(),
    items,
  });
}

async function rpcRows<T>(db: KnowledgeRpcClient, fn: string, args: Record<string, unknown>): Promise<T[]> {
  const { data, error } = await db.rpc(fn, args);
  if (error) {
    if (error.code === "42501") throw new RetrievalError("denied", "Du har ikke adgang til vidensgrundlaget.");
    if (error.code === "22023") throw new RetrievalError("invalid_request", error.message);
    throw new RetrievalError("unavailable", "Søgningen kunne ikke gennemføres. Prøv igen.");
  }
  return (data ?? []) as T[];
}

type ScoredRow = SearchRow & { fusedScore: number };

interface RankedChunk extends SelectableChunk {
  row: ScoredRow;
  reasons: RankReason[];
}

/** One evidence item in the making: its chunks, its conflict links (by draft) and the neutral indicator. */
interface Draft {
  chunks: RankedChunk[];
  /** counterpart draft → conflict ids */
  links: Map<Draft, Set<string>>;
  restricted: boolean;
}

/** One row of knowledge.evidence_conflicts. For a restricted counterpart everything but `restricted` is null. */
export interface ConflictRow {
  chunk_id: string;
  restricted: boolean;
  conflict_id: string | null;
  counterpart_document_id: string | null;
  counterpart_version_id: string | null;
  counterpart_chunk_id: string | null;
}

/** Candidates searched in a counterpart document when the conflict is on version level. */
const CONFLICT_SEARCH_K = 10;
/** Rounds of fetching counterparts of counterparts before giving up (fail closed, never hide). */
const MAX_CONFLICT_ROUNDS = 10;

/** A counterpart that was not among the ranked candidates: no score, it is evidence because of the conflict. */
function counterpartChunk(row: SearchRow): RankedChunk {
  return {
    row: { ...row, fusedScore: 0 },
    chunkId: row.chunk_id,
    versionId: row.version_id,
    chunkIndex: row.chunk_index,
    headingPath: row.heading_path,
    text: row.text,
    charStart: row.char_start,
    charEnd: row.char_end,
    score: 0,
    rank: Number.MAX_SAFE_INTEGER,
    reasons: [],
  };
}

interface ConflictSources {
  date: string;
  conflicts(chunkIds: string[]): Promise<ConflictRow[]>;
  chunks(chunkIds: string[], versionIds: string[]): Promise<SearchRow[]>;
  bestOfDocument(documentId: string, versionId: string): Promise<SearchRow | null>;
  counterpart(row: SearchRow): RankedChunk;
}

/**
 * Conflicts in retrieval (docs/07 §11.4). A selected chunk in an open conflict is marked. An
 * accessible counterpart is fetched as its own evidence item even if it did not score — and
 * so on for the counterparts' own conflicts, until nothing new is found. An inaccessible
 * counterpart yields only the database's boolean, shown as ONE neutral indicator per item.
 */
async function attachConflicts(drafts: Draft[], sources: ConflictSources): Promise<void> {
  const checked = new Set<string>();
  const byChunk = () => new Map(drafts.flatMap((draft) => draft.chunks.map((chunk) => [chunk.chunkId, draft] as const)));
  const byVersion = () => {
    const map = new Map<string, Draft>();
    for (const draft of drafts) if (!map.has(draft.chunks[0]!.versionId)) map.set(draft.chunks[0]!.versionId, draft);
    return map;
  };
  const link = (a: Draft, b: Draft, conflictId: string) => {
    for (const [from, to] of [[a, b], [b, a]] as const) {
      const ids = from.links.get(to) ?? new Set<string>();
      ids.add(conflictId);
      from.links.set(to, ids);
    }
  };

  for (let round = 0; ; round += 1) {
    const pending = drafts.flatMap((draft) => draft.chunks.map((chunk) => chunk.chunkId)).filter((id) => !checked.has(id));
    if (pending.length === 0) return;
    if (round >= MAX_CONFLICT_ROUNDS) throw new RetrievalError("unavailable", "Konflikterne kunne ikke samles. Prøv igen.");
    for (const id of pending) checked.add(id);

    const rows = await sources.conflicts(pending);
    const chunkDrafts = byChunk();
    const missing: ConflictRow[] = [];
    for (const row of rows) {
      const draft = chunkDrafts.get(row.chunk_id);
      if (!draft) continue;
      if (row.restricted) {
        draft.restricted = true;
        continue;
      }
      const target = row.counterpart_chunk_id ? chunkDrafts.get(row.counterpart_chunk_id) : byVersion().get(row.counterpart_version_id!);
      if (target) link(draft, target, row.conflict_id!);
      else missing.push(row);
    }
    if (missing.length === 0) continue;

    // Fetch the missing counterparts: named chunks directly; on version level the counterpart
    // document's best passage for the same query, else its first chunk.
    const fetched: SearchRow[] = [];
    const chunkIds = [...new Set(missing.flatMap((row) => (row.counterpart_chunk_id ? [row.counterpart_chunk_id] : [])))];
    const versionIds: string[] = [];
    for (const row of missing.filter((entry) => !entry.counterpart_chunk_id)) {
      if (fetched.some((entry) => entry.version_id === row.counterpart_version_id) || versionIds.includes(row.counterpart_version_id!)) continue;
      const best = await sources.bestOfDocument(row.counterpart_document_id!, row.counterpart_version_id!);
      if (best) fetched.push(best);
      else versionIds.push(row.counterpart_version_id!);
    }
    if (chunkIds.length > 0 || versionIds.length > 0) fetched.push(...(await sources.chunks(chunkIds, versionIds)));

    const known = byChunk();
    for (const row of fetched) {
      if (known.has(row.chunk_id)) continue;
      const draft: Draft = { chunks: [sources.counterpart(row)], links: new Map(), restricted: false };
      drafts.push(draft);
      known.set(row.chunk_id, draft);
    }
    const versions = byVersion();
    for (const row of missing) {
      const target = row.counterpart_chunk_id ? known.get(row.counterpart_chunk_id) : versions.get(row.counterpart_version_id!);
      // Not fetched: the counterpart is no longer readable or valid — the next round re-checks it.
      if (target) link(known.get(row.chunk_id)!, target, row.conflict_id!);
    }
  }
}

function toItem(draft: Draft, index: number, drafts: Draft[]): EvidenceItem {
  const group = draft.chunks;
  const first = group[0]!.row;
  const best = group.reduce((top, chunk) => (chunk.score > top.score ? chunk : top));
  const terms = [...new Set(group.flatMap((chunk) => chunk.row.lexical_terms))].sort();
  const vectorScores = group.map((chunk) => chunk.row.vector_score).filter((score): score is number => score !== null);
  const lexicalScores = group.map((chunk) => chunk.row.lexical_score).filter((score): score is number => score !== null);
  const reasons: RankReason[] = [
    ...(terms.length > 0 ? [{ kind: "lexical_match" as const, terms }] : []),
    ...(vectorScores.length > 0 ? [{ kind: "vector_similarity" as const, score: round(Math.max(...vectorScores)) }] : []),
    ...best.reasons,
  ];
  const pageStart = Math.min(...group.map((chunk) => chunk.row.page_start));
  const pageEnd = Math.max(...group.map((chunk) => chunk.row.page_end));
  const conflicts: EvidenceConflict[] = [...draft.links.entries()]
    .flatMap(([target, ids]) => [...ids].sort().map((conflictId) => ({ conflictId, counterpart: drafts.indexOf(target) })))
    .sort((a, b) => a.counterpart - b.counterpart || (a.conflictId < b.conflictId ? -1 : 1))
    .map(({ conflictId, counterpart }) => ({ visibility: "visible" as const, conflictId, status: "open" as const, counterpartEvidenceId: `e${counterpart + 1}` }));
  if (draft.restricted) conflicts.push({ visibility: "restricted", message: RESTRICTED_CONFLICT_MESSAGE });
  return {
    evidenceId: `e${index + 1}`,
    documentId: first.document_id,
    documentVersionId: first.version_id,
    chunkId: first.chunk_id,
    chunkIds: group.map((chunk) => chunk.chunkId),
    chunkIndex: first.chunk_index,
    product: { id: first.product_id, name: first.product_name },
    document: { title: first.document_title, type: first.document_type, versionLabel: first.version_label, language: first.language },
    location: { pageStart, pageEnd, sectionNumber: first.section_number, heading: first.heading, headingPath: first.heading_path },
    excerpt: { text: mergeExcerpt(group.map(({ row }) => ({ text: row.text, charStart: row.char_start, charEnd: row.char_end }))) ?? first.text, leadIn: first.lead_in },
    validity: { validFrom: first.valid_from, validTo: first.valid_to, temporalStatus: first.temporal_status },
    authority: { status: "published", authoritative: true, approvedAt: first.approved_at, supersededBy: first.superseded_by, withdrawn: false },
    relevance: {
      score: round(best.score),
      rank: index + 1,
      fusedScore: round(Math.max(...group.map((chunk) => chunk.row.fusedScore))),
      vectorScore: vectorScores.length > 0 ? round(Math.max(...vectorScores)) : null,
      lexicalScore: lexicalScores.length > 0 ? round(Math.max(...lexicalScores)) : null,
      reasons,
    },
    conflicts,
    sourceReference: {
      label: sourceReferenceLabel({ title: first.document_title, versionLabel: first.version_label, sectionNumber: first.section_number, heading: first.heading, pageStart, pageEnd }),
      sourceType: first.source_type,
    },
  };
}

function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}
