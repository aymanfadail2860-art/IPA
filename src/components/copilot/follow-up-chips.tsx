"use client";

import { Chip } from "@/components/common/chip";

/** FollowUpChips — suggested follow-up questions under an answer. */
export function FollowUpChips({ questions, onSelect }: { questions: readonly string[]; onSelect?: (question: string) => void }) {
  if (questions.length === 0) return null;
  return (
    <div>
      <p className="mb-2 text-caption text-fg-tertiary">Forslag til opfølgning</p>
      <ul className="flex flex-wrap gap-2">
        {questions.map((question) => (
          <li key={question}>
            <Chip onClick={() => onSelect?.(question)}>{question}</Chip>
          </li>
        ))}
      </ul>
    </div>
  );
}
