import type { buildPerformanceMeasurement } from "../../../evals/engine/performance.ts";

/**
 * ⚠ TEST FIXTURE — a fictional performance measurement (8B-I7) used by the unit tests and, as a
 * literal, by pgTAP (supabase/tests/database/retrieval_configuration_registry.test.sql). The run id and
 * fingerprint are those of the pgTAP report fixture; the samples are made up so that some
 * targets are met, some not and some not measured.
 */
export const FIXTURE_PERFORMANCE: Parameters<typeof buildPerformanceMeasurement>[0] = Object.freeze({
  runId: "f6000000-0000-4000-8000-0000000000aa",
  configurationFingerprint: "0".repeat(64),
  environment: "evaluation",
  measuredAt: "2026-10-08T08:00:00.000Z",
  measurementId: "f6000000-0000-4000-8000-0000000000pf",
  retrieval: {
    total: [420, 610, 700, 780, 815, 900, 1250, 1490, 1620, 640, 590, 710],
    queryEmbedding: [110, 130, 95, 180, 240, 310, 120, 140, 160, 150, 100, 90],
    search: [40, 55, 61, 48, 90, 120, 70, 66, 52, 49, 58, 63],
    rerank: [],
  },
  ingestion: { documents: [{ pages: 52, seconds: 241 }, { pages: 3, seconds: 19 }], corpusPages: 55, corpusSeconds: 260 },
});
