import { createServerClient } from "@supabase/ssr";
import { describe, expect, it } from "vitest";

import { SEED_CASE_IDS } from "../../../scripts/seed-fixtures.mjs";

import { env, integrationConfigured, seedUser, type SeedUserKey } from "./helpers";

/**
 * Server-side authorization of the running application (IPA_APP_URL, e.g. `next start`
 * against the local Supabase). Signs in with real Supabase sessions and requests pages
 * directly — including URLs the user "should not know". Frontend hiding is not tested
 * here; what the server returns is.
 *
 * Beta L2 (B-035, docs/beta.md §14): the running app with a database IS the beta, which does not
 * serve Advise, Analytics or Min profil — for anyone, whatever the permissions or the URL (404).
 * What those pages enforced underneath stays tested where it is decided, in the database
 * (rls.integration.test.ts: own and assigned cases only, no team cases for leaders, no "admin
 * sees everything", leader scopes incl. child teams, individual access logged inside the scope).
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
  const body = await response.text();
  return { status: response.status, location: response.headers.get("location") ?? "", body };
}

const DENIED = "Du har ikke adgang til dette område";
const NOT_FOUND = "Siden findes ikke";
/** Customer and employee data the hidden areas would show. */
const HIDDEN_DATA = ["Testvirksomhed Alfa ApS", "Testvirksomhed Beta ApS", "Testvirksomhed Gamma A/S", "Medarbejdere i dit scope", "Test Rådgiver C"];
const HIDDEN_PATHS = ["/advise", `/advise/${SEED_CASE_IDS.alfa}`, `/advise/${SEED_CASE_IDS.beta}`, `/advise/${SEED_CASE_IDS.gamma}`, "/analytics", "/profile"];

async function expectHidden(key: SeedUserKey) {
  for (const path of HIDDEN_PATHS) {
    const response = await get(path, key);
    expect(response.status, `${key} ${path}`).toBe(404);
    expect(response.body, `${key} ${path}`).toContain(NOT_FOUND);
    for (const data of HIDDEN_DATA) expect(response.body, `${key} ${path}`).not.toContain(data);
  }
}

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

    it("does not see Admin, Analytics, Advise or Min profil in the navigation", async () => {
      const response = await get("/home", "advisorA");
      expect(response.body).not.toContain('href="/admin"');
      expect(response.body).not.toContain('href="/analytics"');
      expect(response.body).not.toContain('href="/advise');
      expect(response.body).not.toContain('href="/profile"');
      // The four core modules stay.
      for (const core of ["/learn", "/copilot", "/practice", "/assessment"]) expect(response.body, core).toContain(`href="${core}"`);
    });

    it("beta: Advise, Analytics and Min profil are not served — not even their own cases (404, no data)", async () => {
      await expectHidden("advisorA");
    });

    it("the four core modules are served", async () => {
      for (const path of ["/learn", "/copilot", "/practice", "/assessment"]) expect((await get(path, "advisorA")).status, path).toBe(200);
    });
  });

  describe("3. leder", () => {
    it("beta: Analytics is not served even with analytics.team.read — the leader scope stays tested in the database", async () => {
      await expectHidden("leaderNord");
      await expectHidden("leaderSyd");
    });

    it("does not get Admin", async () => {
      expect((await get("/admin", "leaderNord")).body).toContain(DENIED);
    });

    it("beta: Home offers no way into Analytics, Advise or Min profil — also for a leader with team scope", async () => {
      const body = (await get("/home", "leaderNord")).body;
      for (const href of ['href="/analytics', 'href="/advise', 'href="/profile']) expect(body, href).not.toContain(href);
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

    it("beta: no hidden area through the role either (404)", async () => {
      await expectHidden("admin");
    });
  });

  it("sends a signed-in user away from /login", async () => {
    const response = await get("/login", "advisorB");
    expect(new URL(response.location, env.appUrl).pathname).toBe("/home");
  });
});
