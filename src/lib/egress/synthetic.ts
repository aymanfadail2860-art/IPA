import { makeSyntheticInternal, type ClassifiedText } from "./classification.ts";

/**
 * ⚠ EVALUATION AND TESTS ONLY (8B-I2.5).
 *
 * Synthetic evaluation material — the fictional fixtures and questions of evals/retrieval/,
 * which a test scans for customer data (docs/08b §5.1). It may be sent to an external provider
 * so a candidate configuration can be evaluated. A guardrail test allows only evals/ and
 * src/tests/ to import this module, so application code can never label user or customer text
 * as synthetic.
 */
export function syntheticText(text: string): ClassifiedText {
  return makeSyntheticInternal(text);
}
