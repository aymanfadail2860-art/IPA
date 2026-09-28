import { describe, expect, it } from "vitest";

import { casesForUser } from "@/lib/auth/case-access";
import { OWN_CASES_GROUP, searchEntriesForUser } from "@/lib/search";
import { mockCases } from "@/mocks/advise";
import { mockSearchIndex } from "@/mocks/search";
import { MOCK_SESSIONS, type MockRoleId } from "@/mocks/sessions";

function caseResults(role: MockRoleId) {
  return searchEntriesForUser({
    entries: mockSearchIndex,
    cases: mockCases,
    userId: MOCK_SESSIONS[role].user.id,
    isAdmin: role === "administrator",
  }).filter((entry) => entry.group === OWN_CASES_GROUP);
}

describe("global search shows only own and assigned cases (docs/04 §21, docs/03 §10)", () => {
  it.each(["advisor", "leader", "administrator"] as const)("matches the case overview for %s", (role) => {
    const expected = casesForUser(mockCases, MOCK_SESSIONS[role].user.id).map((entry) => `/advise/${entry.id}`);
    expect(caseResults(role).map((entry) => entry.href)).toEqual(expected);
  });

  it("never shows a case the user is not assigned to", () => {
    expect(caseResults("leader").map((entry) => entry.title)).toEqual(["Bagerhuset ApS"]);
    expect(caseResults("administrator").map((entry) => entry.title)).toEqual(["Vestkyst Logistik ApS"]);
  });

  it("ignores static case entries, so a case can only reach the search through case access", () => {
    const leaked = searchEntriesForUser({
      entries: [{ id: "x", group: OWN_CASES_GROUP, title: "Nordjysk Entreprise A/S", href: "/advise/nordjysk-entreprise" }],
      cases: [],
      userId: MOCK_SESSIONS.leader.user.id,
      isAdmin: false,
    });
    expect(leaked).toEqual([]);
    expect(mockSearchIndex.some((entry) => (entry.group as string) === OWN_CASES_GROUP)).toBe(false);
  });
});
