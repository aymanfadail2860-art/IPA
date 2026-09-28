import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { ADVISE_CAPABILITIES, ADVISE_DISABLED_REASONS, deviceClassForWidth } from "@/config/advise-capabilities";
import { hasPermission } from "@/lib/auth/permissions";
import { ROLE_GRANTS } from "./fixtures/role-grants";

describe("Advise per device class (docs/04 §19)", () => {
  it("is read-only on mobile", () => {
    expect(ADVISE_CAPABILITIES.mobile).toEqual({ requestSuggestions: false, reviewSuggestions: false, editNotes: false });
  });

  it("allows reading and working notes on tablet — but no accept/reject", () => {
    expect(ADVISE_CAPABILITIES.tablet.editNotes).toBe(true);
    expect(ADVISE_CAPABILITIES.tablet.reviewSuggestions).toBe(false);
    expect(ADVISE_CAPABILITIES.tablet.requestSuggestions).toBe(false);
  });

  it("allows everything on desktop", () => {
    expect(Object.values(ADVISE_CAPABILITIES.desktop).every(Boolean)).toBe(true);
  });

  it("maps widths to the bp.tablet and bp.desktop tokens", () => {
    expect(deviceClassForWidth(390)).toBe("mobile");
    expect(deviceClassForWidth(767)).toBe("mobile");
    expect(deviceClassForWidth(768)).toBe("tablet");
    expect(deviceClassForWidth(1023)).toBe("tablet");
    expect(deviceClassForWidth(1024)).toBe("desktop");
  });

  it("explains every disabled action in Danish", () => {
    expect(ADVISE_DISABLED_REASONS.desktopOnly).toBe("Kan kun redigeres på desktop");
    expect(ADVISE_DISABLED_REASONS.notesTabletOrDesktop.length).toBeGreaterThan(0);
  });

  it("wires the rule into the case workspace", () => {
    const source = fs.readFileSync(path.resolve(__dirname, "../app/(platform)/advise/[caseId]/case-workspace.tsx"), "utf8");
    for (const prop of ["actionsDisabledReason=", "undoDisabledReason=", "disabledReason=", "readOnlyReason="]) {
      expect(source, prop).toContain(prop);
    }
    expect(source).toContain("ADVISE_CAPABILITIES");
  });
});

describe("case access per case, not per role (docs/03 §10, B-001)", () => {
  it("gives every role advise.case.read/write with scope own — administrator included", () => {
    for (const grants of Object.values(ROLE_GRANTS)) {
      expect(hasPermission(grants, "advise.case.read", "own")).toBe(true);
      expect(hasPermission(grants, "advise.case.write", "own")).toBe(true);
      expect(hasPermission(grants, "advise.case.read", "team")).toBe(false);
      expect(hasPermission(grants, "advise.case.read", "all")).toBe(false);
    }
  });
  // Which cases each user can see is enforced by RLS and tested against a real database in
  // src/tests/integration/rls.integration.test.ts.
});
