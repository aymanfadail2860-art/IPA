/**
 * Structured operational logs for the worker (docs/08b §21.5): one JSON object per line.
 *
 * Never logged: document text, query text, credentials, lease tokens, storage tickets or PII.
 * Callers pass identifiers and classes only; this module redacts as a second line of defence:
 * any field whose name suggests a secret or content, and any value that looks like a token
 * (64 hex characters — the shape of lease tokens and tickets).
 */

export type LogEvent = Record<string, unknown> & { event: string };
export type Logger = (event: LogEvent) => void;

const REDACTED_KEYS = /token|ticket|password|passwd|secret|credential|authorization|api_?key|^key$|text|content|query|body|url|dsn/i;
const TOKEN_LIKE = /\b[0-9a-f]{64}\b/gi;

function clean(value: unknown, depth: number): unknown {
  if (typeof value === "string") return value.replace(TOKEN_LIKE, "[redacted]").slice(0, 300);
  if (typeof value === "number" || typeof value === "boolean" || value === null || value === undefined) return value;
  if (depth > 3) return "[truncated]";
  if (Array.isArray(value)) return value.slice(0, 20).map((entry) => clean(entry, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      out[key] = REDACTED_KEYS.test(key) ? "[redacted]" : clean(entry, depth + 1);
    }
    return out;
  }
  return String(value);
}

export function redactLogEvent(event: Record<string, unknown>): Record<string, unknown> {
  return clean(event, 0) as Record<string, unknown>;
}

export function createLogger(base: Record<string, unknown>, write: (line: string) => void = (line) => process.stdout.write(`${line}\n`)): Logger {
  return (event) => write(JSON.stringify(redactLogEvent({ at: new Date().toISOString(), ...base, ...event })));
}

/** The class of an error for logs: its name and SQLSTATE/kind — never its message. */
export function errorClass(error: unknown): { error: string; code?: string } {
  const name = typeof (error as { name?: unknown })?.name === "string" ? (error as { name: string }).name : "Error";
  const code = (error as { code?: unknown })?.code;
  return typeof code === "string" ? { error: name, code } : { error: name };
}
