import type {
  CaseObservation,
  CaseType,
  GateSet,
  HardGateId,
  HardGateResult,
  Metrics,
  MetricValue,
  QualityGateResult,
  RerankerComparison,
  Tier,
  Verdict,
  Violation,
} from "./types.ts";
import { HARD_GATE_IDS, QUALITY_GATE_IDS } from "./types.ts";

/**
 * The gate engine (docs/08b §4.4, D-6). Deterministic and fail-closed.
 *
 *   * Hard gates H1–H7 are invariants with ZERO tolerance. Their threshold is not data and not
 *     configurable: a single violation fails the gate, and a failed hard gate fails the run —
 *     no quality score can compensate for it.
 *   * Quality gates Q1–Q7 read their thresholds from the versioned gate set (gates-v1.json).
 *     A value that cannot be computed fails its gate.
 *   * The pilot rules (minimum per type, Wilson intervals, tier) are locked in code.
 */

/** Hard gates tolerate nothing. Deliberately a constant, not a parameter. */
export const HARD_GATE_TOLERANCE = 0;

/** H6 and H7 make a run invalid: it documents something other than the configuration (§4.4). */
export const INVALIDATING_HARD_GATES: readonly HardGateId[] = ["H6", "H7"];

/** Minimum per question type for a valid run (docs/08b §4.4, pilot rule 2). */
export const TYPE_MINIMUMS: readonly { label: string; types: readonly CaseType[]; minimum: number }[] = [
  { label: "besvarbare (direct og multi_chunk)", types: ["direct", "multi_chunk"], minimum: 20 },
  { label: "ubesvarbare", types: ["unanswerable"], minimum: 5 },
  { label: "historiske", types: ["historical"], minimum: 3 },
  { label: "konflikt", types: ["conflict"], minimum: 2 },
  { label: "distraktor", types: ["distractor"], minimum: 3 },
  { label: "adgang eller filter", types: ["permission", "filter"], minimum: 3 },
];

/** Under this many active questions an approval can at most be a pilot (pilot rule 5). */
export const PILOT_TIER_BELOW = 100;

/** Numbers equal up to rounding count as equal (Q7 "not lower"). */
const EPSILON = 1e-9;

export function evaluateHardGates(violations: readonly Violation[]): HardGateResult[] {
  return HARD_GATE_IDS.map((id) => {
    const count = violations.filter((violation) => violation.gate === id).length;
    return { id, status: count > HARD_GATE_TOLERANCE ? "fail" : "pass", violations: count };
  });
}

function metricOf(metrics: Metrics, id: string): MetricValue | null {
  const value = (metrics as unknown as Record<string, MetricValue | undefined>)[id];
  return value ?? null;
}

export function evaluateQualityGates(metrics: Metrics, comparison: RerankerComparison, gates: GateSet): QualityGateResult[] {
  return QUALITY_GATE_IDS.map((id): QualityGateResult => {
    const spec = gates.quality[id];
    if (spec.comparator === "not_lower") {
      const { withReranker: on, withoutReranker: off } = comparison;
      const values = [on.passage_recall_at_k, on.mrr_at_k, off.passage_recall_at_k, off.mrr_at_k];
      if (!comparison.available || values.some((value) => value === null || !Number.isFinite(value))) {
        return { id, metric: spec.metric, comparator: spec.comparator, threshold: null, value: null, status: "fail", uncertain: false, explanation: "Sammenligningen med kørslen uden reranker kunne ikke foretages." };
      }
      const recallDelta = on.passage_recall_at_k! - off.passage_recall_at_k!;
      const mrrDelta = on.mrr_at_k! - off.mrr_at_k!;
      const ok = recallDelta >= -EPSILON && mrrDelta >= -EPSILON;
      return {
        id,
        metric: spec.metric,
        comparator: spec.comparator,
        threshold: null,
        value: Math.min(recallDelta, mrrDelta),
        status: ok ? "pass" : "fail",
        uncertain: false,
        explanation: `Med reranker: Passage Recall ${format(on.passage_recall_at_k)}, MRR ${format(on.mrr_at_k)}. Uden: ${format(off.passage_recall_at_k)}, ${format(off.mrr_at_k)}.`,
      };
    }
    const metric = metricOf(metrics, spec.metric);
    const threshold = spec.threshold;
    if (!metric || metric.value === null || !Number.isFinite(metric.value) || threshold === undefined || !Number.isFinite(threshold)) {
      return { id, metric: spec.metric, comparator: spec.comparator, threshold: threshold ?? null, value: null, status: "fail", uncertain: false, explanation: "Metrikken kunne ikke beregnes (ingen spørgsmål af den type)." };
    }
    const value = metric.value;
    const ok = spec.comparator === ">=" ? value >= threshold - EPSILON : value <= threshold + EPSILON;
    // The gate is decided on the point estimate; the report flags when the interval crosses the
    // threshold. For "≥" the lower bound matters, for "≤" the upper bound.
    const interval = metric.interval;
    const uncertain = interval !== null && (spec.comparator === ">=" ? interval.lower < threshold : interval.upper > threshold);
    return {
      id,
      metric: spec.metric,
      comparator: spec.comparator,
      threshold,
      value,
      status: ok ? "pass" : "fail",
      uncertain,
      explanation: `${format(value)} ${spec.comparator === ">=" ? "≥" : "≤"} ${format(threshold)}${metric.numerator !== null ? ` (${metric.numerator}/${metric.denominator})` : ` (n = ${metric.denominator})`}${interval ? `, 95 %-interval [${format(interval.lower)}; ${format(interval.upper)}]` : ""}.`,
    };
  });
}

export function format(value: number | null): string {
  return value === null ? "—" : value.toFixed(3);
}

export interface MinimumResult {
  label: string;
  minimum: number;
  actual: number;
  met: boolean;
}

export function checkTypeMinimums(observations: readonly Pick<CaseObservation, "type">[]): MinimumResult[] {
  return TYPE_MINIMUMS.map((rule) => {
    const actual = observations.filter((observation) => rule.types.includes(observation.type)).length;
    return { label: rule.label, minimum: rule.minimum, actual, met: actual >= rule.minimum };
  });
}

export function tierFor(activeCases: number): Tier {
  return activeCases < PILOT_TIER_BELOW ? "pilot" : "standard";
}

export interface Decision {
  verdict: Verdict;
  valid: boolean;
  invalidReasons: string[];
}

/**
 * The overall decision. Order matters and is fixed: hard gates first, then validity, then
 * quality. A run with a failed hard gate is "fail" whatever its quality numbers are.
 */
export function decide(hard: readonly HardGateResult[], quality: readonly QualityGateResult[], minimums: readonly MinimumResult[]): Decision {
  const invalidReasons: string[] = [];
  for (const id of INVALIDATING_HARD_GATES) {
    if (hard.find((result) => result.id === id)?.status !== "pass") invalidReasons.push(`Hårdt gate ${id} er ikke bestået.`);
  }
  for (const minimum of minimums) {
    if (!minimum.met) invalidReasons.push(`For få ${minimum.label}: ${minimum.actual} (mindst ${minimum.minimum}).`);
  }
  const valid = invalidReasons.length === 0;
  // Every hard gate must be present and pass — a missing result is a failure, not a pass.
  const hardPassed = HARD_GATE_IDS.every((id) => hard.find((result) => result.id === id)?.status === "pass");
  const qualityPassed = QUALITY_GATE_IDS.every((id) => quality.find((result) => result.id === id)?.status === "pass");
  if (!hardPassed || !valid || !qualityPassed) return { verdict: "fail", valid, invalidReasons };
  return { verdict: quality.some((result) => result.uncertain) ? "uncertain" : "pass", valid, invalidReasons };
}
