import { describe, expect, it } from "vitest";

import { KNOWLEDGE_STATUSES, STATUSES } from "@/config/status";
import { leaderVisibility } from "@/config/visibility";
import { MOCK_SESSIONS } from "@/mocks/sessions";

describe("status system", () => {
  it("defines exactly the seven locked knowledge statuses", () => {
    expect(Object.keys(KNOWLEDGE_STATUSES).sort()).toEqual(
      ["aiSuggestion", "authoritative", "conflict", "historical", "insufficient", "validated", "workingNote"].sort(),
    );
  });

  it("gives every status colour + icon + text — never colour alone", () => {
    for (const [id, definition] of Object.entries(STATUSES)) {
      expect(definition.label.trim(), id).not.toBe("");
      expect(definition.icon, id).toBeTruthy();
      expect(definition.textClass, id).toMatch(/^text-/);
      expect(definition.subtleClass, id).toMatch(/^bg-/);
      expect(definition.edgeClass, id).toMatch(/^border-l-/);
    }
  });

  it("keeps knowledge status labels and icons unique, so no two statuses look alike", () => {
    const definitions = Object.values(KNOWLEDGE_STATUSES);
    expect(new Set(definitions.map((definition) => definition.label)).size).toBe(definitions.length);
    expect(new Set(definitions.map((definition) => definition.icon)).size).toBe(definitions.length);
  });
});

describe("Synlighed — derived from the leader's permissions", () => {
  it("lists what the leader can and cannot see", () => {
    const { canSee, cannotSee } = leaderVisibility(MOCK_SESSIONS.leader.grants);
    expect(canSee.map((category) => category.id)).toEqual([
      "learning-progress",
      "completed-paths",
      "assessment-results",
      "competencies",
      "development-areas",
    ]);
    expect(cannotSee.map((category) => category.id)).toEqual(["copilot", "case-content", "notes", "practice-answers"]);
  });

  it("shows nothing as visible when the leader has no team scope", () => {
    const { canSee } = leaderVisibility(MOCK_SESSIONS.advisor.grants);
    expect(canSee).toHaveLength(0);
  });
});
