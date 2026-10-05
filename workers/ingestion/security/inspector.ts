import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import type { SecurityLimits } from "./limits.ts";
import type { InspectionResult } from "./pdf-inspect.ts";

/**
 * Runs the PDF security inspection in a child process (inspect-child.ts) so that a malicious
 * or simply pathological PDF cannot exhaust the worker (docs/08b §21.6):
 *
 *   * heap capped with --max-old-space-size; the wall clock with a hard SIGKILL;
 *   * an EMPTY environment — the child never sees database, storage or AWS credentials;
 *   * bytes go over stdin and the result comes back over stdout: no temporary files.
 *
 * A timeout, a crash, out-of-memory or unreadable output is never "passed".
 */

export interface PdfInspector {
  inspect(bytes: Uint8Array, limits: SecurityLimits): Promise<InspectionResult>;
}

const CHILD = fileURLToPath(new URL("./inspect-child.ts", import.meta.url));

const failed = (result: "fail" | "error", code: "inspection_timeout" | "inspection_failed" | "resource_limit"): InspectionResult => ({
  pdfSecurity: { result, code },
  activeContent: { result: "not_run", findings: [] },
  pages: null,
});

export function childProcessInspector(options: { nodePath?: string; childPath?: string } = {}): PdfInspector {
  return {
    inspect(bytes, limits) {
      return new Promise((resolve) => {
        const child = spawn(options.nodePath ?? process.execPath, [`--max-old-space-size=${limits.inspectMemoryMb}`, options.childPath ?? CHILD, JSON.stringify(limits)], {
          env: {} as NodeJS.ProcessEnv,
          stdio: ["pipe", "pipe", "ignore"],
        });
        let output = "";
        let settled = false;
        const finish = (result: InspectionResult) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(result);
        };
        const timer = setTimeout(() => {
          child.kill("SIGKILL");
          finish(failed("error", "inspection_timeout"));
        }, limits.inspectTimeoutMs);
        child.stdout.setEncoding("utf8");
        child.stdout.on("data", (chunk: string) => {
          output += chunk;
          if (output.length > 64 * 1024) {
            child.kill("SIGKILL");
            finish(failed("error", "inspection_failed"));
          }
        });
        child.on("error", () => finish(failed("error", "inspection_failed")));
        child.on("close", (code) => {
          if (code !== 0) return finish(failed("error", "inspection_failed"));
          try {
            const parsed = JSON.parse(output.trim()) as InspectionResult;
            if (!parsed?.pdfSecurity?.result || !parsed?.activeContent?.result || !Array.isArray(parsed.activeContent.findings)) throw new Error("shape");
            finish(parsed);
          } catch {
            finish(failed("error", "inspection_failed"));
          }
        });
        child.stdin.on("error", () => {});
        child.stdin.end(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
      });
    },
  };
}
