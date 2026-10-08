import { randomUUID } from "node:crypto";

import type { RetrievalObserver, RetrievalStep } from "../../src/lib/knowledge/retrieval-core.ts";

import { checksumOf } from "./checksum.ts";

/**
 * Measurable performance exit criteria (docs/08b §12, §17 pkt. 10; 8B-I7).
 *
 * An evaluation run in the evaluation environment measures every step of every case (the
 * observe hook of runRetrieval) and the provisioning measures ingestion. The measurement:
 *
 *   * holds the raw samples (milliseconds, whole numbers), so the database recomputes the
 *     percentiles itself (knowledge.performance_results — the same nearest-rank formula);
 *   * compares them with the versioned targets of §12 (PERFORMANCE_TARGETS);
 *   * is registered by evaluation_publisher with the configuration's fingerprint and the
 *     evaluation run it came from (knowledge.record_performance_measurement);
 *   * marks every target that is not met — or not measured — as a deviation. A deviation needs a
 *     documented human approval (knowledge.accept_performance_deviation).
 *
 * Measured in the evaluation environment: the network path to the providers and the database
 * differs from production, which §12 says is measured "i drift" as well (the retrieval log line).
 */

export const PERFORMANCE_SCHEMA_VERSION = 1;
export const PERFORMANCE_TARGETS_VERSION = "performance-targets-v1";

/** §12, in the same order as knowledge.performance_targets('performance-targets-v1'). Limits are ≤. */
export const PERFORMANCE_TARGETS = Object.freeze([
  { target: "retrieval_total_p50", limit: 800 },
  { target: "retrieval_total_p95", limit: 1500 },
  { target: "query_embedding_p95", limit: 300 },
  { target: "search_p95", limit: 300 },
  { target: "rerank_p95", limit: 500 },
  { target: "ingestion_50_pages_seconds", limit: 300 },
  { target: "ingestion_corpus_2000_pages_seconds", limit: 14400 },
] as const);

export type PerformanceTarget = (typeof PERFORMANCE_TARGETS)[number]["target"];

export interface RetrievalSamples {
  total: number[];
  queryEmbedding: number[];
  search: number[];
  rerank: number[];
}

export interface IngestionSamples {
  /** One entry per processed document version: its pages and seconds from upload to processed. */
  documents: { pages: number; seconds: number }[];
  /** Pages of the whole corpus, and the time to process it (null when it was not measured as a whole). */
  corpusPages: number;
  corpusSeconds: number | null;
}

export interface PerformanceResult {
  target: PerformanceTarget;
  limit: number;
  value: number | null;
  status: "met" | "not_met" | "not_measured";
}

export interface PerformanceMeasurement {
  schema: typeof PERFORMANCE_SCHEMA_VERSION;
  kind: "retrieval-performance";
  measurementId: string;
  /** The evaluation run the retrieval samples come from (EvaluationReport.runId). */
  runId: string;
  measuredAt: string;
  environment: "evaluation" | "fixture";
  /** The runtime fingerprint of the evaluated configuration. */
  configurationFingerprint: string;
  targets: typeof PERFORMANCE_TARGETS_VERSION;
  retrieval: RetrievalSamples;
  ingestion: IngestionSamples;
  results: PerformanceResult[];
  checksum: string;
}

/** Nearest rank with whole numbers: k = ceil(p·n/100); the k-th smallest. Null without samples. */
export function nearestRank(samples: readonly number[], percent: number): number | null {
  if (samples.length === 0) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  const rank = Math.floor((percent * sorted.length + 99) / 100);
  return sorted[rank - 1] ?? null;
}

export function performanceResults(retrieval: RetrievalSamples, ingestion: IngestionSamples): PerformanceResult[] {
  const big = ingestion.documents.filter((document) => document.pages >= 50).map((document) => document.seconds);
  const values: Record<PerformanceTarget, number | null> = {
    retrieval_total_p50: nearestRank(retrieval.total, 50),
    retrieval_total_p95: nearestRank(retrieval.total, 95),
    query_embedding_p95: nearestRank(retrieval.queryEmbedding, 95),
    search_p95: nearestRank(retrieval.search, 95),
    rerank_p95: nearestRank(retrieval.rerank, 95),
    ingestion_50_pages_seconds: big.length > 0 ? Math.max(...big) : null,
    ingestion_corpus_2000_pages_seconds: ingestion.corpusPages >= 2000 ? ingestion.corpusSeconds : null,
  };
  return PERFORMANCE_TARGETS.map(({ target, limit }) => {
    const value = values[target];
    return { target, limit, value, status: value === null ? "not_measured" : value <= limit ? "met" : "not_met" };
  });
}

/** Collects the retrieval samples of successful steps (rounded to whole milliseconds). */
export interface PerformanceRecorder {
  observer: RetrievalObserver;
  samples(): RetrievalSamples;
}

const STEP_KEY: Record<RetrievalStep, keyof RetrievalSamples> = { total: "total", query_embedding: "queryEmbedding", search: "search", rerank: "rerank" };

export function createPerformanceRecorder(): PerformanceRecorder {
  const samples: RetrievalSamples = { total: [], queryEmbedding: [], search: [], rerank: [] };
  return {
    observer(step, milliseconds, ok) {
      if (ok && Number.isFinite(milliseconds)) samples[STEP_KEY[step]].push(Math.max(0, Math.round(milliseconds)));
    },
    samples: () => ({ total: [...samples.total], queryEmbedding: [...samples.queryEmbedding], search: [...samples.search], rerank: [...samples.rerank] }),
  };
}

export function buildPerformanceMeasurement(input: {
  runId: string;
  configurationFingerprint: string;
  environment: "evaluation" | "fixture";
  retrieval: RetrievalSamples;
  ingestion: IngestionSamples;
  measuredAt?: string;
  measurementId?: string;
}): PerformanceMeasurement {
  const body: Omit<PerformanceMeasurement, "checksum"> = {
    schema: PERFORMANCE_SCHEMA_VERSION,
    kind: "retrieval-performance",
    measurementId: input.measurementId ?? randomUUID(),
    runId: input.runId,
    measuredAt: input.measuredAt ?? new Date().toISOString(),
    environment: input.environment,
    configurationFingerprint: input.configurationFingerprint,
    targets: PERFORMANCE_TARGETS_VERSION,
    retrieval: input.retrieval,
    ingestion: input.ingestion,
    results: performanceResults(input.retrieval, input.ingestion),
  };
  return { ...body, checksum: checksumOf(body) };
}

/** Recomputes a measurement from its samples. Problems are listed; none means it is consistent. */
export function verifyPerformanceMeasurement(measurement: PerformanceMeasurement): string[] {
  const problems: string[] = [];
  const { checksum, ...body } = measurement;
  if (checksumOf(body) !== checksum) problems.push("Målingens checksum stemmer ikke.");
  if (measurement.targets !== PERFORMANCE_TARGETS_VERSION) problems.push("Ukendt version af performance-målene.");
  if (JSON.stringify(performanceResults(measurement.retrieval, measurement.ingestion)) !== JSON.stringify(measurement.results)) {
    problems.push("Resultaterne stemmer ikke med målingerne.");
  }
  if (measurement.environment !== "evaluation") problems.push("Kun målinger fra evalueringsmiljøet kan registreres.");
  return problems;
}

/** The targets not met or not measured — each needs a documented approval (§17 pkt. 10). */
export function performanceDeviations(measurement: Pick<PerformanceMeasurement, "results">): PerformanceTarget[] {
  return measurement.results.filter((result) => result.status !== "met").map((result) => result.target);
}
