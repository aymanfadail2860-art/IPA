import { describe, expect, it } from "vitest";

import { canAccessPath, visibleNavItems } from "@/config/navigation";
import { hasPermission, meetsRequirement } from "@/lib/auth/permissions";
import { grantsFor } from "./fixtures/role-grants";

const SESSIONS = {
  advisor: grantsFor("advisor"),
  leader: grantsFor("advisor", "leader"),
  administrator: grantsFor("administrator"),
  administratorWithLeaderScope: grantsFor("administrator", "leader"),
};
const navIds = (role: keyof typeof SESSIONS) => visibleNavItems(SESSIONS[role]).map((item) => item.id);

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

describe("role-dependent navigation (role bundles from the database catalogue)", () => {
  it("keeps the locked order of the main navigation", () => {
    expect(navIds("administratorWithLeaderScope")).toEqual([
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
    expect(hasPermission(SESSIONS.leader, "knowledge.document.write")).toBe(false);
  });

  it("does not give a Rådgiver team scope on any data (KRAV-ROL-003)", () => {
    expect(SESSIONS.advisor.every((grant) => grant.scope === "own")).toBe(true);
  });

  it("does not give Administrator Analytics through the role ('efter rettigheder')", () => {
    expect(navIds("administrator")).not.toContain("analytics");
    expect(navIds("administrator")).toContain("admin");
  });

  it("guards direct URLs with the same requirement as the menu", () => {
    expect(canAccessPath("/admin/documents", SESSIONS.leader)).toBe(false);
    expect(canAccessPath("/admin/documents", SESSIONS.administrator)).toBe(true);
    expect(canAccessPath("/analytics", SESSIONS.advisor)).toBe(false);
    expect(canAccessPath("/learn/erhvervsansvar", SESSIONS.advisor)).toBe(true);
  });
});
