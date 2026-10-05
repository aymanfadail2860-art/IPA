import { inspectPdf } from "./pdf-inspect.ts";
import type { SecurityLimits } from "./limits.ts";

/**
 * The PDF security inspection in its own process (inspector.ts starts it): bounded heap
 * (--max-old-space-size), a wall-clock limit enforced by the parent, an EMPTY environment (no
 * database or storage credentials) and no file system writes. Input: the limits as JSON in
 * argv[2], the bytes on stdin. Output: one JSON line on stdout.
 */

const limits = JSON.parse(process.argv[2] ?? "{}") as SecurityLimits;
const parts: Buffer[] = [];
let size = 0;
for await (const chunk of process.stdin) {
  size += (chunk as Buffer).length;
  if (size > limits.maxBytes) {
    process.stdout.write(`${JSON.stringify({ pdfSecurity: { result: "fail", code: "resource_limit" }, activeContent: { result: "not_run", findings: [] }, pages: null })}\n`);
    process.exit(0);
  }
  parts.push(chunk as Buffer);
}
const result = inspectPdf(new Uint8Array(Buffer.concat(parts)), limits);
process.stdout.write(`${JSON.stringify(result)}\n`);
process.exit(0);
