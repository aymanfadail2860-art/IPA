import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { simplePdf } from "../fixtures/knowledge-pdfs";

import { env, integrationConfigured, signedInClient } from "./helpers";
import { RUN, runWorkerOnce, uploadVersion, workerConfigured } from "./knowledge-helpers";

/**
 * 8B-I3 — lease-capability under rigtig samtidighed (docs/08b §21.4). pgTAP kører i én
 * session; her sendes kaldene parallelt gennem PostgREST, så hvert kald er sin egen
 * transaktion. Lokalt kalder service-rollen workerens API via seedets udviklingsmedlemskab
 * af ingestion_worker (supabase/seed.sql) — aldrig i produktion.
 */

interface Claimed {
  job_id: string;
  version_id: string;
  lease_token: string;
}

describe.skipIf(!integrationConfigured || !workerConfigured)("ingestion worker leases under concurrency", () => {
  let worker: SupabaseClient;
  const versionIds = new Set<string>();
  const claimed: Claimed[] = [];

  beforeAll(async () => {
    // Earlier test files may leave ready jobs in the shared queue: the real worker drains it
    // first, so the parallel claims below meet only this test's jobs.
    await runWorkerOnce();
    const admin = await signedInClient("admin");
    for (const i of [1, 2, 3]) {
      const upload = await uploadVersion(admin, await simplePdf(`lease-${RUN}-${i}`), { title: `Lease ${i} ${RUN}` });
      versionIds.add(upload.versionId);
    }
    worker = createClient(env.url, process.env.SUPABASE_SERVICE_ROLE_KEY ?? "", { auth: { persistSession: false, autoRefreshToken: false } });
  }, 180_000);

  afterAll(async () => {
    // Testens egne jobs afsluttes som fejlet (kun testdata). Andre jobs, en parallel claim kan
    // have taget, frigives med genforsøg.
    for (const job of claimed) {
      await worker.schema("knowledge").rpc("worker_fail_job", {
        p_job_id: job.job_id,
        p_lease_token: job.lease_token,
        p_error_code: "test_cleanup",
        p_error_message: "Integrationstest af leases.",
        p_retryable: !versionIds.has(job.version_id),
      });
    }
  });

  it("gives every ready job to exactly one of many parallel claims, each with its own token", async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        worker.schema("knowledge").rpc("worker_claim_job", { p_worker: `lease-test-${RUN}-${i}`, p_lease_seconds: 60 }),
      ),
    );
    for (const result of results) {
      expect(result.error).toBeNull();
      claimed.push(...((result.data ?? []) as Claimed[]));
    }
    const jobIds = claimed.map((row) => row.job_id);
    expect(new Set(jobIds).size, "intet job tages to gange").toBe(jobIds.length);
    expect(new Set(claimed.map((row) => row.lease_token)).size, "hver lease har sit eget token").toBe(claimed.length);
    expect(claimed.every((row) => /^[0-9a-f]{64}$/.test(row.lease_token))).toBe(true);
    for (const versionId of versionIds) {
      expect(claimed.filter((row) => row.version_id === versionId), `version ${versionId}`).toHaveLength(1);
    }
  });

  it("lets exactly one of several parallel completions with the same token win; the rest are rejected", async () => {
    const target = claimed.find((row) => versionIds.has(row.version_id))!;
    const other = claimed.find((row) => row !== target && versionIds.has(row.version_id))!;
    const knowledge = worker.schema("knowledge");

    // A forged token and another job's token are rejected first, deterministically.
    const forged = await knowledge.rpc("worker_heartbeat", { p_job_id: target.job_id, p_lease_token: "0".repeat(64), p_lease_seconds: 60 });
    expect(forged.error?.code).toBe("55P03");
    const crossed = await knowledge.rpc("worker_heartbeat", { p_job_id: target.job_id, p_lease_token: other.lease_token, p_lease_seconds: 60 });
    expect(crossed.error?.code).toBe("55P03");

    const attempts = await Promise.all(
      Array.from({ length: 5 }, () =>
        knowledge.rpc("worker_fail_job", {
          p_job_id: target.job_id,
          p_lease_token: target.lease_token,
          p_error_code: "test_cleanup",
          p_error_message: "Parallel afslutning.",
          p_retryable: false,
        }),
      ),
    );
    const won = attempts.filter((result) => !result.error);
    expect(won).toHaveLength(1);
    expect(won[0]!.data).toBe("failed");
    expect(attempts.filter((result) => result.error).every((result) => result.error!.code === "55P03")).toBe(true);
    claimed.splice(claimed.indexOf(target), 1);
  });
});
