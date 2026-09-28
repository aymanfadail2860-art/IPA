import { describe, expect, it } from "vitest";

import { OWN_CASES_GROUP, searchEntriesForUser } from "@/lib/search";
import { mockSearchIndex } from "@/mocks/search";
import type { CaseSummary } from "@/types/domain";

const caseA: CaseSummary = { id: "a", companyName: "Testvirksomhed A", status: "active", updatedAt: "2026-09-28", participants: [] };
const caseB: CaseSummary = { id: "b", companyName: "Testvirksomhed B", status: "closed", updatedAt: "2026-09-28", participants: [] };

describe("global search shows only own and assigned cases (docs/04 §21, docs/03 §10)", () => {
  it("lists exactly the cases the server loaded under RLS", () => {
    const entries = searchEntriesForUser({ entries: mockSearchIndex, cases: [caseA, caseB], isAdmin: false });
    expect(entries.filter((entry) => entry.group === OWN_CASES_GROUP).map((entry) => entry.href)).toEqual(["/advise/a", "/advise/b"]);
  });

  it("ignores static case entries, so a case can only reach the search through case access", () => {
    const leaked = searchEntriesForUser({
      entries: [{ id: "x", group: OWN_CASES_GROUP, title: "Testvirksomhed X", href: "/advise/x" }],
      cases: [],
      isAdmin: false,
    });
    expect(leaked).toEqual([]);
    expect(mockSearchIndex.some((entry) => (entry.group as string) === OWN_CASES_GROUP)).toBe(false);
  });

  it("shows administration entries only to administrators", () => {
    const advisor = searchEntriesForUser({ entries: mockSearchIndex, cases: [], isAdmin: false });
    const admin = searchEntriesForUser({ entries: mockSearchIndex, cases: [], isAdmin: true });
    expect(advisor.some((entry) => entry.adminOnly)).toBe(false);
    expect(admin.some((entry) => entry.adminOnly)).toBe(true);
  });
});
