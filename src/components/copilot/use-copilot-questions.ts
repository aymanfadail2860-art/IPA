"use client";

import { useCallback, useRef, useState } from "react";

import { askCopilot } from "@/lib/ai/copilot-actions";
import { copilotResultFromOutcome, type CopilotResult } from "@/lib/ai/copilot-view";
import { demoCopilotResult } from "@/dev/demo/copilot-demo";

export type CopilotMode = "demo" | "live";

export interface CopilotDevFlags {
  forceUnverifiable: boolean;
  forceInsufficient: boolean;
}

export interface QuestionEntry {
  id: string;
  question: string;
  result: CopilotResult | null;
}

/**
 * Questions asked in this view and their results (docs/08 §13). One turn at a time — nothing is
 * stored (Q-5).
 *
 *   live: every question goes through the AI Gateway (server action → runAiRequest).
 *   demo: a FIXED mock answer from src/mocks — no gateway, no model, no search.
 */
export function useCopilotQuestions(mode: CopilotMode, options: { label?: string | null; dev?: CopilotDevFlags } = {}) {
  const [entries, setEntries] = useState<QuestionEntry[]>([]);
  const counter = useRef(0);
  const { label, dev } = options;

  const ask = useCallback(
    (question: string) => {
      counter.current += 1;
      const id = `q-${counter.current}`;
      setEntries((list) => [...list, { id, question, result: null }]);
      const settle = (result: CopilotResult) => setEntries((list) => list.map((entry) => (entry.id === id ? { ...entry, result } : entry)));

      if (mode === "demo") {
        const result = demoCopilotResult(question);
        window.setTimeout(() => settle(result), 900);
        return;
      }
      askCopilot(question, { label: label ?? undefined }, dev ?? {})
        .then((outcome) => settle(copilotResultFromOutcome(question, outcome)))
        .catch(() => settle({ kind: "error", question, message: "Spørgsmålet kunne ikke sendes. Prøv igen." }));
    },
    [mode, label, dev],
  );

  const clear = useCallback(() => setEntries([]), []);
  return { entries, ask, clear };
}
