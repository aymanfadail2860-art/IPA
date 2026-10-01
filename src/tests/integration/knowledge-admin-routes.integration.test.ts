import { createServerClient } from "@supabase/ssr";
import { beforeAll, describe, expect, it } from "vitest";

import { buildPdf, longListFixturePages } from "../fixtures/knowledge-pdfs";

import { env, integrationConfigured, seedUser, signedInClient, type SeedUserKey } from "./helpers";
import { RUN, runProduct, runWorkerOnce, uploadVersion, workerConfigured, type UploadedVersion } from "./knowledge-helpers";

/**
 * Fase 7, trin 8 — Knowledge Engine-administrationen i den kørende app (docs/07 §12). Siderne
 * kontrollerer selv permissions; rådgivere og ledere får hverken siderne eller indholdet,
 * heller ikke ved at kende URL'en.
 */
const configured = integrationConfigured && workerConfigured && Boolean(env.appUrl);

const cookies = new Map<string, string>();

async function sessionCookie(key: SeedUserKey): Promise<string> {
  const cached = cookies.get(key);
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
  if (error) throw new Error(`Sign-in failed for ${key}: ${error.message}`);
  const header = [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
  cookies.set(key, header);
  return header;
}

async function get(path: string, key?: SeedUserKey) {
  const headers: Record<string, string> = key ? { cookie: await sessionCookie(key) } : {};
  const response = await fetch(`${env.appUrl}${path}`, { headers, redirect: "manual" });
  return { status: response.status, location: response.headers.get("location") ?? "", body: response.status === 200 ? await response.text() : "" };
}

const DENIED = "Du har ikke adgang til dette område";
const NOT_FOUND = "Siden findes ikke";

describe.skipIf(!configured)("Knowledge administration in the running app", () => {
  let published: UploadedVersion;
  let processed: UploadedVersion;
  const title = `Rutebetingelser ${RUN}`;
  const productName = `Testprodukt Rute ${RUN} (fiktiv)`;
  let paths: string[];

  beforeAll(async () => {
    const admin = await signedInClient("admin");
    const productId = await runProduct(admin, "Rute");
    published = await uploadVersion(admin, await buildPdf(longListFixturePages(10, RUN)), { title, productId, versionLabel: "1", validFrom: "2024-01-01" });
    processed = await uploadVersion(admin, await buildPdf(longListFixturePages(12, RUN)), { documentId: published.documentId, versionLabel: "2", validFrom: "2030-01-01" });
    await runWorkerOnce();
    const knowledge = admin.schema("knowledge");
    expect((await knowledge.rpc("start_review", { p_version_id: published.versionId })).error).toBeNull();
    expect((await knowledge.rpc("approve_version", { p_version_id: published.versionId, p_acknowledged_warnings: [] })).error).toBeNull();
    paths = [
      "/admin",
      "/admin/products",
      `/admin/products/${productId}`,
      "/admin/documents",
      `/admin/documents/${published.documentId}`,
      `/admin/documents/${published.documentId}/versions/${published.versionId}`,
      `/admin/documents/${published.documentId}/versions/${processed.versionId}`,
      "/admin/knowledge-base",
      "/admin/knowledge-base/retrieval",
      "/admin/versions",
      "/admin/settings",
    ];
  }, 300_000);

  it("sends an unauthenticated user to the login page", async () => {
    for (const path of paths) {
      const response = await get(path);
      expect(response.status, path).toBeGreaterThanOrEqual(300);
      expect(new URL(response.location, env.appUrl).pathname, path).toBe("/login");
    }
  });

  it("refuses advisors and leaders every page — and never sends the document's content", async () => {
    for (const key of ["advisorA", "leaderSyd"] as const) {
      for (const path of paths) {
        const response = await get(path, key);
        expect(response.body, `${key} ${path}`).toContain(DENIED);
        expect(response.body, `${key} ${path}`).not.toContain(title);
        expect(response.body, `${key} ${path}`).not.toContain(RUN);
      }
    }
  });

  it("shows the administrator the document list, the document and its versions from the database", async () => {
    expect((await get("/admin/documents", "admin")).body).toContain(title);
    const document = await get(`/admin/documents/${published.documentId}`, "admin");
    expect(document.body).toContain(title);
    expect(document.body).toContain("Versioner");
    expect(document.body).toContain("Adgang");
    expect(document.body).toContain("Konflikter");
    expect((await get("/admin/products", "admin")).body).toContain(productName);
    expect((await get(`/admin/products/${published.documentId}`, "admin")).body).toContain(NOT_FOUND);
    expect((await get("/admin/versions", "admin")).body).toContain(title);
  });

  it("shows the review screen with the structure, the lead-in as context and the actions for the status", async () => {
    const review = await get(`/admin/documents/${published.documentId}/versions/${processed.versionId}`, "admin");
    expect(review.body).toContain("Kvalitetsrapport");
    expect(review.body).toContain("Påbegynd review");
    expect(review.body).toContain(`fiktiv undtagelse nummer 12, som kun findes i dette testdokument ${RUN}`);
    const active = await get(`/admin/documents/${published.documentId}/versions/${published.versionId}`, "admin");
    expect(active.body).toContain("Deaktivér");
    expect(active.body).not.toContain("Godkend som autoritativ");
  });

  it("shows the Knowledge Base with the conflict queue, gaps, coverage and the retrieval tool", async () => {
    const page = await get("/admin/knowledge-base", "admin");
    for (const text of ["Konfliktkø", "Huller i gyldigheden", "Dækning pr. produkt", "Registreres, når Copilot tages i brug", productName]) {
      expect(page.body, text).toContain(text);
    }
    const tool = await get("/admin/knowledge-base/retrieval", "admin");
    expect(tool.body).toContain("Afprøv retrieval");
    expect(tool.body).toContain("Gemmes ikke og logges ikke.");
  });

  it("shows the embedding settings read-only to system.settings.manage", async () => {
    const page = await get("/admin/settings", "admin");
    expect(page.body).toContain("Embedding");
    expect(page.body).toContain("test:test-hash-embedder@1");
  });

  it("answers an unknown document or version as not found", async () => {
    for (const path of [
      "/admin/documents/00000000-0000-4000-a000-00000000dead",
      `/admin/documents/${published.documentId}/versions/00000000-0000-4000-a000-00000000dead`,
      "/admin/documents/not-a-uuid",
    ]) {
      const response = await get(path, "admin");
      expect(response.body, path).toContain(NOT_FOUND);
      expect(response.body, path).not.toContain(title);
    }
  });
});
