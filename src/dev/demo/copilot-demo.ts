import type { CopilotResult } from "@/lib/ai/copilot-view";
import { mockCopilotDemoAnswer } from "@/mocks";

/**
 * ⚠ TEMPORARY DEMO WITHOUT LOGIN (B-003) — Copilot in the demo without a database (docs/08 §13).
 * A question gets a FIXED mock answer; no AI Gateway, no model, no search. Removed with the
 * demo mode.
 */
export function demoCopilotResult(question: string): CopilotResult {
  const mock = mockCopilotDemoAnswer(question);
  switch (mock.kind) {
    case "exchange":
      return { kind: "exchange", exchange: { ...mock.exchange, question }, development: false };
    case "unverifiable":
      return { kind: "unverifiable", question, sources: mock.sources };
    case "locked":
    case "notice":
      return { kind: mock.kind, question, message: mock.message };
  }
}
