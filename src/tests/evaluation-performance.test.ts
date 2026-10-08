import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildPerformanceMeasurement,
  createPerformanceRecorder,
  nearestRank,
  PERFORMANCE_TARGETS,
  performanceDeviations,
  performanceResults,
  verifyPerformanceMeasurement,
  type IngestionSamples,
  type RetrievalSamples,
} from "../../evals/engine/performance.ts";

import { FIXTURE_PERFORMANCE } from "./fixtures/evaluation-performance";

/**
 * 8B-I7 — measurable performance exit criteria (docs/08b §12, §17 pkt. 10): nearest-rank p50/p95
 * per step from the raw samples, compared with the versioned targets, recomputed identically in
 * the database (knowledge.performance_results, pgTAP).
 */

const none: IngestionSamples = { documents: [], corpusPages: 0, corpusSeconds: null };
const samples = (total: number[], others: Partial<RetrievalSamples> = {}): RetrievalSamples => ({ total, queryEmbedding: [], search: [], rerank: [], ...others });

describe("nearest rank with whole numbers (the database's formula)", () => {
  it("k = ceil(p·n/100); null without samples; order does not matter", () => {
    expect(nearestRank([], 95)).toBeNull();
    expect(nearestRank([5], 95)).toBe(5);
    expect(nearestRank([3, 1, 2], 50)).toBe(2);
    expect(nearestRank([700, 750, 1700], 95)).toBe(1700);
    const hundred = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(nearestRank(hundred, 95)).toBe(95);
    expect(nearestRank(hundred, 50)).toBe(50);
    expect(nearestRank(Array.from({ length: 20 }, (_, i) => i + 1), 95)).toBe(19);
  });
});

describe("the targets of §12", () => {
  it("are versioned and exactly those of §12", () => {
    expect(PERFORMANCE_TARGETS).toEqual([
      { target: "retrieval_total_p50", limit: 800 },
      { target: "retrieval_total_p95", limit: 1500 },
      { target: "query_embedding_p95", limit: 300 },
      { target: "search_p95", limit: 300 },
      { target: "rerank_p95", limit: 500 },
      { target: "ingestion_50_pages_seconds", limit: 300 },
      { target: "ingestion_corpus_2000_pages_seconds", limit: 14400 },
    ]);
  });

  it("met at the limit, not met above it, not measured without samples — both are deviations", () => {
    const results = performanceResults(samples([800, 800], { search: [301] }), none);
    expect(results.find((r) => r.target === "retrieval_total_p50")).toMatchObject({ value: 800, status: "met" });
    expect(results.find((r) => r.target === "search_p95")).toMatchObject({ value: 301, status: "not_met" });
    expect(results.find((r) => r.target === "rerank_p95")).toMatchObject({ value: null, status: "not_measured" });
    expect(performanceDeviations({ results })).toEqual(["search_p95", "query_embedding_p95", "rerank_p95", "ingestion_50_pages_seconds", "ingestion_corpus_2000_pages_seconds"].sort((a, b) =>
      PERFORMANCE_TARGETS.findIndex((t) => t.target === a) - PERFORMANCE_TARGETS.findIndex((t) => t.target === b)));
  });

  it("ingestion: only documents of 50 pages or more count; the corpus target needs 2,000 pages", () => {
    const small: IngestionSamples = { documents: [{ pages: 10, seconds: 900 }], corpusPages: 10, corpusSeconds: 900 };
    expect(performanceResults(samples([1]), small).find((r) => r.target === "ingestion_50_pages_seconds")?.status).toBe("not_measured");
    const big: IngestionSamples = { documents: [{ pages: 50, seconds: 280 }, { pages: 70, seconds: 320 }], corpusPages: 2100, corpusSeconds: 14000 };
    const results = performanceResults(samples([1]), big);
    expect(results.find((r) => r.target === "ingestion_50_pages_seconds")).toMatchObject({ value: 320, status: "not_met" });
    expect(results.find((r) => r.target === "ingestion_corpus_2000_pages_seconds")).toMatchObject({ value: 14000, status: "met" });
  });
});

describe("the measurement", () => {
  it("records only successful steps, rounded to whole milliseconds", () => {
    const recorder = createPerformanceRecorder();
    recorder.observer("total", 812.6, true);
    recorder.observer("total", 99, false);
    recorder.observer("search", 12.2, true);
    expect(recorder.samples()).toEqual({ total: [813], queryEmbedding: [], search: [12], rerank: [] });
  });

  it("carries its checksum; a changed sample, result or environment is found", () => {
    const m = buildPerformanceMeasurement({ runId: "r", configurationFingerprint: "f".repeat(64), environment: "evaluation", retrieval: samples([100, 200]), ingestion: none, measuredAt: "2026-10-08T08:00:00.000Z", measurementId: "m" });
    expect(verifyPerformanceMeasurement(m)).toEqual([]);
    expect(verifyPerformanceMeasurement({ ...m, retrieval: samples([100, 1]) })).toContain("Målingens checksum stemmer ikke.");
    const forgedResults = { ...m, results: m.results.map((r) => ({ ...r, status: "met" as const })) };
    expect(verifyPerformanceMeasurement(forgedResults)).toContain("Resultaterne stemmer ikke med målingerne.");
    expect(verifyPerformanceMeasurement({ ...m, environment: "fixture" })).toContain("Kun målinger fra evalueringsmiljøet kan registreres.");
  });
});

describe("the pgTAP fixture is the generated measurement (no drift between TypeScript and SQL)", () => {
  it("equals buildPerformanceMeasurement(FIXTURE_PERFORMANCE)", () => {
    const sql = fs.readFileSync(path.resolve(__dirname, "../../supabase/tests/database/retrieval_configuration_registry.test.sql"), "utf8");
    const literal = sql.match(/\$performance\$([\s\S]*?)\$performance\$/)?.[1];
    expect(literal).toBeDefined();
    expect(JSON.parse(literal!)).toEqual(JSON.parse(JSON.stringify(buildPerformanceMeasurement(FIXTURE_PERFORMANCE))));
  });
});
