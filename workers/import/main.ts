import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { runtimeEnv } from "../../src/lib/knowledge/core/grade.ts";

import { ApiError, ConfigProblem, createSupabaseApi, type SupabaseApi } from "./api.ts";
import { checkImport, directoryFolder, importStatus, listProducts, runImport, type CheckResult, type StatusResult } from "./importer.ts";
import { fileJournal } from "./journal.ts";
import { renderCheck, renderProducts, renderStatus } from "./report.ts";

/**
 * The administrator's document import (beta L3) — run in its container by
 * deploy/import/ipa-import.sh (docs/beta.md §15, runbook docs/import-runbook.md):
 *
 *   node workers/import/main.ts produkter    the products and document types for the import list
 *   node workers/import/main.ts kontroller   check the import list and the files; nothing changes
 *   node workers/import/main.ts upload       upload and register; the worker scans afterwards
 *   node workers/import/main.ts status       where each file is, and the proof that it is whole
 *
 * Configuration (the operator's environment; never the repository):
 *   IPA_IMPORT_SUPABASE_URL      the project's URL (https)
 *   IPA_IMPORT_PUBLISHABLE_KEY   the project's publishable/anon key (public; a secret key is refused)
 *   IPA_IMPORT_EMAIL             the operator's own administrator account
 *   IPA_IMPORT_PASSWORD          optional; otherwise asked for (not shown on screen)
 *   IPA_IMPORT_DIR               the import folder, read-only (default /import)
 *   IPA_IMPORT_REPORT_DIR        reports and the journal (default /reports)
 *
 * Exit codes: 0 done, 1 cannot run (configuration, login, rights, import list), 3 done with
 * files that were refused or failed (the report names them).
 */

const COMMANDS = ["produkter", "kontroller", "upload", "status"] as const;
type Command = (typeof COMMANDS)[number];

const env = process.env;
const command = process.argv[2] as Command | undefined;
const fail = (message: string): never => {
  process.stderr.write(`Fejl: ${message}\n`);
  process.exit(1);
};

/** Reads a password from the terminal without showing it. */
function askPassword(prompt: string): Promise<string> {
  const input = process.stdin;
  if (!input.isTTY) return Promise.reject(new ConfigProblem("Adgangskoden kan ikke spørges om uden en terminal. Start importen med ipa-import.sh."));
  process.stderr.write(prompt);
  return new Promise((resolve, reject) => {
    let value = "";
    input.setRawMode(true);
    input.resume();
    input.setEncoding("utf8");
    const done = (error?: Error) => {
      input.setRawMode(false);
      input.pause();
      input.removeListener("data", onData);
      process.stderr.write("\n");
      if (error) reject(error);
      else resolve(value);
    };
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === "\r" || char === "\n") return done();
        if (char === "\u0003") return done(new ConfigProblem("Afbrudt."));
        if (char === "\u007f" || char === "\b") value = value.slice(0, -1);
        else if (char >= " ") value += char;
      }
    };
    input.on("data", onData);
  });
}

async function saveReport(directory: string, name: string, at: Date, text: string, data: unknown): Promise<string> {
  await mkdir(directory, { recursive: true });
  const stamp = at.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const base = path.join(directory, `${name}-${stamp}`);
  await writeFile(`${base}.txt`, text, { mode: 0o600 });
  await writeFile(`${base}.json`, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  return `${base}.txt`;
}

async function signedIn(): Promise<SupabaseApi> {
  const environment = runtimeEnv(env.IPA_RUNTIME_ENV);
  const api = createSupabaseApi({
    url: env.IPA_IMPORT_SUPABASE_URL ?? "",
    publishableKey: env.IPA_IMPORT_PUBLISHABLE_KEY ?? "",
    allowHttp: environment === "local" || environment === "test",
  });
  const email = (env.IPA_IMPORT_EMAIL ?? "").trim();
  if (!email) throw new ConfigProblem("IPA_IMPORT_EMAIL mangler (din egen administratorkonto).");
  const password = env.IPA_IMPORT_PASSWORD || (await askPassword(`Adgangskode for ${email}: `));
  await api.signIn(email, password);
  const userId = await api.rpc<string | null>("identity", "current_user_id", {});
  if (!userId) throw new ConfigProblem("Kontoen er ikke aktiv på platformen.");
  return api;
}

async function main(): Promise<number> {
  if (!command || !(COMMANDS as readonly string[]).includes(command)) {
    process.stderr.write(`Brug: ${COMMANDS.join(" | ")}\n`);
    return 1;
  }
  const folderPath = env.IPA_IMPORT_DIR || "/import";
  const reportPath = env.IPA_IMPORT_REPORT_DIR || "/reports";
  const api = await signedIn();
  try {
    if (command === "produkter") {
      process.stdout.write(renderProducts(await listProducts(api)));
      return 0;
    }
    const canWrite = await api.rpc<boolean>("identity", "has_permission", { p_permission: "knowledge.document.write" });
    if (!canWrite) throw new ConfigProblem("Kontoen har ikke ret til at importere dokumenter (knowledge.document.write).");

    const deps = {
      api,
      folder: directoryFolder(folderPath),
      journal: fileJournal(reportPath),
      progress: (message: string) => process.stderr.write(`${message}\n`),
    };
    const at = new Date();
    if (command === "status") {
      const result: StatusResult = await importStatus(deps);
      const text = renderStatus(result, at);
      process.stdout.write(text);
      process.stdout.write(`\nRapporten er gemt: ${await saveReport(reportPath, "status", at, text, result)}\n`);
      return result.manifestErrors.length > 0 ? 1 : 0;
    }
    const result: CheckResult = command === "upload" ? await runImport(deps) : await checkImport(deps);
    const text = renderCheck(command === "upload" ? "Import" : "Kontrol af importen", result, at);
    process.stdout.write(text);
    process.stdout.write(`\nRapporten er gemt: ${await saveReport(reportPath, command === "upload" ? "import" : "kontrol", at, text, result)}\n`);
    if (result.manifestErrors.length > 0) return 1;
    return result.rows.some((row) => row.outcome === "invalid" || row.outcome === "failed") ? 3 : 0;
  } finally {
    await api.signOut();
  }
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    if (error instanceof ConfigProblem || error instanceof ApiError) fail(error.message);
    // Anything else: the class only — a message could carry data the operator did not type.
    fail(`Uventet fejl (${(error as { name?: string }).name ?? "Error"}). Intet er publiceret; kør kommandoen igen.`);
  },
);
