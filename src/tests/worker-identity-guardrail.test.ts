import { execFile } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * 8B-I3 — guardrails for the production worker's identity (docs/08b §6.1.1, §21.4):
 *
 *   * The production worker design never needs service_role. The worker API is granted only to
 *     the role ingestion_worker; service_role reaches it only through the development seed.
 *   * No credentials in migrations or the seed: roles are created without a password, and
 *     passwords are set by operations from AWS Secrets Manager — never in the repo.
 *   * The worker refuses to start with the service-role key outside local/test.
 */

const root = path.resolve(__dirname, "../..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");
const migrationsDir = path.join(root, "supabase/migrations");
const migrations = readdirSync(migrationsDir)
  .filter((file) => file.endsWith(".sql"))
  .sort()
  .map((file) => ({ file, sql: readFileSync(path.join(migrationsDir, file), "utf8") }));
const I3 = "20261003000200_ingestion_worker_identity.sql";
const i3 = migrations.find((m) => m.file === I3)!.sql;
const after = (sql: string) => sql.replace(/--[^\n]*/g, "");

describe("worker identity guardrails (8B-I3)", () => {
  it("creates the roles without credentials and with no privileged attributes", () => {
    const code = after(i3);
    expect(code).toMatch(/create role %I nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls/);
    expect(code).toMatch(/create role %I nologin inherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls connection limit 5 password null/);
  });

  it("contains no password, connection string or key in any migration or the seed", () => {
    for (const { file, sql } of [...migrations, { file: "seed.sql", sql: read("supabase/seed.sql") }]) {
      const code = after(sql);
      expect(code, file).not.toMatch(/password\s+'/i);
      expect(code, file).not.toMatch(/encrypted\s+password/i);
      expect(code, file).not.toMatch(/SCRAM-SHA-256\$/);
      expect(code, file).not.toMatch(/postgres(ql)?:\/\/[^\s'"]*:[^\s'"]*@/i);
      expect(code, file).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/);
    }
  });

  it("grants the worker API only to ingestion_worker — never to service_role", () => {
    const code = after(i3);
    expect(code).toMatch(/execute format\('grant execute on function %s to ingestion_worker', v_fn\)/);
    // The only grant to service_role in I3 is ticket redemption (Edge Function contract).
    const serviceGrants = [...code.matchAll(/^\s*grant\s[^;]*;/gim)]
      .map((match) => match[0].trim().replace(/\s+/g, " "))
      .filter((statement) => /\bservice_role\b/.test(statement));
    expect(serviceGrants).toEqual(["grant execute on function knowledge.redeem_worker_storage_ticket(text) to service_role;"]);
    expect(code).toMatch(/from public, anon, authenticated, service_role;/);
  });

  it("gives service_role worker access only in the development seed, never in a migration", () => {
    for (const { file, sql } of migrations) {
      expect(after(sql), file).not.toMatch(/grant\s+ingestion_worker\s+to\s+[^;]*service_role/i);
    }
    const seed = read("supabase/seed.sql");
    expect(seed).toMatch(/DEVELOPMENT-ONLY/);
    expect(after(seed).trim()).toBe("grant ingestion_worker to service_role with inherit true, set false;");
  });

  it("checks the caller's real database identity in every worker function, not a parameter", () => {
    const code = after(i3);
    expect(code).toMatch(/current_setting\('role'\) = 'none' then session_user::text/);
    const definitions = [...code.matchAll(/create function (knowledge\.worker_[a-z_]+)\([\s\S]*?\n\$\$;/g)];
    expect(definitions.map((match) => match[1]).sort()).toEqual([
      "knowledge.worker_checkpoint",
      "knowledge.worker_chunks_to_embed",
      "knowledge.worker_claim_job",
      "knowledge.worker_complete_job",
      "knowledge.worker_embedding_models",
      "knowledge.worker_fail_job",
      "knowledge.worker_heartbeat",
      "knowledge.worker_issue_storage_ticket",
      "knowledge.worker_store_chunks",
      "knowledge.worker_store_embeddings",
      "knowledge.worker_store_pages",
      "knowledge.worker_verify_index",
    ]);
    for (const [definition, name] of definitions) {
      expect(definition, name).toMatch(/security definer\s+set search_path = ''/);
      expect(definition, name).toMatch(/perform knowledge\.assert_worker_caller\(\);/);
      if (name !== "knowledge.worker_claim_job" && name !== "knowledge.worker_embedding_models") {
        expect(definition, name).toMatch(/knowledge\.lease_job\(p_job_id, p_lease_token\)/);
      }
    }
  });

  it("keeps the service-role key out of the application code and the worker's production path", () => {
    const users: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(path.join(root, dir), { withFileTypes: true })) {
        const rel = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(rel);
        else if (/\.(ts|tsx|mjs|js)$/.test(entry.name) && read(rel).includes("SUPABASE_SERVICE_ROLE_KEY")) users.push(rel);
      }
    };
    walk("src");
    walk("workers");
    expect(users.sort()).toEqual([
      "src/tests/integration/ai-gateway.integration.test.ts",
      "src/tests/integration/ingestion-worker-lease.integration.test.ts",
      "src/tests/integration/knowledge-helpers.ts",
      "src/tests/integration/worker-runtime.integration.test.ts",
      "src/tests/worker-identity-guardrail.test.ts",
      "src/tests/worker-runtime-architecture.test.ts",
      "src/tests/worker-runtime.test.ts",
      // Names the key only to refuse it outside local/test (8B-I4).
      "workers/ingestion/config.ts",
    ]);
  });

  it("refuses to start the worker with the service-role key outside local/test", async () => {
    for (const value of ["production", "", "staging"]) {
      const result = await new Promise<{ code: number; stderr: string }>((resolve) => {
        execFile(
          process.execPath,
          ["workers/ingestion/main.ts", "--once"],
          {
            cwd: root,
            // An unroutable URL: the worker must stop before any network or database call.
            env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:9", SUPABASE_SERVICE_ROLE_KEY: "not-a-real-key", IPA_RUNTIME_ENV: value },
            timeout: 30_000,
          },
          (error, _stdout, stderr) => resolve({ code: error ? Number((error as { code?: number }).code ?? 1) : 0, stderr }),
        );
      });
      expect(result.code, `IPA_RUNTIME_ENV=${value}`).toBe(1);
      expect(result.stderr).toContain("service-rollen må kun bruges lokalt og i test");
    }
  });
});
