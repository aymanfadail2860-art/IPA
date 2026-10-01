import { beforeAll, describe, expect, it } from "vitest";

import { SEED_TEAM_IDS } from "../../../scripts/seed-fixtures.mjs";
import { buildPdf, partlyScannedFixturePages, termsFixturePages } from "../fixtures/knowledge-pdfs";

import { integrationConfigured, signedInClient, type SeedUserKey } from "./helpers";
import { RUN, runWorkerOnce, uploadVersion, versionRow, workerConfigured, type UploadedVersion } from "./knowledge-helpers";

/**
 * Fase 7, trin 5 — fra upload til autoritativ viden og tilbage (docs/07 §2.2, §3), med den
 * rigtige worker og rigtige brugersessioner. Kun "Godkend som autoritativ" gør en version
 * synlig for rådgivere, og kun for dem, der har en tildeling.
 */

function today(offsetDays = 0): string {
  const date = new Date(Date.now() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Copenhagen" }).format(date);
}

async function visibleVersions(key: SeedUserKey, documentId: string): Promise<string[]> {
  const client = (await signedInClient(key)).schema("knowledge");
  const { data } = await client.from("document_versions").select("version_label").eq("document_id", documentId).order("version_label");
  return (data ?? []).map((row) => row.version_label as string);
}

async function rpc(key: SeedUserKey, fn: string, args: Record<string, unknown>) {
  return (await signedInClient(key)).schema("knowledge").rpc(fn, args);
}

describe.skipIf(!integrationConfigured || !workerConfigured)("review and approval end to end", () => {
  let v1: UploadedVersion;
  let v2: UploadedVersion;
  let v3: UploadedVersion;
  let partly: UploadedVersion;
  const future = today(60);

  beforeAll(async () => {
    const admin = await signedInClient("admin");
    v1 = await uploadVersion(admin, await buildPdf(termsFixturePages()), { title: `Reviewbetingelser ${RUN}`, versionLabel: "1", validFrom: "2020-01-01" });
    partly = await uploadVersion(admin, await buildPdf(partlyScannedFixturePages()), { title: `Delvist læst ${RUN}`, versionLabel: "1" });
    // Read access for the members of Testteam Syd (not its child team).
    const { error } = await admin.schema("knowledge").from("document_access_grants").insert({
      document_id: v1.documentId,
      permission_key: "knowledge.document.read",
      grantee_type: "team",
      team_id: SEED_TEAM_IDS.syd,
      include_descendants: false,
    });
    if (error) throw error;
    await runWorkerOnce();
  }, 180_000);

  it("keeps a processed version invisible until it is approved", async () => {
    expect((await versionRow(await signedInClient("admin"), v1.versionId))?.status).toBe("processed");
    expect(await visibleVersions("advisorA", v1.documentId)).toEqual([]);
  });

  it("does not let advisors or leaders review or approve", async () => {
    for (const key of ["advisorA", "leaderSyd"] as const) {
      expect((await rpc(key, "start_review", { p_version_id: v1.versionId })).error?.code, key).toBe("42501");
      expect((await rpc(key, "approve_version", { p_version_id: v1.versionId })).error?.code, key).toBe("42501");
    }
  });

  it("publishes on 'Godkend som autoritativ' — visible only to the members of the granted team", async () => {
    expect((await rpc("admin", "start_review", { p_version_id: v1.versionId })).error).toBeNull();
    const { data: state } = await rpc("admin", "review_state", { p_version_id: v1.versionId });
    expect(state).toMatchObject({ can_approve: true, blockers: [] });
    expect((await rpc("admin", "approve_version", { p_version_id: v1.versionId, p_acknowledged_warnings: [] })).error).toBeNull();
    expect((await versionRow(await signedInClient("admin"), v1.versionId))?.status).toBe("published");

    expect(await visibleVersions("advisorA", v1.documentId)).toEqual(["1"]); // member of Syd
    expect(await visibleVersions("leaderSyd", v1.documentId)).toEqual(["1"]); // member of Syd
    expect(await visibleVersions("advisorC", v1.documentId)).toEqual([]); // only in Syd's child team
    expect(await visibleVersions("leaderNord", v1.documentId)).toEqual([]);

    const advisor = (await signedInClient("advisorA")).schema("knowledge");
    const { count } = await advisor.from("document_chunks").select("id", { count: "exact", head: true }).eq("document_version_id", v1.versionId);
    expect(count).toBeGreaterThan(0);
    const { data: reviews } = await advisor.from("version_reviews").select("id").eq("version_id", v1.versionId);
    expect(reviews).toEqual([]);
  });

  it("publishes a future version at once and supersedes the current one from its valid-from date", async () => {
    const admin = await signedInClient("admin");
    v2 = await uploadVersion(admin, await buildPdf(termsFixturePages()), { documentId: v1.documentId, versionLabel: "2", validFrom: future });
    await runWorkerOnce();
    expect((await rpc("admin", "start_review", { p_version_id: v2.versionId })).error).toBeNull();
    const { data: state } = await rpc("admin", "review_state", { p_version_id: v2.versionId });
    expect((state as { warnings: { code: string }[] }).warnings.map((warning) => warning.code)).toContain("predecessor_superseded");
    expect((await rpc("admin", "approve_version", { p_version_id: v2.versionId, p_acknowledged_warnings: ["predecessor_superseded"] })).error).toBeNull();

    const previous = await versionRow(admin, v1.versionId);
    expect(previous).toMatchObject({ status: "published", valid_to: future, superseded_by: v2.versionId });
    // v1 is still current until v2's date; v2 is future knowledge, visible with read access.
    expect(await visibleVersions("advisorA", v1.documentId)).toEqual(["1", "2"]);
  });

  it("blocks approval of a partly read PDF with an explanation", async () => {
    expect((await versionRow(await signedInClient("admin"), partly.versionId))?.status).toBe("processed");
    await rpc("admin", "start_review", { p_version_id: partly.versionId });
    const { error } = await rpc("admin", "approve_version", { p_version_id: partly.versionId });
    expect(error?.code).toBe("23514");
    expect(error?.message).toMatch(/Ikke alle sider er læst/);
  });

  it("rejects with a reason, and a rejected version can be reprocessed by the worker", async () => {
    const admin = await signedInClient("admin");
    v3 = await uploadVersion(admin, await buildPdf(termsFixturePages()), { documentId: v1.documentId, versionLabel: "3", validFrom: today(400) });
    await runWorkerOnce();
    await rpc("admin", "start_review", { p_version_id: v3.versionId });
    expect((await rpc("admin", "reject_version", { p_version_id: v3.versionId, p_reason: "" })).error?.code).toBe("23514");
    expect((await rpc("admin", "reject_version", { p_version_id: v3.versionId, p_reason: "Fiktiv fejl i teksten." })).error).toBeNull();
    expect((await versionRow(admin, v3.versionId))?.status).toBe("rejected");
    const { data: reviews } = await admin.schema("knowledge").from("version_reviews").select("decision, reason").eq("version_id", v3.versionId);
    expect(reviews).toEqual([{ decision: "rejected", reason: "Fiktiv fejl i teksten." }]);

    expect((await rpc("admin", "request_reprocess", { p_version_id: v3.versionId })).error).toBeNull();
    await runWorkerOnce();
    expect((await versionRow(admin, v3.versionId))?.status).toBe("processed");
    expect(await visibleVersions("advisorA", v1.documentId)).toEqual(["1", "2"]);
  });

  it("withdraws a published version from every reader at once", async () => {
    expect((await rpc("admin", "withdraw_version", { p_version_id: v1.versionId, p_category: "invalid", p_reason: "Fiktiv faglig fejl." })).error).toBeNull();
    expect(await visibleVersions("advisorA", v1.documentId)).toEqual(["2"]);
    const advisor = (await signedInClient("advisorA")).schema("knowledge");
    const { count } = await advisor.from("document_chunks").select("id", { count: "exact", head: true }).eq("document_version_id", v1.versionId);
    expect(count).toBe(0);
    expect((await versionRow(await signedInClient("admin"), v1.versionId))?.status).toBe("withdrawn");
  });
});
