// Module resolution for running the evaluation CLI directly with Node (type stripping).
//
// The engine imports the real retrieval pipeline from src/, which uses the "@/" path alias and
// extensionless imports (resolved by Next.js and Vitest). Node resolves neither, so this hook
// maps "@/x" to src/x and tries ".ts", ".tsx" and "/index.ts" for extensionless relative
// imports inside the repository. Development tooling only; no dependency needed.
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const src = path.join(root, "src");

function candidates(base) {
  return [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")];
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    let base = null;
    if (specifier.startsWith("@/")) base = path.join(src, specifier.slice(2));
    else if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.startsWith("file:")) {
      const parent = fileURLToPath(context.parentURL);
      if (parent.startsWith(root) && !parent.includes(`${path.sep}node_modules${path.sep}`)) base = path.resolve(path.dirname(parent), specifier);
    }
    if (base !== null && path.extname(base) === "") {
      const found = candidates(base).find((file) => file !== base && existsSync(file));
      if (found) return nextResolve(pathToFileURL(found).href, context);
    }
    if (base !== null && specifier.startsWith("@/")) return nextResolve(pathToFileURL(base).href, context);
    return nextResolve(specifier, context);
  },
});
