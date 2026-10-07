/**
 * Runtime proof that an embedder or reranker IS a production implementation (docs/08b §9 P1,
 * P2; 8B-I6).
 *
 * A declared grade is a claim: any object can say `grade: "production"`. The evidence layer
 * therefore only counts an implementation as production when it was constructed by one of the
 * production adapters (providers/bedrock/*), which record their instances here. A copy, a
 * hand-built object, a test double or a development implementation renamed to a production
 * provider is never in the set. Only the production adapters call markProductionImplementation
 * (guardrail test).
 *
 * Shared by the Next.js server, the worker and the evaluation engine: relative imports with
 * .ts, no path aliases, no server-only import.
 */

const productionImplementations = new WeakSet<object>();

export function markProductionImplementation<T extends object>(implementation: T): T {
  productionImplementations.add(implementation);
  return implementation;
}

export function isProductionImplementation(implementation: unknown): boolean {
  return typeof implementation === "object" && implementation !== null && productionImplementations.has(implementation);
}
