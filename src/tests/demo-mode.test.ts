import { afterEach, describe, expect, it } from "vitest";

import { hasPermission } from "@/lib/auth/permissions";
import { isDemoMode, parseDemoRole } from "@/dev/demo/demo-mode";
import { DEMO_ROLE_BUNDLES, demoCases, demoEmployeesInScope, demoScopedTeams, demoSession, demoVisibility } from "@/mocks/demo";

import { SEED_CASE_IDS } from "../../scripts/seed-fixtures.mjs";

import { ROLE_GRANTS } from "./fixtures/role-grants";

/** Temporary demo without login — decision B-003. */
describe("demo mode without login (B-003)", () => {
  const original = { url: process.env.NEXT_PUBLIC_SUPABASE_URL, key: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY };
  afterEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = original.url;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = original.key;
    if (original.url === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (original.key === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  });

  it("is never active when a database is connected — login applies", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
    expect(isDemoMode()).toBe(false);
  });

  it("is active only when no database is configured", () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    expect(isDemoMode()).toBe(true);
  });

  it("falls back to Rådgiver for unknown role values", () => {
    expect(parseDemoRole(undefined)).toBe("advisor");
    expect(parseDemoRole("superadmin")).toBe("advisor");
    expect(parseDemoRole("leader")).toBe("leader");
  });

  it("uses exactly the role bundles from the migration", () => {
    expect(DEMO_ROLE_BUNDLES).toEqual(ROLE_GRANTS);
  });

  it("marks every demo session as demo and keeps role ≠ permission", () => {
    const admin = demoSession("administrator");
    expect(admin.demo).toEqual({ role: "administrator" });
    expect(hasPermission(admin.grants, "identity.user.manage")).toBe(true);
    expect(hasPermission(admin.grants, "analytics.team.read")).toBe(false);
    expect(hasPermission(demoSession("advisor").grants, "analytics.team.read")).toBe(false);
    expect(hasPermission(demoSession("leader").grants, "analytics.team.read")).toBe(true);
  });

  it("shows only own and assigned cases, like the database", () => {
    expect(demoCases("advisor").map((c) => c.id).sort()).toEqual([SEED_CASE_IDS.alfa, SEED_CASE_IDS.gamma].sort());
    expect(demoCases("administrator").map((c) => c.id)).toEqual([SEED_CASE_IDS.gamma]);
    expect(demoCases("leader")).toEqual([]);
  });

  it("gives the leader the scope incl. child teams and the advisor visible leaders", () => {
    const leader = demoSession("leader");
    const teams = demoScopedTeams("leader");
    expect(teams.map((team) => team.name)).toEqual(["Testteam Nord", "Testteam Nord · Hold A"]);
    expect(demoEmployeesInScope(teams, leader.user.id).map((e) => e.name)).toEqual(["Test Rådgiver A", "Test Rådgiver C"]);
    expect(new Set(demoVisibility("advisor").map((row) => row.leaderName))).toEqual(new Set(["Test Leder Nord", "Test Leder Syd"]));
  });
});
