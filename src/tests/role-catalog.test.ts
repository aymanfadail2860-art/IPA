import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import type { PermissionKey } from "@/lib/auth/permissions";

import { ROLE_GRANTS } from "./fixtures/role-grants";

const sql = fs.readFileSync(path.resolve(__dirname, "../../supabase/migrations/20260929000200_identity_catalog.sql"), "utf8");

describe("permission catalogue in the database (docs/03 §10)", () => {
  it("contains exactly the twelve permissions of docs/03 §10 — none invented", () => {
    const keys = [...sql.matchAll(/\('([a-z_.]+)', '[^']*', array\[/g)].map((match) => match[1]).sort();
    const expected: PermissionKey[] = [
      "advise.case.read",
      "advise.case.write",
      "analytics.team.read",
      "assessment.result.read",
      "identity.user.manage",
      "knowledge.document.read",
      "knowledge.document.read_historical",
      "knowledge.document.write",
      "knowledge.version.publish",
      "learning.progress.read",
      "practice.session.write",
      "system.settings.manage",
    ];
    expect(keys).toEqual(expected.sort());
  });

  it("defines exactly the three locked roles", () => {
    const rolesBlock = sql.slice(sql.indexOf("insert into identity.roles"), sql.indexOf(";", sql.indexOf("insert into identity.roles")));
    const roles = [...rolesBlock.matchAll(/\('([a-z_]+)', '[^']+', '[^']+'\)/g)].map((m) => m[1]);
    expect(roles.sort()).toEqual(["administrator", "advisor", "leader"]);
  });

  it("matches the role bundles the tests use", () => {
    const rows = [...sql.matchAll(/\('(advisor|leader|administrator)', '([a-z_.]+)', '(own|team|all)'\)/g)];
    for (const role of ["advisor", "leader", "administrator"] as const) {
      const fromSql = rows.filter((row) => row[1] === role).map((row) => `${row[2]}:${row[3]}`).sort();
      const fromFixture = ROLE_GRANTS[role].map((grant) => `${grant.key}:${grant.scope}`).sort();
      expect(fromSql, role).toEqual(fromFixture);
    }
  });

  it("gives case access 'own' to every role (B-001) and no role an 'all' scope on cases", () => {
    for (const role of ["advisor", "leader", "administrator"] as const) {
      expect(ROLE_GRANTS[role]).toContainEqual({ key: "advise.case.read", scope: "own" });
      expect(ROLE_GRANTS[role].some((grant) => grant.key.startsWith("advise.") && grant.scope !== "own")).toBe(false);
    }
  });

  it("does not give Leder administrative permissions (KRAV-ROL-002)", () => {
    const leaderKeys = ROLE_GRANTS.leader.map((grant) => grant.key);
    for (const key of ["identity.user.manage", "system.settings.manage", "knowledge.document.write", "knowledge.version.publish"]) {
      expect(leaderKeys).not.toContain(key);
    }
  });
});
