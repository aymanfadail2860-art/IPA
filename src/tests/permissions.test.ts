import { describe, expect, it } from "vitest";

import { isHiddenInBeta } from "@/config/beta-surface";
import { BETA_HIDDEN_AREAS, canAccessPath, isAreaAvailable, isHrefAvailable, NAV_ITEMS, surfaceOf, visibleNavItems, type Surface } from "@/config/navigation";
import { hasPermission, meetsRequirement } from "@/lib/auth/permissions";
import { grantsFor } from "./fixtures/role-grants";

const SESSIONS = {
  advisor: grantsFor("advisor"),
  leader: grantsFor("advisor", "leader"),
  administrator: grantsFor("administrator"),
  administratorWithLeaderScope: grantsFor("administrator", "leader"),
};
/** The full product (the demo surface, B-003): every area, filtered by permissions only. */
const navIds = (role: keyof typeof SESSIONS, surface: Surface = "demo") => visibleNavItems(SESSIONS[role], surface).map((item) => item.id);

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
    expect(canAccessPath("/admin/documents", SESSIONS.leader, "demo")).toBe(false);
    expect(canAccessPath("/admin/documents", SESSIONS.administrator, "demo")).toBe(true);
    expect(canAccessPath("/analytics", SESSIONS.advisor, "demo")).toBe(false);
    expect(canAccessPath("/learn/erhvervsansvar", SESSIONS.advisor, "demo")).toBe(true);
  });
});

describe("the beta surface (B-035, docs/beta.md §1, L2)", () => {
  it("is every signed-in session with a database; the demo without login (B-003) is not the beta", () => {
    expect(surfaceOf({})).toBe("beta");
    expect(surfaceOf({ demo: undefined })).toBe("beta");
    expect(surfaceOf({ demo: { role: "advisor" } })).toBe("demo");
  });

  it("hides exactly Advise, Analytics and Min profil — for every role, whatever the permissions", () => {
    expect(Object.keys(BETA_HIDDEN_AREAS).sort()).toEqual(["advise", "analytics", "profile"]);
    // The proxy's prefixes are exactly the navigation's hrefs of those areas.
    for (const [id, prefix] of Object.entries(BETA_HIDDEN_AREAS)) expect(NAV_ITEMS.find((item) => item.id === id)?.href, id).toBe(prefix);
    expect(navIds("administratorWithLeaderScope", "beta")).toEqual(["home", "learn", "copilot", "practice", "assessment", "admin"]);
    expect(navIds("leader", "beta")).toEqual(["home", "learn", "copilot", "practice", "assessment"]);
    expect(navIds("advisor", "beta")).toEqual(["home", "learn", "copilot", "practice", "assessment"]);
  });

  it("keeps the four core modules, Home and Admin (by permission)", () => {
    for (const id of ["home", "learn", "copilot", "practice", "assessment", "admin"]) expect(isAreaAvailable(id, "beta"), id).toBe(true);
    expect(navIds("administrator", "beta")).toContain("admin");
    expect(navIds("advisor", "beta")).not.toContain("admin");
  });

  it("refuses the hidden areas' URLs and links — also deep ones — and keeps everything in the demo", () => {
    for (const path of ["/advise", "/advise/c-1", "/analytics", "/profile"]) {
      expect(canAccessPath(path, SESSIONS.administratorWithLeaderScope, "beta"), path).toBe(false);
      expect(isHrefAvailable(path, "beta"), path).toBe(false);
      expect(isHrefAvailable(path, "demo"), path).toBe(true);
    }
    expect(isHrefAvailable("/advise/c-1?area=x#top", "beta")).toBe(false);
    expect(isHrefAvailable("/profile?tab=historik", "beta")).toBe(false);
    expect(isHrefAvailable("/analytics#team", "beta")).toBe(false);
    expect(isHrefAvailable("/learn/erhvervsansvar", "beta")).toBe(true);
    expect(isHrefAvailable("/admin/documents", "beta")).toBe(true);
    expect(canAccessPath("/analytics", SESSIONS.leader, "demo")).toBe(true);
  });

  it("the proxy's path check: the areas and everything below them — nothing that merely starts alike", () => {
    for (const path of ["/advise", "/advise/c-1", "/analytics", "/analytics/x", "/profile"]) expect(isHiddenInBeta(path), path).toBe(true);
    for (const path of ["/", "/home", "/learn", "/copilot", "/practice", "/assessment", "/admin", "/admin/documents", "/advisers", "/profiles", "/login"]) {
      expect(isHiddenInBeta(path), path).toBe(false);
    }
  });
});
