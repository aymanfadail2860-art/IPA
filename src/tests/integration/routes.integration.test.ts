import { createServerClient } from "@supabase/ssr";
import { describe, expect, it } from "vitest";

import { SEED_CASE_IDS } from "../../../scripts/seed-fixtures.mjs";

import { env, integrationConfigured, seedUser, type SeedUserKey } from "./helpers";

/**
 * Server-side authorization of the running application (IPA_APP_URL, e.g. `next start`
 * against the local Supabase). Signs in with real Supabase sessions and requests pages
 * directly — including URLs the user "should not know". Frontend hiding is not tested
 * here; what the server returns is.
 */
const configured = integrationConfigured && Boolean(env.appUrl);

const cookieCache = new Map<string, string>();

async function sessionCookie(key: SeedUserKey): Promise<string> {
  const cached = cookieCache.get(key);
  if (cached) return cached;
  const jar = new Map<string, string>();
  const supabase = createServerClient(env.url, env.anonKey, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (cookies) => {
        for (const { name, value } of cookies) jar.set(name, value);
      },
    },
  });
  const { error } = await supabase.auth.signInWithPassword({ email: seedUser(key).email, password: env.password });
  if (error) throw new Error(`Sign-in failed for ${key}: ${error.message}`);
  const header = [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
  cookieCache.set(key, header);
  return header;
}

async function get(path: string, key?: SeedUserKey) {
  const headers: Record<string, string> = {};
  if (key) headers.cookie = await sessionCookie(key);
  const response = await fetch(`${env.appUrl}${path}`, { headers, redirect: "manual" });
  const body = response.status === 200 ? await response.text() : "";
  return { status: response.status, location: response.headers.get("location") ?? "", body };
}

const DENIED = "Du har ikke adgang til dette område";
const CASE_DENIED = "Du har ikke adgang til denne sag";

describe.skipIf(!configured)("server-side route protection in the running app", () => {
  describe("1. unauthenticated user", () => {
    it.each(["/home", "/admin", "/admin/users", "/analytics", "/advise", `/advise/${SEED_CASE_IDS.alfa}`, "/profile"])(
      "%s redirects to /login",
      async (path) => {
        const response = await get(path);
        expect(response.status).toBeGreaterThanOrEqual(300);
        expect(response.status).toBeLessThan(400);
        expect(new URL(response.location, env.appUrl).pathname).toBe("/login");
      },
    );

    it("can reach the login page", async () => {
      const response = await get("/login");
      expect(response.status).toBe(200);
      expect(response.body).toContain("Log ind");
    });
  });

  describe("2. rådgiver", () => {
    it("reaches Home as themselves", async () => {
      const response = await get("/home", "advisorA");
      expect(response.status).toBe(200);
      expect(response.body).toContain("Test Rådgiver A");
    });

    it("does not get Admin by knowing the URL", async () => {
      for (const path of ["/admin", "/admin/users", "/admin/teams", "/admin/permissions"]) {
        const response = await get(path, "advisorA");
        expect(response.body, path).toContain(DENIED);
        expect(response.body, path).not.toContain("Dokumentpipeline");
        expect(response.body, path).not.toContain("Test Leder Nord");
      }
    });

    it("does not get Analytics or leader data by URL", async () => {
      const response = await get("/analytics", "advisorA");
      expect(response.body).toContain(DENIED);
      expect(response.body).not.toContain("Medarbejdere i dit scope");
    });

    it("does not see Admin or Analytics in the navigation", async () => {
      const response = await get("/home", "advisorA");
      expect(response.body).not.toContain('href="/admin"');
      expect(response.body).not.toContain('href="/analytics"');
    });

    it("opens own and assigned cases, never others'", async () => {
      expect((await get(`/advise/${SEED_CASE_IDS.alfa}`, "advisorA")).body).toContain("Testvirksomhed Alfa ApS");
      expect((await get(`/advise/${SEED_CASE_IDS.gamma}`, "advisorA")).body).toContain("Testvirksomhed Gamma A/S");
      const beta = await get(`/advise/${SEED_CASE_IDS.beta}`, "advisorA");
      expect(beta.body).toContain(CASE_DENIED);
      expect(beta.body).not.toContain("Testvirksomhed Beta ApS");
    });

    it("lists only own and assigned cases in Advise", async () => {
      const body = (await get("/advise", "advisorA")).body;
      expect(body).toContain("Testvirksomhed Alfa ApS");
      expect(body).not.toContain("Testvirksomhed Beta ApS");
    });
  });

  describe("3. leder", () => {
    it("Leder Nord sees exactly the employees in the scope incl. child teams", async () => {
      const response = await get("/analytics", "leaderNord");
      expect(response.status).toBe(200);
      expect(response.body).toContain("Test Rådgiver A");
      expect(response.body).toContain("Test Rådgiver C");
      expect(response.body).not.toContain("Test Rådgiver B");
    });

    it("Leder Syd (limited scope) does not see the child team's employee", async () => {
      const body = (await get("/analytics", "leaderSyd")).body;
      expect(body).toContain("Test Rådgiver A");
      expect(body).toContain("Test Rådgiver B");
      expect(body).not.toContain("Test Rådgiver C");
    });

    it("does not get Admin and does not get the team's cases", async () => {
      expect((await get("/admin", "leaderNord")).body).toContain(DENIED);
      const alfa = await get(`/advise/${SEED_CASE_IDS.alfa}`, "leaderNord");
      expect(alfa.body).toContain(CASE_DENIED);
      expect(alfa.body).not.toContain("Testvirksomhed Alfa ApS");
    });
  });

  describe("4. administrator", () => {
    it("reaches Admin and the identity sections from the database", async () => {
      expect((await get("/admin", "admin")).body).toContain("Dokumentpipeline");
      const users = (await get("/admin/users", "admin")).body;
      for (const name of ["Test Rådgiver A", "Test Rådgiver B", "Test Leder Nord", "Test Administrator"]) {
        expect(users).toContain(name);
      }
      expect((await get("/admin/permissions", "admin")).body).toContain("identity.user.manage");
    });

    it("does not get Analytics through the role ('efter rettigheder')", async () => {
      expect((await get("/analytics", "admin")).body).toContain(DENIED);
    });

    it("sees only own and assigned cases — no 'admin sees everything'", async () => {
      expect((await get(`/advise/${SEED_CASE_IDS.gamma}`, "admin")).body).toContain("Testvirksomhed Gamma A/S");
      expect((await get(`/advise/${SEED_CASE_IDS.alfa}`, "admin")).body).toContain(CASE_DENIED);
    });
  });

  it("sends a signed-in user away from /login", async () => {
    const response = await get("/login", "advisorB");
    expect(new URL(response.location, env.appUrl).pathname).toBe("/home");
  });
});
