import { execFile } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * Beta L3 — the operator's script deploy/import/ipa-import.sh, run against a fake `docker` that
 * records every call: the order of the steps, the stop on a failed scanner check or a failed
 * import, the settings file's rules, and that no password ever appears on a command line.
 */

const ROOT = path.resolve(__dirname, "../..");
const SCRIPT = path.join(ROOT, "deploy/import/ipa-import.sh");
const FAKE_DOCKER = `#!/bin/sh
# Records the call and whether the passwords reached this process's environment.
printf '%s|import=%s|worker=%s\\n' "$*" "\${IPA_IMPORT_PASSWORD:+set}" "\${IPA_WORKER_DB_PASSWORD:-}" >> "$FAKE_LOG"
case "$*" in
  *"$FAKE_FAIL"*) [ -n "$FAKE_FAIL" ] && exit "\${FAKE_CODE:-1}" ;;
esac
exit 0
`;

let directory = "";
let settings = "";
let log = "";

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "ipa-import-script-"));
  await writeFile(path.join(directory, "docker"), FAKE_DOCKER);
  await chmod(path.join(directory, "docker"), 0o755);
  settings = path.join(directory, "ipa-import.env");
  await writeFile(settings, await readFile(path.join(ROOT, "deploy/import/ipa-import.env.example"), "utf8"));
  await chmod(settings, 0o600);
  log = path.join(directory, "docker.log");
  await writeFile(log, "");
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

function script(args: string[], extra: Record<string, string> = {}): Promise<{ code: number; stderr: string; calls: string[] }> {
  // Only what the script needs — nothing of the test process's own environment.
  const environment: Record<string, string> = { PATH: `${directory}:/usr/bin:/bin`, HOME: directory, IPA_IMPORT_ENV_FILE: settings, FAKE_LOG: log, ...extra };
  return new Promise((resolve) => {
    execFile(
      "bash",
      [SCRIPT, ...args],
      {
        env: environment as NodeJS.ProcessEnv,
        encoding: "utf8",
        timeout: 30_000,
      },
      async (error, _stdout, stderr) => {
        const calls = (await readFile(log, "utf8")).split("\n").filter(Boolean);
        resolve({ code: error ? Number((error as { code?: number }).code ?? 1) : 0, stderr, calls });
      },
    );
  });
}

const PASSWORDS = { IPA_IMPORT_PASSWORD: "operatorens-hemmelighed-1", IPA_WORKER_DB_PASSWORD: "workerens-hemmelighed-12345" };
const compose = (call: string) => call.replace(/^compose --env-file \S+ -f \S+ /, "").split("|")[0];

describe("the operator script (deploy/import/ipa-import.sh)", () => {
  it("importer: checks the scanner, uploads, scans and extracts, reports — in that order, passwords only in the environment", async () => {
    const result = await script(["importer"], PASSWORDS);
    expect(result.code, result.stderr).toBe(0);
    expect(result.calls.map(compose)).toEqual([
      "info",
      "up -d --wait clamav",
      "run --rm -T --entrypoint node worker scripts/verify-clamav-scanner.ts --host clamav --port 3310",
      "run --rm import upload",
      "run --rm worker",
      "run --rm import status",
    ]);
    for (const call of result.calls) {
      expect(call).not.toContain(PASSWORDS.IPA_IMPORT_PASSWORD);
      expect(call.split("|")[0]).not.toContain(PASSWORDS.IPA_WORKER_DB_PASSWORD);
    }
    // The worker's password reaches the run that starts the worker.
    expect(result.calls.find((call) => call.includes("run --rm worker"))).toContain(`worker=${PASSWORDS.IPA_WORKER_DB_PASSWORD}`);
    expect(result.calls.every((call) => call.startsWith("info") || call.startsWith(`compose --env-file ${settings} -f ${path.join(ROOT, "deploy/import/compose.yaml")} `))).toBe(true);
  });

  it("a failed scanner check stops the import before anything is uploaded", async () => {
    const result = await script(["importer"], { ...PASSWORDS, FAKE_FAIL: "verify-clamav-scanner" });
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/Scannerkontrollen fejlede/);
    expect(result.calls.map(compose)).not.toContain("run --rm import upload");
  });

  it("an import that cannot run stops before the worker; refused files (code 3) do not stop the others", async () => {
    const cannot = await script(["importer"], { ...PASSWORDS, FAKE_FAIL: "import upload", FAKE_CODE: "1" });
    expect(cannot.code).toBe(1);
    expect(cannot.calls.map(compose)).not.toContain("run --rm worker");
    await writeFile(log, "");
    const partly = await script(["importer"], { ...PASSWORDS, FAKE_FAIL: "import upload", FAKE_CODE: "3" });
    expect(partly.code).toBe(0);
    expect(partly.calls.map(compose).slice(-2)).toEqual(["run --rm worker", "run --rm import status"]);
  });

  it("forbered builds the scanner without cache (fresh signatures), then verifies it — without the worker's password", async () => {
    const result = await script(["forbered"]);
    expect(result.code, result.stderr).toBe(0);
    expect(result.calls.map(compose)).toEqual(["info", "build --no-cache clamav", "build worker", "up -d --wait clamav", "run --rm -T --entrypoint node worker scripts/verify-clamav-scanner.ts --host clamav --port 3310"]);
    // A placeholder the worker would refuse (shorter than 16 characters) — never a real password.
    expect(result.calls.filter((call) => call.startsWith("compose")).every((call) => call.endsWith("|import=|worker=ikke-brugt"))).toBe(true);
  });

  it("refuses a missing settings file, one others can read, and one holding a password", async () => {
    expect((await script(["status"], { ...PASSWORDS, IPA_IMPORT_ENV_FILE: path.join(directory, "mangler.env") })).stderr).toMatch(/findes ikke/);
    await chmod(settings, 0o644);
    const open = await script(["status"], PASSWORDS);
    expect(open.code).toBe(1);
    expect(open.stderr).toMatch(/chmod 600/);
    await chmod(settings, 0o600);
    for (const line of ["IPA_WORKER_DB_PASSWORD=x", "export IPA_IMPORT_PASSWORD=x", "SUPABASE_SERVICE_ROLE_KEY=x", "IPA_SOMETHING_SECRET=x"]) {
      await writeFile(settings, `IPA_IMPORT_EMAIL=a@b.dk\n${line}\n`);
      const refused = await script(["status"], PASSWORDS);
      expect(refused.code, line).toBe(1);
      expect(refused.stderr, line).toMatch(/må ikke indeholde adgangskoder/);
    }
    expect((await readFile(log, "utf8")).split("\n").filter((call) => call.startsWith("compose"))).toEqual([]);
  });

  it("an unknown step does nothing", async () => {
    const result = await script(["slet-alt"], PASSWORDS);
    expect(result.code).toBe(1);
    expect(result.calls.map(compose)).toEqual(["info"]);
  });
});
