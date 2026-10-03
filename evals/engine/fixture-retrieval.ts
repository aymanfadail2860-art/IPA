import { createHash } from "node:crypto";

import { syntheticText } from "../../src/lib/egress/synthetic.ts";
import { embeddingInput, type EmbeddingProvider } from "../../src/lib/knowledge/core/embedding.ts";
import { retrievalFingerprintMaterial } from "../../src/lib/knowledge/core/provider.ts";
import type { RerankingProvider } from "../../src/lib/knowledge/core/reranker.ts";
import { tokenize } from "../../src/lib/knowledge/core/test-embedder.ts";
import {
  DEFAULT_RETRIEVAL_CONFIG,
  RETRIEVAL_ALGORITHM_VERSION,
  runRetrieval,
  type ConflictRow,
  type KnowledgeRpcClient,
  type RetrievalConfig,
  type SearchRow,
} from "../../src/lib/knowledge/retrieval-core.ts";

import { checksumOf } from "./checksum.ts";
import { danishDateOf, versionValidOn } from "./observe.ts";
import type { ConfigurationInput, CorpusBinding, EvalCase, Manifest, ManifestDocument, RetrievalRun, RetrievalUnderTest } from "./types.ts";

/**
 * ⚠ FIXTURE RETRIEVAL — DEVELOPMENT ONLY (8B-I1).
 *
 * Runs the REAL retrieval pipeline (`runRetrieval`: fusion, reranking, evidence selection,
 * conflicts, the EvidenceSet) over a small fictional corpus held in memory. The database
 * (`knowledge.search_chunks`, `evidence_conflicts`, `evidence_chunks`) is emulated: the
 * emulation applies the manifest's grants, validity and filters the way the SQL functions do.
 *
 * It exists so the evaluation engine can run end to end before the evaluation environment and
 * production providers exist. It uses the development implementations from the registry, its
 * environment is "fixture" (H7) and its evidence is development grade (H6) — so a fixture run
 * can never pass, and can never make anything production grade.
 *
 * The evaluation environment adapter (a separate Supabase project, docs/08b §4.5) replaces it in
 * a later step of 8B.
 */

export const FIXTURE_CHUNKER_VERSION = "fixture-sections/1";

export interface FixtureDocument {
  schema: 1;
  document: string;
  fictional: true;
  notice: string;
  versions: Record<string, { sections: { heading: string; text: string }[] }>;
}

export interface FixtureRetrievalOptions {
  manifest: Manifest;
  /** Fixture files by the path the manifest names. */
  fixtures: Record<string, FixtureDocument>;
  /** Any declared provider: the development ones, or (with credentials) the production ones (8B-I2). */
  embedder: EmbeddingProvider;
  /** The configured reranker, and a reranker that keeps the fusion order (for Q7). */
  reranker: RerankingProvider;
  baselineReranker: RerankingProvider;
  config?: RetrievalConfig;
  now: () => Date;
}

interface FixtureChunk {
  id: string;
  document: ManifestDocument;
  version: string;
  versionId: string;
  index: number;
  heading: string;
  text: string;
  charStart: number;
  charEnd: number;
}

/** A stable UUID (v4 layout) derived from a name, so ids are reproducible between runs. */
export function fixtureUuid(name: string): string {
  const hex = createHash("sha256").update(`ipa-eval-fixture:${name}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${((parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16)}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function cosine(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i += 1) dot += a[i]! * b[i]!;
  return dot; // Both vectors are L2-normalized by the embedder.
}

export function createFixtureRetrieval(options: FixtureRetrievalOptions): RetrievalUnderTest {
  const { manifest, fixtures } = options;
  const config = options.config ?? DEFAULT_RETRIEVAL_CONFIG;

  const binding: CorpusBinding = {
    products: Object.fromEntries(manifest.products.map((product) => [product.key, fixtureUuid(`product:${product.key}`)])),
    documents: Object.fromEntries(
      manifest.documents.map((document) => [
        document.key,
        {
          documentId: fixtureUuid(`document:${document.key}`),
          title: document.title,
          versions: Object.fromEntries(document.versions.map((version) => [version.label, fixtureUuid(`version:${document.key}:${version.label}`)])),
        },
      ]),
    ),
    conflicts: Object.fromEntries(manifest.conflicts.map((conflict) => [conflict.id, fixtureUuid(`conflict:${conflict.id}`)])),
  };

  const texts = new Map<string, string>();
  const chunks: FixtureChunk[] = [];
  for (const document of manifest.documents) {
    if (document.source.kind !== "fixture") throw new Error(`${document.key}: fixture-retrieval kan kun bruge fiktive fixtures.`);
    const fixture = fixtures[document.source.path];
    if (!fixture || fixture.document !== document.key || fixture.fictional !== true) throw new Error(`${document.key}: fixture-filen ${document.source.path} mangler eller passer ikke.`);
    for (const version of document.versions) {
      const sections = fixture.versions[version.label]?.sections;
      if (!sections) throw new Error(`${document.key}: fixture-filen har ingen tekst til version ${version.label}.`);
      let text = "";
      sections.forEach((section, index) => {
        const prefix = `${text.length > 0 ? "\n\n" : ""}${section.heading}\n`;
        const charStart = text.length + prefix.length;
        text += prefix + section.text;
        chunks.push({
          id: fixtureUuid(`chunk:${document.key}:${version.label}:${index}`),
          document,
          version: version.label,
          versionId: binding.documents[document.key]!.versions[version.label]!,
          index,
          heading: section.heading,
          text: section.text,
          charStart,
          charEnd: charStart + section.text.length,
        });
      });
      texts.set(`${document.key}\u0000${version.label}`, text);
    }
  }
  const corpusChecksum = checksumOf({ manifest: manifest.documents, chunks: chunks.map((chunk) => [chunk.id, chunk.text]) });
  const chunkerVersions = Object.fromEntries(chunks.map((chunk) => [chunk.id, FIXTURE_CHUNKER_VERSION]));
  const modelId = fixtureUuid("embedding-model:active");
  let embeddings: Map<string, number[]> | null = null;

  async function embedCorpus(): Promise<Map<string, number[]>> {
    if (!embeddings) {
      const vectors = await options.embedder.embed(
        // The fixture corpus is synthetic evaluation material (8B-I2.5).
        chunks.map((chunk) => syntheticText(embeddingInput({ text: chunk.text, lead_in: null, heading_path: [chunk.heading] }))),
        { inputType: "document" },
      );
      embeddings = new Map(chunks.map((chunk, i) => [chunk.id, vectors[i]!]));
    }
    return embeddings;
  }

  /** The fingerprint material comes from what the implementations declare (8B-I2). */
  function configuration(reranker: RerankingProvider): ConfigurationInput {
    return retrievalFingerprintMaterial({
      embedding: options.embedder.descriptor,
      reranker: reranker.descriptor,
      algorithmVersion: RETRIEVAL_ALGORITHM_VERSION,
      params: { ...config },
      chunkerVersions: [FIXTURE_CHUNKER_VERSION],
    });
  }

  /** The emulated database for one evaluation identity. */
  function database(actorId: string, vectors: Map<string, number[]>, log: unknown[]): KnowledgeRpcClient {
    const actor = manifest.actors.find((entry) => entry.id === actorId);
    if (!actor) throw new Error(`Ukendt evalueringsbruger: ${actorId}.`);
    const grants = new Map(actor.grants.map((grant) => [grant.document, grant]));
    const today = danishDateOf(options.now().toISOString());

    // knowledge.can_read_version(v, 'any')
    const canRead = (document: ManifestDocument, label: string) => {
      const grant = grants.get(document.key);
      const version = document.versions.find((entry) => entry.label === label)!;
      if (!grant || version.status !== "published") return false;
      if (version.validTo !== null && version.validTo <= today) return grant.historical;
      return true;
    };
    const temporal = (document: ManifestDocument, label: string): SearchRow["temporal_status"] => {
      const version = document.versions.find((entry) => entry.label === label)!;
      if (version.validTo !== null && version.validTo <= today) return "historical";
      return version.validFrom !== null && version.validFrom > today ? "future" : "current";
    };
    const row = (chunk: FixtureChunk, ranks: Partial<Pick<SearchRow, "vector_rank" | "vector_score" | "lexical_rank" | "lexical_score" | "lexical_terms">> = {}): SearchRow => {
      const version = chunk.document.versions.find((entry) => entry.label === chunk.version)!;
      return {
        chunk_id: chunk.id,
        chunk_index: chunk.index,
        kind: "prose",
        text: chunk.text,
        lead_in: null,
        heading: chunk.heading,
        heading_path: [chunk.heading],
        section_number: null,
        page_start: 1,
        page_end: 1,
        char_start: chunk.charStart,
        char_end: chunk.charEnd,
        overlap_chars: 0,
        version_id: chunk.versionId,
        version_label: chunk.version,
        language: chunk.document.language,
        valid_from: version.validFrom,
        valid_to: version.validTo,
        approved_at: "2026-01-01T00:00:00Z",
        superseded_by: null,
        document_id: binding.documents[chunk.document.key]!.documentId,
        document_title: chunk.document.title,
        document_type: chunk.document.type,
        product_id: binding.products[chunk.document.product]!,
        product_name: manifest.products.find((product) => product.key === chunk.document.product)!.name,
        source_type: "manual_upload",
        temporal_status: temporal(chunk.document, chunk.version),
        vector_rank: ranks.vector_rank ?? null,
        vector_score: ranks.vector_score ?? null,
        lexical_rank: ranks.lexical_rank ?? null,
        lexical_score: ranks.lexical_score ?? null,
        lexical_terms: ranks.lexical_terms ?? [],
      };
    };

    function searchChunks(args: Record<string, unknown>): SearchRow[] {
      const date = args.p_mode === "as_of" ? (args.p_as_of as string) : today;
      const products = args.p_product_ids as string[] | null;
      const documentIds = args.p_document_ids as string[] | null;
      const types = args.p_document_types as string[] | null;
      const allowed = chunks.filter((chunk) => {
        const valid = versionValidOn(chunk.document.versions, date);
        return (
          valid?.label === chunk.version &&
          chunk.document.language === args.p_language &&
          (!products || products.includes(binding.products[chunk.document.product]!)) &&
          (!documentIds || documentIds.includes(binding.documents[chunk.document.key]!.documentId)) &&
          (!types || types.includes(chunk.document.type)) &&
          canRead(chunk.document, chunk.version)
        );
      });
      const k = args.p_candidate_k as number;
      const byId = new Map<string, Partial<SearchRow>>();
      const query = args.p_query_embedding ? (JSON.parse(args.p_query_embedding as string) as number[]) : null;
      if (query) {
        allowed
          .map((chunk) => ({ chunk, score: cosine(vectors.get(chunk.id)!, query) }))
          .sort((a, b) => b.score - a.score || (a.chunk.id < b.chunk.id ? -1 : 1))
          .slice(0, k)
          .forEach(({ chunk, score }, i) => byId.set(chunk.id, { vector_rank: i + 1, vector_score: score }));
      }
      const words = [...new Set(tokenize(args.p_query as string))];
      allowed
        .map((chunk) => {
          const tokens = new Set(tokenize(`${chunk.heading} ${chunk.text}`));
          const terms = words.filter((word) => tokens.has(word));
          return { chunk, terms, score: words.length === 0 ? 0 : terms.length / words.length };
        })
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score || (a.chunk.id < b.chunk.id ? -1 : 1))
        .slice(0, k)
        .forEach(({ chunk, terms, score }, i) => byId.set(chunk.id, { ...byId.get(chunk.id), lexical_rank: i + 1, lexical_score: score, lexical_terms: terms }));
      return allowed.filter((chunk) => byId.has(chunk.id)).map((chunk) => row(chunk, byId.get(chunk.id)));
    }

    function evidenceConflicts(args: Record<string, unknown>): ConflictRow[] {
      const date = args.p_date as string;
      const rows: ConflictRow[] = [];
      for (const chunkId of args.p_chunk_ids as string[]) {
        const chunk = chunks.find((entry) => entry.id === chunkId);
        if (!chunk) continue;
        for (const conflict of manifest.conflicts) {
          if (conflict.status !== "open" || !conflict.documents.includes(chunk.document.key)) continue;
          const counterpartKey = conflict.documents[0] === chunk.document.key ? conflict.documents[1] : conflict.documents[0];
          const counterpart = manifest.documents.find((document) => document.key === counterpartKey)!;
          const valid = versionValidOn(counterpart.versions, date);
          if (!valid) continue;
          if (canRead(counterpart, valid.label)) {
            rows.push({
              chunk_id: chunkId,
              restricted: false,
              conflict_id: binding.conflicts[conflict.id]!,
              counterpart_document_id: binding.documents[counterpart.key]!.documentId,
              counterpart_version_id: binding.documents[counterpart.key]!.versions[valid.label]!,
              counterpart_chunk_id: null,
            });
          } else {
            rows.push({ chunk_id: chunkId, restricted: true, conflict_id: null, counterpart_document_id: null, counterpart_version_id: null, counterpart_chunk_id: null });
          }
        }
      }
      return rows;
    }

    function evidenceChunks(args: Record<string, unknown>): SearchRow[] {
      const ids = (args.p_chunk_ids as string[] | null) ?? [];
      const versionIds = (args.p_version_ids as string[] | null) ?? [];
      return chunks
        .filter((chunk) => ids.includes(chunk.id) || (versionIds.includes(chunk.versionId) && chunk.index === 0))
        .filter((chunk) => canRead(chunk.document, chunk.version))
        .map((chunk) => row(chunk));
    }

    return {
      async rpc(fn, args) {
        const data = fn === "search_chunks" ? searchChunks(args) : fn === "evidence_conflicts" ? evidenceConflicts(args) : fn === "evidence_chunks" ? evidenceChunks(args) : null;
        if (data === null) return { data: null, error: { message: `Ukendt funktion: ${fn}` } };
        log.push({ fn, data });
        return { data, error: null };
      },
    };
  }

  function adapter(reranker: RerankingProvider, baseline: boolean): RetrievalUnderTest {
    return {
      name: baseline ? "fixture (uden reranker)" : "fixture",
      environment: "fixture",
      configuration: () => configuration(reranker),
      binding: () => binding,
      versionText: (document, version) => texts.get(`${document}\u0000${version}`) ?? null,
      corpusChecksum: () => corpusChecksum,
      async run(evalCase: EvalCase): Promise<RetrievalRun> {
        const vectors = await embedCorpus();
        const log: unknown[] = [];
        const filters = evalCase.filters ?? {};
        const set = await runRetrieval(
          {
            // An evaluation question is synthetic material, scanned for customer data (8B-I2.5).
            query: syntheticText(evalCase.question),
            mode: evalCase.mode,
            ...(evalCase.asOf ? { asOf: evalCase.asOf } : {}),
            language: evalCase.language,
            ...(filters.products ? { productIds: filters.products.map((key) => binding.products[key] ?? fixtureUuid(`unknown-product:${key}`)) } : {}),
            ...(filters.documents ? { documentIds: filters.documents.map((key) => binding.documents[key]?.documentId ?? fixtureUuid(`unknown-document:${key}`)) } : {}),
            ...(filters.documentTypes ? { documentTypes: filters.documentTypes } : {}),
          },
          {
            db: database(evalCase.actor, vectors, log),
            embedding: { embedder: options.embedder, modelId },
            reranker,
            config,
            now: options.now,
          },
        );
        return { actor: evalCase.actor, set, raw: log, chunkerVersions };
      },
      withoutReranker: () => (baseline ? null : adapter(options.baselineReranker, true)),
    };
  }

  return adapter(options.reranker, false);
}
