import fs from "node:fs";
import path from "node:path";

import { sha256 } from "./checksum.ts";
import type { FixtureDocument } from "./fixture-retrieval.ts";
import {
  EvalSetError,
  parseCasesJsonl,
  validateDeclaredConfiguration,
  validateEvalSet,
  validateGateSet,
  type DeclaredConfiguration,
} from "./schema.ts";
import type { EvalSet, GateSet } from "./types.ts";

/**
 * Reads the versioned evaluation files from evals/retrieval/ (docs/08b §5.1) and validates
 * them. Every file read is fingerprinted, so the run can check at the end that nothing on disk
 * changed while it ran (H7).
 */

export const EVALS_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "retrieval");

export interface LoadedInputs {
  set: EvalSet;
  gates: GateSet;
  declared: DeclaredConfiguration;
  fixtures: Record<string, FixtureDocument>;
  /** Re-reads every input file and reports the first one that changed, or null. */
  verifyUnchanged(): string | null;
}

function within(root: string, relative: string): string {
  const resolved = path.resolve(root, relative);
  if (!resolved.startsWith(root + path.sep)) throw new Error(`Stien ligger uden for ${root}: ${relative}`);
  return resolved;
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`${path.relative(process.cwd(), file)} kan ikke læses som JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function loadInputs(names: { set: string; gates: string; configuration: string }, root: string = EVALS_ROOT): LoadedInputs {
  const read = new Map<string, string>();
  const track = (file: string) => {
    read.set(file, sha256(fs.readFileSync(file, "utf8")));
    return file;
  };
  const name = /^[a-z0-9][a-z0-9_-]*$/;
  for (const [kind, value] of Object.entries(names)) if (!name.test(value)) throw new Error(`Ugyldigt navn for ${kind}: ${value}`);

  const manifest = readJson(track(within(root, `manifests/${names.set}.json`)));
  const { cases, errors } = parseCasesJsonl(fs.readFileSync(track(within(root, `cases/${names.set}.jsonl`)), "utf8"));
  if (errors.length > 0) throw new EvalSetError(errors);
  const set = validateEvalSet(manifest, cases);
  const gates = validateGateSet(readJson(track(within(root, `gates/${names.gates}.json`))));
  const declared = validateDeclaredConfiguration(readJson(track(within(root, `configurations/${names.configuration}.json`))));

  const fixtures: Record<string, FixtureDocument> = {};
  for (const document of set.manifest.documents) {
    if (document.source.kind !== "fixture") continue;
    fixtures[document.source.path] = readJson(track(within(root, document.source.path))) as FixtureDocument;
  }

  return {
    set,
    gates,
    declared,
    fixtures,
    verifyUnchanged() {
      for (const [file, checksum] of read) {
        if (!fs.existsSync(file) || sha256(fs.readFileSync(file, "utf8")) !== checksum) return `${path.relative(root, file)} ændrede sig under kørslen.`;
      }
      return null;
    },
  };
}
