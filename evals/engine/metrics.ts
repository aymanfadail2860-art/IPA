import type { CaseObservation, Interval, Metrics, MetricValue } from "./types.ts";

/**
 * The locked metrics (docs/08b §4.2–§4.3, D-5), computed from case observations only — so the
 * same observations always give the same numbers, and a report can be re-verified
 * (publication.ts). Retired cases never reach this module.
 *
 *   answerable  = expected outcome "evidence"
 *   abstaining  = expected outcome "insufficient" (unanswerable and permission questions)
 */

/** z for a two-sided 95 % interval. */
const Z95 = 1.959963984540054;

/** Wilson score interval for a proportion (docs/08b §4.4, pilot rule 4). Null for n = 0. */
export function wilson(successes: number, n: number, z: number = Z95): Interval | null {
  if (!Number.isInteger(successes) || !Number.isInteger(n) || n < 0 || successes < 0 || successes > n) {
    throw new Error(`Ugyldig andel: ${successes}/${n}.`);
  }
  if (n === 0) return null;
  const p = successes / n;
  const z2 = z * z;
  const denominator = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denominator;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denominator;
  // Clamp rounding noise at the edges: the interval of 0/n starts at 0, of n/n ends at 1.
  return { lower: successes === 0 ? 0 : Math.max(0, center - half), upper: successes === n ? 1 : Math.min(1, center + half) };
}

function proportion(numerator: number, denominator: number): MetricValue {
  return { value: denominator === 0 ? null : numerator / denominator, numerator, denominator, interval: wilson(numerator, denominator) };
}

function mean(values: number[]): MetricValue {
  return { value: values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length, numerator: null, denominator: values.length, interval: null };
}

function dcg(gains: number[]): number {
  return gains.reduce((sum, gain, i) => sum + (2 ** gain - 1) / Math.log2(i + 2), 0);
}

/**
 * Passage Recall counts a question when EVERY required passage (grade 3) is covered within K.
 * The required passages are a set, so reordering them in the facit never changes a number.
 */
export function coversAllRequired(observation: CaseObservation): boolean {
  return observation.requiredTotal > 0 && observation.requiredCovered === observation.requiredTotal;
}

export function computeMetrics(observations: readonly CaseObservation[]): Metrics {
  const answerable = observations.filter((observation) => observation.outcome === "evidence");
  const abstaining = observations.filter((observation) => observation.outcome === "insufficient");
  const distractor = observations.filter((observation) => observation.type === "distractor");
  const within = (rank: number | null, k: number) => rank !== null && rank <= k;

  const intrusions = distractor.reduce((sum, observation) => sum + observation.distractorItems, 0);
  const returned = distractor.reduce((sum, observation) => sum + observation.itemsWithinK, 0);

  return {
    source_recall_at_k: proportion(answerable.filter((observation) => observation.sourceRank !== null).length, answerable.length),
    passage_recall_at_k: proportion(answerable.filter(coversAllRequired).length, answerable.length),
    mrr_at_k: mean(answerable.map((observation) => (observation.firstGrade3Rank === null ? 0 : 1 / observation.firstGrade3Rank))),
    correct_abstention: proportion(abstaining.filter((observation) => observation.empty).length, abstaining.length),
    false_abstention: proportion(answerable.filter((observation) => observation.empty).length, answerable.length),
    // Share of the items returned for distractor questions that come from a distractor. With no
    // items returned there is no intrusion (0/0 → 0); an empty answer is caught by Q5 instead.
    distractor_intrusion:
      distractor.length === 0
        ? { value: null, numerator: 0, denominator: 0, interval: null }
        : { ...proportion(intrusions, returned), value: returned === 0 ? 0 : intrusions / returned },
    informational: {
      source_recall_at_1: proportion(answerable.filter((observation) => within(observation.sourceRank, 1)).length, answerable.length),
      source_recall_at_3: proportion(answerable.filter((observation) => within(observation.sourceRank, 3)).length, answerable.length),
      full_coverage_at_k: mean(answerable.map((observation) => (observation.requiredTotal === 0 ? 0 : observation.requiredCovered / observation.requiredTotal))),
      ndcg_at_k: mean(
        answerable.map((observation) => {
          const ideal = dcg(observation.idealGains);
          return ideal === 0 ? 0 : dcg(observation.gainsByRank) / ideal;
        }),
      ),
    },
  };
}
