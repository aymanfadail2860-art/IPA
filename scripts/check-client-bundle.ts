/**
 * Beta L4 (docs/beta.md §16.3): the Anthropic API key never reaches the browser.
 *
 * Scans what the built app delivers to a browser — the client bundles (.next/static) and the
 * prerendered pages and payloads (.next/server/app/**: .html, .rsc, .body) — for the key's value
 * (a sentinel the CI build sets in place of a real key), the variable's name, the API host and the
 * SDK. Exit 0 when none is found, 1 when one is, 2 when there is no build to scan.
 *
 *   IPA_BUNDLE_SENTINEL=<the value the build had as its key> node scripts/check-client-bundle.ts [.next]
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

export const BUNDLE_MARKERS = ["IPA_ANTHROPIC_API_KEY", "api.anthropic.com", "@anthropic-ai/sdk"] as const;

function walk(dir: string, keep: (file: string) => boolean, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, keep, out);
    else if (keep(full)) out.push(full);
  }
  return out;
}

/** The files a browser can receive. Throws when there is no build. */
export function clientFiles(buildDir: string): string[] {
  const statics = path.join(buildDir, "static");
  if (!statSync(statics, { throwIfNoEntry: false })?.isDirectory()) throw new Error(`Ingen build at kontrollere i ${buildDir}.`);
  const pages = path.join(buildDir, "server", "app");
  return [
    ...walk(statics, (file) => /\.(js|css|json|html|txt|map)$/.test(file)),
    ...(statSync(pages, { throwIfNoEntry: false })?.isDirectory() ? walk(pages, (file) => /\.(html|rsc|body)$/.test(file)) : []),
  ];
}

/** Every (file, marker) where a marker or the sentinel occurs. */
export function findInClientBundle(buildDir: string, sentinel: string | null): { file: string; marker: string }[] {
  const markers = [...BUNDLE_MARKERS, ...(sentinel ? [sentinel] : [])];
  return clientFiles(buildDir).flatMap((file) => {
    const text = readFileSync(file, "utf8");
    return markers.filter((marker) => text.includes(marker)).map((marker) => ({ file, marker: marker === sentinel ? "<nøglens værdi>" : marker }));
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const buildDir = process.argv[2] ?? ".next";
  const sentinel = process.env.IPA_BUNDLE_SENTINEL?.trim() || null;
  try {
    const files = clientFiles(buildDir);
    const found = findInClientBundle(buildDir, sentinel);
    if (found.length > 0) {
      for (const { file, marker } of found) console.error(`Fundet i browserens filer: ${marker} (${file})`);
      process.exit(1);
    }
    console.log(`Browserens filer er kontrolleret (${files.length} filer${sentinel ? ", inkl. nøglens værdi" : ""}): ingen API-nøgle, intet SDK, ingen API-adresse.`);
  } catch (error) {
    console.error((error as Error).message);
    process.exit(2);
  }
}
