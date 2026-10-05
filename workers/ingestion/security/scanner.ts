import { connect } from "node:net";

import type { RuntimeEnv } from "../../../src/lib/knowledge/core/grade.ts";

/**
 * Malware scanning (docs/08b §7.2, §21.6–21.7): ClamAV's clamd, running as its own ECS service
 * (8B-I5.5), spoken to over the private network (clamav.ipa-worker.internal:3310) with the
 * clamd protocol:
 *
 *   zVERSION\0              → "ClamAV <engine>/<signature version>/<signature date>"
 *   zINSTREAM\0 + chunks     → "stream: OK" | "stream: <signature> FOUND" | "… ERROR"
 *
 * The bytes go over the socket only — no files, no paths, no credentials. Every failure is an
 * error result, never "clean": unavailable, timeout, an error reply, an unknown reply.
 */

export type ScannerErrorCode = "scanner_unavailable" | "scanner_timeout" | "scanner_error" | "invalid_response";
export type MalwareResult = { result: "clean" } | { result: "infected"; name: string } | { result: "error"; code: ScannerErrorCode };

export interface ScannerInfo {
  engine: string;
  engineVersion: string | null;
  signatureVersion: string | null;
  signatureTime: Date | null;
}

export interface MalwareScanner {
  info(): Promise<ScannerInfo | { error: ScannerErrorCode }>;
  scan(bytes: Uint8Array, timeoutMs: number): Promise<MalwareResult>;
}

const CHUNK = 64 * 1024;
/** The service cannot be reached: refused, no DNS answer (also temporarily), no route, reset. */
const UNAVAILABLE = new Set(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "EHOSTUNREACH", "ENETUNREACH", "ECONNRESET", "ETIMEDOUT"]);
const SIGNATURE_NAME = /^[A-Za-z0-9._:/-]{1,120}$/;

/** "ClamAV 1.4.1/27420/Sun Oct  5 08:20:00 2026" (UTC in the container). */
export function parseClamdVersion(reply: string): ScannerInfo | null {
  const match = /^ClamAV ([0-9][0-9A-Za-z.+_-]{0,40})(?:\/(\d{1,12})\/(.{10,40}))?$/.exec(reply.trim());
  if (!match) return null;
  const time = match[3] ? Date.parse(`${match[3].replace(/\s+/g, " ")} UTC`) : NaN;
  return { engine: "ClamAV", engineVersion: match[1]!, signatureVersion: match[2] ?? null, signatureTime: Number.isFinite(time) ? new Date(time) : null };
}

export function parseScanReply(reply: string): MalwareResult {
  const text = reply.replace(/\0+$/, "").trim();
  if (text === "stream: OK") return { result: "clean" };
  const found = /^stream: (.+) FOUND$/.exec(text);
  if (found) return { result: "infected", name: SIGNATURE_NAME.test(found[1]!) ? found[1]! : "unnamed-signature" };
  if (/ERROR$/.test(text)) return { result: "error", code: "scanner_error" };
  return { result: "error", code: "invalid_response" };
}

function exchange(host: string, port: number, send: (write: (data: Uint8Array) => void) => void, timeoutMs: number): Promise<{ reply: string } | { error: ScannerErrorCode }> {
  return new Promise((resolve) => {
    let reply = "";
    let done = false;
    const socket = connect({ host, port });
    const finish = (value: { reply: string } | { error: ScannerErrorCode }) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(value);
    };
    const timer = setTimeout(() => finish({ error: "scanner_timeout" }), timeoutMs);
    socket.on("connect", () => send((data) => socket.write(data)));
    socket.on("data", (chunk: Buffer) => {
      reply += chunk.toString("utf8");
      if (reply.length > 4096) finish({ error: "invalid_response" });
      else if (reply.includes("\0")) finish({ reply: reply.slice(0, reply.indexOf("\0")) });
    });
    socket.on("end", () => finish(reply ? { reply } : { error: "invalid_response" }));
    socket.on("error", (error: NodeJS.ErrnoException) =>
      finish({ error: UNAVAILABLE.has(error.code ?? "") ? "scanner_unavailable" : "scanner_error" }),
    );
  });
}

export function clamdScanner(options: { host: string; port: number; infoTimeoutMs?: number }): MalwareScanner {
  return {
    async info() {
      const answer = await exchange(options.host, options.port, (write) => write(Buffer.from("zVERSION\0")), options.infoTimeoutMs ?? 5_000);
      if ("error" in answer) return answer;
      return parseClamdVersion(answer.reply) ?? { error: "invalid_response" };
    },
    async scan(bytes, timeoutMs) {
      const answer = await exchange(
        options.host,
        options.port,
        (write) => {
          write(Buffer.from("zINSTREAM\0"));
          for (let offset = 0; offset < bytes.byteLength; offset += CHUNK) {
            const part = bytes.subarray(offset, Math.min(bytes.byteLength, offset + CHUNK));
            const size = Buffer.alloc(4);
            size.writeUInt32BE(part.byteLength);
            write(size);
            write(part);
          }
          write(Buffer.alloc(4));
        },
        timeoutMs,
      );
      if ("error" in answer) return { result: "error", code: answer.error };
      return parseScanReply(answer.reply);
    },
  };
}

/**
 * ⚠ DEVELOPMENT-ONLY scanner for local/test fixtures without ClamAV. It finds nothing, and the
 * database accepts its verdicts only where the local seed allowed "development-fixture"
 * (knowledge.security_development_scanners) — never in production. It cannot be created there.
 */
export function developmentFixtureScanner(env: RuntimeEnv): MalwareScanner {
  if (env !== "local" && env !== "test") throw new Error("Udviklingsscanneren findes kun lokalt og i test.");
  return {
    async info() {
      return { engine: "development-fixture", engineVersion: "0", signatureVersion: "0", signatureTime: new Date() };
    },
    async scan() {
      return { result: "clean" };
    },
  };
}
