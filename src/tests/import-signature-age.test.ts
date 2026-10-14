import { execFile } from "node:child_process";
import fs from "node:fs";
import { createServer, type AddressInfo, type Server } from "node:net";
import path from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { verifyScanner } from "../../scripts/verify-clamav-scanner.ts";
import { clamdScanner } from "../../workers/ingestion/security/scanner.ts";

/**
 * The document import refuses signatures older than 8 hours (beta L3, B-038; clarified 14 October
 * 2026). DETERMINISTIC: the scanner is a clamd-protocol fake whose signature time is set relative
 * to the clock, so the result never depends on when ClamAV last published its signatures.
 *
 * CI's import-scanner job runs the same check with --max-age-hours 24. That is test configuration
 * only: it proves the real scanner builds, starts and scans — and it may never reach the import,
 * the worker or any runtime configuration (the tests below fix that).
 */

const ROOT = path.resolve(__dirname, "../..");
const read = (file: string) => fs.readFileSync(path.join(ROOT, file), "utf8");
const run = promisify(execFile);
const HOUR = 3_600_000;
const servers: Server[] = [];
afterEach(() => servers.splice(0).forEach((server) => server.close()));

const clamdDate = (date: Date) => {
  const utc = date.toUTCString();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${utc.slice(0, 3)} ${utc.slice(8, 11)} ${String(date.getUTCDate()).padStart(2, " ")} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())} ${date.getUTCFullYear()}`;
};

/** A fake clamd with the approved engine: signatures `ageMs` old at the moment it is asked; finds EICAR. */
async function fakeScanner(ageMs: number): Promise<number> {
  const server = createServer((socket) => {
    let buffer = Buffer.alloc(0);
    socket.on("error", () => {});
    socket.on("data", (data) => {
      buffer = Buffer.concat([buffer, data]);
      const text = buffer.toString("latin1");
      if (text.startsWith("zVERSION\0")) return void socket.end(`ClamAV 1.4.6/27800/${clamdDate(new Date(Date.now() - ageMs))}\0`);
      if (text.startsWith("zINSTREAM\0") && buffer.subarray(-4).readUInt32BE(0) === 0) {
        socket.end(text.includes("EICAR-STANDARD-ANTIVIRUS-TEST-FILE") ? "stream: Win.Test.EICAR_HDB-1 FOUND\0" : "stream: OK\0");
      }
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return (server.address() as AddressInfo).port;
}

/** The import's own scanner check, exactly as deploy/import/ipa-import.sh calls it. */
function importCheckArguments(): string[] {
  const line = /dc run --rm -T --entrypoint node worker (scripts\/verify-clamav-scanner\.ts[^|\n]*?)\s*\|\|/.exec(read("deploy/import/ipa-import.sh"));
  expect(line, "the import's scanner check").not.toBeNull();
  return line![1]!.trim().split(/\s+/);
}

/** Runs the check as the import does — only the scanner's address is the fake's. */
async function importCheck(port: number): Promise<{ code: number; result: { ok: boolean; problems?: string[] } }> {
  const args = importCheckArguments().map((arg, i, all) => (all[i - 1] === "--host" ? "127.0.0.1" : all[i - 1] === "--port" ? String(port) : arg));
  try {
    const { stdout } = await run(process.execPath, args, { cwd: ROOT, env: { PATH: process.env.PATH ?? "", NODE_ENV: "test" } as NodeJS.ProcessEnv });
    return { code: 0, result: JSON.parse(stdout) };
  } catch (error) {
    const failed = error as { code: number; stdout: string };
    return { code: failed.code, result: JSON.parse(failed.stdout) };
  }
}

describe("the import refuses signatures older than 8 hours — independent of ClamAV's release times", () => {
  it("the import passes no age limit: the check's own default of 8 hours applies", () => {
    const args = importCheckArguments();
    expect(args).toEqual(["scripts/verify-clamav-scanner.ts", "--host", "clamav", "--port", "3310"]);
    expect(args).not.toContain("--max-age-hours");
    expect(read("scripts/verify-clamav-scanner.ts")).toMatch(/maxBuildAgeSeconds: Number\(arg\("max-age-hours", "8"\)\) \* 3600,/);
  });

  it("signatures 8 h 10 min old: the import's check refuses them (exit 1) — nothing would be uploaded", async () => {
    const { code, result } = await importCheck(await fakeScanner(8 * HOUR + 10 * 60_000));
    expect(code).toBe(1);
    expect(result).toEqual({ ok: false, problems: ["signatures are 8 h old (limit 8 h)"] });
  }, 30_000);

  it("signatures 7 h 50 min old: accepted — the approved engine, EICAR found, a clean file clean", async () => {
    const { code, result } = await importCheck(await fakeScanner(7 * HOUR + 50 * 60_000));
    expect(code).toBe(0);
    expect(result).toMatchObject({ ok: true, engineVersion: "1.4.6", signatureVersion: "27800", revision: "ipa-clamav:1.4.6-27800" });
  }, 30_000);

  it("the exact limit, with a fixed clock: 8 h is accepted, 8 h and one second is refused", async () => {
    const T0 = Date.parse("2026-10-14T06:00:00Z");
    const port = await (async () => {
      const server = createServer((socket) => {
        let buffer = Buffer.alloc(0);
        socket.on("data", (data) => {
          buffer = Buffer.concat([buffer, data]);
          const text = buffer.toString("latin1");
          if (text.startsWith("zVERSION\0")) return void socket.end(`ClamAV 1.4.6/27800/${clamdDate(new Date(T0))}\0`);
          if (text.startsWith("zINSTREAM\0") && buffer.subarray(-4).readUInt32BE(0) === 0) {
            socket.end(text.includes("EICAR-STANDARD-ANTIVIRUS-TEST-FILE") ? "stream: Win.Test.EICAR_HDB-1 FOUND\0" : "stream: OK\0");
          }
        });
      });
      servers.push(server);
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      return (server.address() as AddressInfo).port;
    })();
    const check = (ageMs: number) => verifyScanner(clamdScanner({ host: "127.0.0.1", port }), { expectedEngineVersion: "1.4.6", maxBuildAgeSeconds: 8 * 3600, now: () => T0 + ageMs });
    expect(await check(8 * HOUR)).toMatchObject({ ok: true, signatureAgeSeconds: 8 * 3600 });
    expect(await check(8 * HOUR + 1000)).toEqual({ ok: false, problems: ["signatures are 8 h old (limit 8 h)"] });
  });
});

describe("CI's 24-hour limit is test configuration only — it never reaches the import or the runtime", () => {
  const files = (dir: string): string[] =>
    fs.existsSync(path.join(ROOT, dir))
      ? fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? files(path.join(dir, entry.name)) : [path.join(dir, entry.name)]))
      : [];

  it("the only 24-hour override is the CI import-scanner step, after which the job still requires ok and the approved engine", () => {
    const ci = read(".github/workflows/ci.yml");
    expect(ci.match(/--max-age-hours \d+/g)).toEqual(["--max-age-hours 24"]);
    const job = ci.slice(ci.indexOf("  import-scanner:"));
    expect(job).toContain("worker scripts/verify-clamav-scanner.ts --host clamav --port 3310 --max-age-hours 24 | tee \"$RUNNER_TEMP/scanner-check.json\"");
    expect(job).toContain("jq -e '.ok == true and .engineVersion == \"1.4.6\"' \"$RUNNER_TEMP/scanner-check.json\"");
    // Still the real scanner, built without cache from the official signatures, and its isolation.
    expect(job).toContain("docker compose -f deploy/import/compose.yaml build --no-cache clamav");
    expect(job).toContain("docker compose -f deploy/import/compose.yaml up -d --wait clamav");
    expect(job).toContain("docker network inspect ipa-import_scan | jq -e '.[0].Internal == true'");
    // The engine-candidate workflow keeps 8 hours.
    expect(read(".github/workflows/clamav-engine-candidate.yml").match(/--max-age-hours \d+/g)).toEqual(["--max-age-hours 8"]);
  });

  it("no runtime file, deploy file, operator script or application code sets an age limit", () => {
    const runtime = [...files("deploy"), ...files("workers"), ...files("src/lib"), ...files("src/app"), ...files("scripts"), ...files("supabase")].filter((file) => !file.endsWith("verify-clamav-scanner.ts"));
    const offenders = runtime.filter((file) => /max-age-hours|maxBuildAgeSeconds|MAX_AGE_HOURS/.test(read(file)));
    expect(offenders).toEqual([]);
    // The check takes the limit from its arguments only — no environment variable can change it.
    expect(read("scripts/verify-clamav-scanner.ts")).not.toMatch(/process\.env/);
  });

  it("the worker's own runtime rule is unchanged: the database's security policy (24 hours) decides, not CI", () => {
    // The worker refuses a scan with stale signatures using the active policy from the database.
    expect(read("workers/ingestion/security/scan.ts")).toMatch(/signatureAgeProblem\(info\.signatureTime, context\.max_signature_age_seconds, now\(\)\)/);
    const policy = /insert into knowledge\.security_policies \(version, active, max_signature_age, limits, description\) values \(\s*'[^']+',\s*true,\s*interval '([^']+)'/.exec(read("supabase/migrations/20261005000100_upload_security.sql"));
    expect(policy?.[1]).toBe("24 hours");
  });
});
