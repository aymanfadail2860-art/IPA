import { beforeAll, describe, expect, it } from "vitest";

import { SEED_CASE_IDS, SEED_TEAM_IDS } from "../../../scripts/seed-fixtures.mjs";

import { anonClient, integrationConfigured, signedInClient, userIdOf, type SeedUserKey } from "./helpers";

/**
 * Database-level access control (RLS + SECURITY DEFINER functions), exercised through the
 * same Supabase REST API the application uses, signed in as the seed users.
 */
describe.skipIf(!integrationConfigured)("RLS and scopes against a real Supabase", () => {
  const ids: Record<SeedUserKey, string> = {} as Record<SeedUserKey, string>;

  beforeAll(async () => {
    for (const key of ["advisorA", "advisorB", "advisorC", "leaderNord", "leaderSyd", "admin"] as const) {
      ids[key] = await userIdOf(key);
    }
  });

  async function visibleUsers(key: SeedUserKey) {
    const client = await signedInClient(key);
    const { data, error } = await client.schema("identity").from("users").select("id");
    expect(error).toBeNull();
    return new Set((data ?? []).map((row) => row.id));
  }

  async function visibleTeams(key: SeedUserKey) {
    const client = await signedInClient(key);
    const { data, error } = await client.schema("identity").from("teams").select("id");
    expect(error).toBeNull();
    return new Set((data ?? []).map((row) => row.id));
  }

  async function visibleCases(key: SeedUserKey) {
    const client = await signedInClient(key);
    const { data, error } = await client.schema("advise").from("customer_cases").select("id");
    expect(error).toBeNull();
    return new Set((data ?? []).map((row) => row.id));
  }

  async function permissions(key: SeedUserKey) {
    const client = await signedInClient(key);
    const { data, error } = await client.schema("identity").rpc("my_permissions");
    expect(error).toBeNull();
    return new Set((data as { permission: string; scope: string }[]).map((row) => `${row.permission}:${row.scope}`));
  }

  describe("1. unauthenticated", () => {
    it("cannot read identity, cases or permissions", async () => {
      const anon = anonClient();
      const users = await anon.schema("identity").from("users").select("id");
      expect(users.data ?? []).toHaveLength(0);
      expect(users.error).not.toBeNull();
      const cases = await anon.schema("advise").from("customer_cases").select("id");
      expect(cases.data ?? []).toHaveLength(0);
      expect(cases.error).not.toBeNull();
      const perms = await anon.schema("identity").rpc("my_permissions");
      expect(perms.error).not.toBeNull();
    });
  });

  describe("2. rådgiver", () => {
    it("gets exactly the Rådgiver role's own-scoped permissions", async () => {
      expect(await permissions("advisorA")).toEqual(
        new Set([
          "advise.case.read:own",
          "advise.case.write:own",
          "assessment.result.read:own",
          "learning.progress.read:own",
          "practice.session.write:own",
        ]),
      );
    });

    it("sees only their own user row", async () => {
      expect(await visibleUsers("advisorA")).toEqual(new Set([ids.advisorA]));
    });

    it("sees only the teams they are a member of (multiple memberships)", async () => {
      expect(await visibleTeams("advisorA")).toEqual(new Set([SEED_TEAM_IDS.nordA, SEED_TEAM_IDS.syd]));
    });

    it("sees only cases they own or are assigned to", async () => {
      expect(await visibleCases("advisorA")).toEqual(new Set([SEED_CASE_IDS.alfa, SEED_CASE_IDS.gamma]));
      expect(await visibleCases("advisorB")).toEqual(new Set([SEED_CASE_IDS.alfa, SEED_CASE_IDS.beta]));
    });

    it("cannot read participants of a case they are not on", async () => {
      const client = await signedInClient("advisorA");
      const { data } = await client.schema("advise").rpc("case_participant_list", { p_case_id: SEED_CASE_IDS.beta });
      expect(data).toEqual([]);
    });

    it("cannot grant themselves a role (no privilege escalation)", async () => {
      const client = await signedInClient("advisorA");
      const { data: roles } = await client.schema("identity").from("roles").select("id, key").eq("key", "administrator");
      const { error } = await client.schema("identity").from("user_roles").insert({ user_id: ids.advisorA, role_id: roles![0].id });
      expect(error).not.toBeNull();
      expect(await permissions("advisorA")).not.toContain("identity.user.manage:all");
    });

    it("cannot give themselves a leader scope or join a team", async () => {
      const client = await signedInClient("advisorA");
      const scope = await client.schema("identity").from("leader_scopes").insert({ user_id: ids.advisorA, team_id: SEED_TEAM_IDS.erhverv });
      expect(scope.error).not.toBeNull();
      const membership = await client.schema("identity").from("team_memberships").insert({ user_id: ids.advisorA, team_id: SEED_TEAM_IDS.produkt });
      expect(membership.error).not.toBeNull();
    });

    it("cannot read other employees' data via the API", async () => {
      const client = await signedInClient("advisorA");
      const { data } = await client.schema("identity").from("users").select("id").eq("id", ids.advisorB);
      expect(data).toEqual([]);
      const { data: allowed } = await client.schema("identity").rpc("can_access_user_data", {
        p_permission: "learning.progress.read",
        p_subject_id: ids.advisorB,
      });
      expect(allowed).toBe(false);
      const logged = await client.schema("identity").rpc("log_individual_access", {
        p_subject_id: ids.advisorB,
        p_permission: "learning.progress.read",
      });
      expect(logged.error).not.toBeNull();
    });
  });

  describe("3. leder — team scope, child teams and limited scope", () => {
    it("Leder Nord (scope incl. child teams) sees Nord, Hold A and their members — not Syd", async () => {
      expect(await visibleTeams("leaderNord")).toEqual(new Set([SEED_TEAM_IDS.nord, SEED_TEAM_IDS.nordA]));
      expect(await visibleUsers("leaderNord")).toEqual(new Set([ids.leaderNord, ids.advisorA, ids.advisorC]));
    });

    it("Leder Syd (limited: no child teams) sees Syd's members — not Syd · Hold B", async () => {
      expect(await visibleTeams("leaderSyd")).toEqual(new Set([SEED_TEAM_IDS.syd]));
      const users = await visibleUsers("leaderSyd");
      expect(users).toEqual(new Set([ids.leaderSyd, ids.advisorA, ids.advisorB]));
      expect(users.has(ids.advisorC)).toBe(false);
    });

    it("a user in several teams is visible to each leader whose scope covers one of them", async () => {
      expect((await visibleUsers("leaderNord")).has(ids.advisorA)).toBe(true);
      expect((await visibleUsers("leaderSyd")).has(ids.advisorA)).toBe(true);
    });

    it("gets team-scoped permissions from the Leder role", async () => {
      const perms = await permissions("leaderNord");
      expect(perms).toContain("analytics.team.read:team");
      expect(perms).toContain("learning.progress.read:team");
      expect(perms).not.toContain("identity.user.manage:all");
    });

    it("never gets access to the team's customer cases through the role", async () => {
      expect(await visibleCases("leaderNord")).toEqual(new Set());
      const client = await signedInClient("leaderNord");
      const { data } = await client.schema("advise").from("customer_cases").select("id").eq("id", SEED_CASE_IDS.alfa);
      expect(data).toEqual([]);
    });

    it("can log individual access inside the scope and is refused outside it", async () => {
      const client = await signedInClient("leaderNord");
      const inside = await client.schema("identity").rpc("log_individual_access", {
        p_subject_id: ids.advisorA,
        p_permission: "learning.progress.read",
      });
      expect(inside.error).toBeNull();
      const outside = await client.schema("identity").rpc("log_individual_access", {
        p_subject_id: ids.advisorB,
        p_permission: "learning.progress.read",
      });
      expect(outside.error).not.toBeNull();
    });
  });

  describe("4. administrator", () => {
    it("manages identity but is not an 'admin sees everything' shortcut", async () => {
      const perms = await permissions("admin");
      expect(perms).toContain("identity.user.manage:all");
      expect(perms).not.toContain("analytics.team.read:team");
      expect(perms).not.toContain("analytics.team.read:all");
      expect((await visibleUsers("admin")).size).toBeGreaterThanOrEqual(6);
      expect((await visibleTeams("admin")).size).toBeGreaterThanOrEqual(6);
    });

    it("sees only their own and assigned cases (B-001)", async () => {
      expect(await visibleCases("admin")).toEqual(new Set([SEED_CASE_IDS.gamma]));
    });

    it("can assign and remove a role via identity.user.manage", async () => {
      const client = await signedInClient("admin");
      const { data: roles } = await client.schema("identity").from("roles").select("id").eq("key", "leader");
      const roleId = roles![0].id;
      const insert = await client.schema("identity").from("user_roles").insert({ user_id: ids.advisorC, role_id: roleId });
      expect(insert.error).toBeNull();
      const remove = await client.schema("identity").from("user_roles").delete().eq("user_id", ids.advisorC).eq("role_id", roleId);
      expect(remove.error).toBeNull();
      expect(await permissions("advisorC")).not.toContain("analytics.team.read:team");
    });
  });

  describe("case ownership and sharing", () => {
    it("a viewer cannot edit the case; an editor can", async () => {
      const viewer = await signedInClient("advisorB");
      const blocked = await viewer.schema("advise").from("customer_cases").update({ status: "closed" }).eq("id", SEED_CASE_IDS.alfa).select("id");
      expect(blocked.data ?? []).toHaveLength(0);

      const editor = await signedInClient("advisorA");
      const allowed = await editor.schema("advise").from("customer_cases").update({ status: "draft" }).eq("id", SEED_CASE_IDS.gamma).select("id");
      expect(allowed.error).toBeNull();
      expect(allowed.data).toHaveLength(1);
    });

    it("ownership cannot be changed by editing", async () => {
      const owner = await signedInClient("advisorA");
      const result = await owner.schema("advise").from("customer_cases").update({ owner_id: ids.advisorB }).eq("id", SEED_CASE_IDS.alfa);
      expect(result.error).not.toBeNull();
    });

    it("only the owner can share, and never as owner", async () => {
      const notOwner = await signedInClient("advisorB");
      const refused = await notOwner.schema("advise").from("case_participants").insert({ case_id: SEED_CASE_IDS.alfa, user_id: ids.advisorC, access_type: "viewer" });
      expect(refused.error).not.toBeNull();

      const owner = await signedInClient("advisorA");
      const asOwner = await owner.schema("advise").from("case_participants").insert({ case_id: SEED_CASE_IDS.alfa, user_id: ids.advisorC, access_type: "owner" });
      expect(asOwner.error).not.toBeNull();

      const shared = await owner.schema("advise").from("case_participants").insert({ case_id: SEED_CASE_IDS.alfa, user_id: ids.advisorC, access_type: "viewer" });
      expect(shared.error).toBeNull();
      expect((await visibleCases("advisorC")).has(SEED_CASE_IDS.alfa)).toBe(true);
      const unshared = await owner.schema("advise").from("case_participants").delete().eq("case_id", SEED_CASE_IDS.alfa).eq("user_id", ids.advisorC);
      expect(unshared.error).toBeNull();
      expect((await visibleCases("advisorC")).has(SEED_CASE_IDS.alfa)).toBe(false);
    });

    it("a new case can only be created with oneself as owner", async () => {
      const client = await signedInClient("advisorC");
      const forged = await client.schema("advise").from("customer_cases").insert({ company_name: "Testvirksomhed Forfalsket", owner_id: ids.advisorA });
      expect(forged.error).not.toBeNull();
    });
  });

  describe("transparency — Synlighed", () => {
    it("lists exactly the leaders whose scope covers the user, with their team permissions", async () => {
      const client = await signedInClient("advisorA");
      const { data, error } = await client.schema("identity").rpc("my_visibility");
      expect(error).toBeNull();
      const rows = data as { leader_name: string; permission: string }[];
      expect(new Set(rows.map((row) => row.leader_name))).toEqual(new Set(["Test Leder Nord", "Test Leder Syd"]));
      expect(new Set(rows.map((row) => row.permission))).toEqual(
        new Set(["analytics.team.read", "assessment.result.read", "learning.progress.read"]),
      );
    });

    it("does not list a leader whose scope excludes the user's child team", async () => {
      const client = await signedInClient("advisorC");
      const { data } = await client.schema("identity").rpc("my_visibility");
      const leaders = new Set((data as { leader_name: string }[]).map((row) => row.leader_name));
      expect(leaders).toEqual(new Set(["Test Leder Nord"]));
    });
  });
});
