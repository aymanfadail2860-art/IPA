import { createServerClient } from "@supabase/ssr";
import { describe, expect, it } from "vitest";

import { env, integrationConfigured, seedUser, type SeedUserKey } from "./helpers";

/**
 * Fase 8 — AI Gateway i den kørende app (docs/08 §12–§13). Med en database er Copilot koblet på
 * gatewayen og viser ingen mock-samtaler. Udviklingsværktøjerne findes kun med
 * IPA_RUNTIME_ENV=local/test. Med IPA_RUNTIME_ENV=production (IPA_APP_URL_RETRIEVAL_OFF) nægter
 * registret stub-modellen, og Admin viser gatewayen som utilgængelig — en systemfejl.
 */

const jars = new Map<string, string>();
async function cookie(key: SeedUserKey): Promise<string> {
  const cached = jars.get(key);
  if (cached) return cached;
  const jar = new Map<string, string>();
  const supabase = createServerClient(env.url, env.anonKey, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (entries) => {
        for (const { name, value } of entries) jar.set(name, value);
      },
    },
  });
  const { error } = await supabase.auth.signInWithPassword({ email: seedUser(key).email, password: env.password });
  if (error) throw error;
  const header = [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
  jars.set(key, header);
  return header;
}

async function page(base: string, path: string, key: SeedUserKey) {
  const response = await fetch(`${base}${path}`, { headers: { cookie: await cookie(key) }, redirect: "manual" });
  return { status: response.status, body: await response.text() };
}

const offUrl = process.env.IPA_APP_URL_RETRIEVAL_OFF ?? "";

describe.skipIf(!integrationConfigured || !env.appUrl)("Copilot on the AI Gateway in the running app", () => {
  it("is connected to the gateway — no mock conversations next to real answers — with the marked development tools", async () => {
    for (const key of ["advisorA", "admin"] as const) {
      const copilot = await page(env.appUrl, "/copilot", key);
      expect(copilot.status, key).toBe(200);
      expect(copilot.body).toContain("Udviklingsversion: svarene dannes gennem AI Gateway af en stub-model uden AI");
      expect(copilot.body).toContain("Udviklingsværktøj — kun lokalt og i test");
      expect(copilot.body).toContain("Samtaler gemmes ikke i denne udviklingsversion.");
      for (const mock of ["Behandlingsskade under Erhvervsansvar", "Omsætningsgrænse for standardaccept", "Mock-svar"]) expect(copilot.body, mock).not.toContain(mock);
    }
  });

  it("shows the gateway's state to the administrator", async () => {
    const admin = await page(env.appUrl, "/admin", "admin");
    expect(admin.body).toContain("AI Gateway er tilgængelig.");
    expect(admin.body).toContain("Stub-model — ingen AI");
  });
});

describe.skipIf(!integrationConfigured || !offUrl)("the gateway in an app with IPA_RUNTIME_ENV=production", () => {
  it("refuses the stub — Admin shows a system error, and Copilot offers no development tools", async () => {
    const admin = await page(offUrl, "/admin", "admin");
    expect(admin.body).toContain("Copilot er utilgængelig");
    expect(admin.body).toContain("udviklingsimplementering");
    expect(admin.body).not.toContain("AI Gateway er tilgængelig.");
    const copilot = await page(offUrl, "/copilot", "admin");
    expect(copilot.status).toBe(200);
    expect(copilot.body).not.toContain("Udviklingsværktøj — kun lokalt og i test");
  });
});
