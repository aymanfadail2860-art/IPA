import type { Grade, ModelInput, ModelOutput } from "./types";

/**
 * Model interface (docs/08 §3.1). Generation is with the Claude API (docs/03 §2, locked); no
 * adapter is built in phase 8. Model versions are configuration.
 *
 * `grade` is a property of the implementation — the caller never sets it. Only invoke.ts
 * calls `generate` (guardrail test), and it enforces the pairing rule of B-012.
 */
export interface Model<G extends Grade = Grade> {
  readonly id: string;
  readonly version: string;
  readonly grade: G;
  generate(input: ModelInput): Promise<ModelOutput>;
}
