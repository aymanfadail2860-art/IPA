import { requireProductionEvidence, type EvidenceSet, type ProductionEvidenceSet } from "@/lib/knowledge/core/evidence";

import type { Model } from "./model";
import type { ModelInput, ModelOutput } from "./types";

/**
 * The ONLY place a model is called (docs/08 §3.3, B-012; guardrail test).
 *
 * Pairing rule: a production model may only receive production evidence (docs/07 §9.1 pt. 4 as
 * clarified by B-012). The dangerous pairing is "production model + development evidence";
 * "development model + development evidence" never reaches a user, because the stub model
 * cannot be constructed outside IPA_RUNTIME_ENV=local/test.
 *
 *   * Types: a Model<"production"> only accepts a ProductionEvidenceSet (overload below).
 *   * Runtime, fail-closed: any grade that is not exactly "development" is treated as
 *     production, and then requireProductionEvidence must pass — it throws for development,
 *     non-issued and forced evidence.
 *   * Evidence parts cannot be smuggled past the check: every knowledge part must belong to the
 *     evidence set that was checked.
 */

export class EvidencePairingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EvidencePairingError";
  }
}

export function invokeModel(model: Model<"production">, evidence: ProductionEvidenceSet | null, input: ModelInput): Promise<ModelOutput>;
export function invokeModel(model: Model<"development">, evidence: EvidenceSet | null, input: ModelInput): Promise<ModelOutput>;
export async function invokeModel(model: Model, evidence: EvidenceSet | null, input: ModelInput): Promise<ModelOutput> {
  const developmentModel = model.grade === "development";
  if (!developmentModel && evidence) requireProductionEvidence(evidence);

  const knowledgeParts = input.parts.filter((part) => part.category === "knowledge");
  if (knowledgeParts.length > 0) {
    if (!evidence) throw new EvidencePairingError("Faglige uddrag kan kun sendes med det evidenssæt, de stammer fra.");
    const ids = new Set(evidence.items.map((item) => item.evidenceId));
    for (const part of knowledgeParts) {
      if (!part.evidence || !ids.has(part.evidence.evidenceId) || part.kind !== "evidence") {
        throw new EvidencePairingError("Et fagligt uddrag stammer ikke fra det kontrollerede evidenssæt.");
      }
    }
  }
  return model.generate(input);
}
