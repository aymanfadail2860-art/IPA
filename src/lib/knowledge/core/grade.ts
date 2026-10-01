/**
 * Evidence grade and runtime environment (docs/07 §9.1, B-18).
 *
 * Every embedder and reranker implementation declares its own grade. Development-grade
 * implementations (the test embedder, the "none" reranker) can only be constructed when the
 * runtime environment is EXPLICITLY local or test. A missing or unknown IPA_RUNTIME_ENV is
 * treated as production — fail-closed.
 *
 * Shared by the Next.js server and the ingestion worker: no path aliases, no server-only
 * import, relative imports with .ts (the worker runs TypeScript with Node's type stripping).
 */

export type Grade = "development" | "production";
export type RuntimeEnv = "local" | "test" | "production";

export function runtimeEnv(value: string | undefined = process.env.IPA_RUNTIME_ENV): RuntimeEnv {
  return value === "local" || value === "test" ? value : "production";
}

export class GradeNotAllowedError extends Error {
  constructor(implementation: string, environment: RuntimeEnv) {
    super(
      `${implementation} er en udviklingsimplementering og kan ikke bruges i miljøet "${environment}". ` +
        "Sæt IPA_RUNTIME_ENV=local eller test lokalt, eller konfigurér en rigtig udbyder.",
    );
    this.name = "GradeNotAllowedError";
  }
}

/** Throws unless a development-grade implementation runs in an explicit local/test environment. */
export function assertGradeAllowed(implementation: string, grade: Grade, environment: RuntimeEnv = runtimeEnv()): void {
  if (grade === "development" && environment === "production") {
    throw new GradeNotAllowedError(implementation, environment);
  }
}

/** The grade of a result is production only if every implementation that produced it is. */
export function combinedGrade(...grades: Grade[]): Grade {
  return grades.every((grade) => grade === "production") ? "production" : "development";
}
