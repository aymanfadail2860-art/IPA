import { describe, expect, it } from "vitest";

import { canAccessPath, visibleNavItems } from "@/config/navigation";
import { hasPermission, meetsRequirement } from "@/lib/auth/permissions";
import { MOCK_SESSIONS } from "@/mocks/sessions";

const navIds = (role: keyof typeof MOCK_SESSIONS) => visibleNavItems(MOCK_SESSIONS[role].grants).map((item) => item.id);

describe("permission checks", () => {
  it("matches key and optional scope", () => {
    const grants = [{ key: "analytics.team.read", scope: "team" }] as const;
    expect(hasPermission(grants, "analytics.team.read")).toBe(true);
    expect(hasPermission(grants, "analytics.team.read", "team")).toBe(true);
    expect(hasPermission(grants, "analytics.team.read", "all")).toBe(false);
    expect(hasPermission(grants, "identity.user.manage")).toBe(false);
  });

  it("requires every allOf key and at least one anyOf key", () => {
    const grants = [
      { key: "learning.progress.read", scope: "own" },
      { key: "knowledge.document.write", scope: "all" },
    ] as const;
    expect(meetsRequirement(grants, undefined)).toBe(true);
    expect(meetsRequirement(grants, { allOf: ["learning.progress.read"] })).toBe(true);
    expect(meetsRequirement(grants, { anyOf: ["identity.user.manage", "knowledge.document.write"] })).toBe(true);
    expect(meetsRequirement(grants, { allOf: ["learning.progress.read", "identity.user.manage"] })).toBe(false);
  });
});

describe("role-dependent navigation (mock roles)", () => {
  it("keeps the locked order of the main navigation", () => {
    expect(navIds("administrator")).toEqual([
      "home",
      "learn",
      "copilot",
      "practice",
      "advise",
      "assessment",
      "analytics",
      "profile",
      "admin",
    ]);
  });

  it("hides Analytics and Admin for Rådgiver instead of showing them locked", () => {
    const ids = navIds("advisor");
    expect(ids).not.toContain("analytics");
    expect(ids).not.toContain("admin");
    expect(ids).toHaveLength(7);
  });

  it("gives Leder Analytics but never Admin (KRAV-ROL-002)", () => {
    const ids = navIds("leader");
    expect(ids).toContain("analytics");
    expect(ids).not.toContain("admin");
    expect(hasPermission(MOCK_SESSIONS.leader.grants, "knowledge.document.write")).toBe(false);
  });

  it("does not give a Rådgiver team scope on any data (KRAV-ROL-003)", () => {
    expect(MOCK_SESSIONS.advisor.grants.every((grant) => grant.scope === "own")).toBe(true);
  });

  it("guards direct URLs with the same requirement as the menu", () => {
    expect(canAccessPath("/admin/documents", MOCK_SESSIONS.leader.grants)).toBe(false);
    expect(canAccessPath("/admin/documents", MOCK_SESSIONS.administrator.grants)).toBe(true);
    expect(canAccessPath("/analytics", MOCK_SESSIONS.advisor.grants)).toBe(false);
    expect(canAccessPath("/learn/erhvervsansvar", MOCK_SESSIONS.advisor.grants)).toBe(true);
  });
});
