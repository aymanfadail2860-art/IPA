/**
 * The importer's way into Supabase (beta L3): the platform's public REST endpoints, AS THE
 * OPERATOR — a signed-in administrator with knowledge.document.write. Exactly the rights the Admin
 * upload has: the bucket policies, RLS and the database functions (register_upload,
 * find_versions_by_checksum, version_security_status, review_state, log_original_download)
 * decide, and the audit log names the operator.
 *
 *   * Never a service-role or secret key: the importer refuses one (the worker has its own
 *     least-privilege database role and never comes here).
 *   * The password is used once to sign in and is not kept; the session is signed out at the end.
 *   * No token, password or key ever appears in an error, a log line or a report.
 *   * Plain fetch: no dependencies.
 */

export class ApiError extends Error {
  readonly status: number;
  readonly code: string | null;
  constructor(message: string, status: number, code: string | null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export class ConfigProblem extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigProblem";
  }
}

export interface ApiOptions {
  url: string;
  /** The project's publishable (anon) key — public by design; a secret key is refused. */
  publishableKey: string;
  /** local/test may use http; anything else requires https. */
  allowHttp: boolean;
  fetchImpl?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
}

export interface UploadOutcome {
  ok: boolean;
  /** The object already exists (an interrupted earlier run uploaded it). */
  exists: boolean;
  status: number;
  message: string | null;
}

export interface SupabaseApi {
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  rpc<T>(schema: "knowledge" | "identity", fn: string, args: Record<string, unknown>): Promise<T>;
  select<T>(schema: "knowledge", table: string, query: string): Promise<T[]>;
  upload(bucket: string, path: string, bytes: Uint8Array, contentType: string): Promise<UploadOutcome>;
  /** At most maxBytes; more is an error (never cut off silently). */
  download(bucket: string, path: string, maxBytes: number): Promise<Uint8Array>;
}

/** The JWT payload of a legacy key, or null. Never verified here — only read to refuse service_role. */
function jwtRole(key: string): string | null {
  const parts = key.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1]!.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")) as { role?: unknown };
    return typeof payload.role === "string" ? payload.role : null;
  } catch {
    return null;
  }
}

/** Throws ConfigProblem for anything but a public key and a clean project URL. */
export function checkConnection(options: Pick<ApiOptions, "url" | "publishableKey" | "allowHttp">): URL {
  let url: URL;
  try {
    url = new URL(options.url);
  } catch {
    throw new ConfigProblem("IPA_IMPORT_SUPABASE_URL er ikke en gyldig adresse.");
  }
  if (url.username || url.password || url.search || url.hash) throw new ConfigProblem("IPA_IMPORT_SUPABASE_URL må ikke indeholde brugernavn, adgangskode eller parametre.");
  if (url.protocol !== "https:" && !(options.allowHttp && url.protocol === "http:")) throw new ConfigProblem("IPA_IMPORT_SUPABASE_URL skal bruge https.");
  const key = options.publishableKey.trim();
  if (!key) throw new ConfigProblem("IPA_IMPORT_PUBLISHABLE_KEY mangler (projektets publishable/anon-nøgle).");
  if (key.startsWith("sb_secret_") || jwtRole(key) === "service_role") {
    throw new ConfigProblem("IPA_IMPORT_PUBLISHABLE_KEY er en hemmelig nøgle (service_role). Importen bruger kun den offentlige nøgle og din egen konto.");
  }
  if (!key.startsWith("sb_publishable_") && jwtRole(key) !== "anon") {
    throw new ConfigProblem("IPA_IMPORT_PUBLISHABLE_KEY er ikke projektets publishable/anon-nøgle.");
  }
  return url;
}

function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

export function createSupabaseApi(options: ApiOptions): SupabaseApi {
  const base = checkConnection(options).toString().replace(/\/+$/, "");
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? 120_000;
  const key = options.publishableKey.trim();
  let session: { access: string; refresh: string; expiresAt: number } | null = null;

  const request = async (path: string, init: RequestInit & { headers?: Record<string, string> }): Promise<Response> => {
    try {
      return await fetchImpl(`${base}${path}`, { ...init, redirect: "error", signal: AbortSignal.timeout(timeoutMs) });
    } catch (error) {
      const name = (error as { name?: string }).name ?? "Error";
      throw new ApiError(name === "TimeoutError" ? "Forbindelsen til platformen fik timeout." : "Platformen kunne ikke nås.", 0, name);
    }
  };

  /** The server's own message and code — never the request (which carries the token). */
  const failure = async (response: Response, fallback: string): Promise<ApiError> => {
    const body = (await response.json().catch(() => null)) as { message?: unknown; msg?: unknown; error?: unknown; error_description?: unknown; code?: unknown; statusCode?: unknown } | null;
    const text = [body?.message, body?.msg, body?.error_description, body?.error].find((value) => typeof value === "string" && value.length > 0) as string | undefined;
    const code = typeof body?.code === "string" ? body.code : typeof body?.statusCode === "string" ? body.statusCode : null;
    return new ApiError(text ? text.slice(0, 300) : fallback, response.status, code);
  };

  const token = async (body: Record<string, string>, grant: "password" | "refresh_token") => {
    const response = await request(`/auth/v1/token?grant_type=${grant}`, {
      method: "POST",
      headers: { apikey: key, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      // Same message whether the account exists or not.
      if (grant === "password") throw new ApiError("Login mislykkedes: e-mail eller adgangskode er forkert.", response.status, null);
      throw await failure(response, "Sessionen kunne ikke forlænges. Start importen igen.");
    }
    const data = (await response.json()) as { access_token?: string; refresh_token?: string; expires_in?: number };
    if (!data.access_token || !data.refresh_token) throw new ApiError("Login gav ikke en gyldig session.", response.status, null);
    session = { access: data.access_token, refresh: data.refresh_token, expiresAt: now() + (data.expires_in ?? 3600) * 1000 };
  };

  const auth = async (): Promise<Record<string, string>> => {
    if (!session) throw new ApiError("Ikke logget ind.", 401, null);
    // Long imports outlive the access token: refresh shortly before it expires.
    if (session.expiresAt - now() < 120_000) await token({ refresh_token: session.refresh }, "refresh_token");
    return { apikey: key, authorization: `Bearer ${session!.access}` };
  };

  return {
    async signIn(email, password) {
      await token({ email, password }, "password");
    },
    async signOut() {
      if (!session) return;
      const headers = await auth().catch(() => null);
      session = null;
      if (headers) await request("/auth/v1/logout?scope=local", { method: "POST", headers }).catch(() => null);
    },
    async rpc<T>(schema: "knowledge" | "identity", fn: string, args: Record<string, unknown>) {
      const response = await request(`/rest/v1/rpc/${encodeURIComponent(fn)}`, {
        method: "POST",
        headers: { ...(await auth()), "content-type": "application/json", "content-profile": schema, "accept-profile": schema },
        body: JSON.stringify(args),
      });
      if (!response.ok) throw await failure(response, `Kaldet ${fn} mislykkedes.`);
      const text = await response.text();
      return (text ? JSON.parse(text) : null) as T;
    },
    async select<T>(schema: "knowledge", table: string, query: string) {
      const response = await request(`/rest/v1/${encodeURIComponent(table)}?${query}`, {
        method: "GET",
        headers: { ...(await auth()), "accept-profile": schema },
      });
      if (!response.ok) throw await failure(response, `Opslaget i ${table} mislykkedes.`);
      return (await response.json()) as T[];
    },
    async upload(bucket, path, bytes, contentType) {
      const response = await request(`/storage/v1/object/${encodeURIComponent(bucket)}/${encodePath(path)}`, {
        method: "POST",
        headers: { ...(await auth()), "content-type": contentType, "x-upsert": "false" },
        body: new Blob([bytes as Uint8Array<ArrayBuffer>], { type: contentType }),
      });
      if (response.ok) return { ok: true, exists: false, status: response.status, message: null };
      const error = await failure(response, "Upload mislykkedes.");
      const exists = response.status === 409 || error.code === "409" || /already exists|duplicate/i.test(error.message);
      return { ok: false, exists, status: response.status, message: error.message };
    },
    async download(bucket, path, maxBytes) {
      const response = await request(`/storage/v1/object/authenticated/${encodeURIComponent(bucket)}/${encodePath(path)}`, { method: "GET", headers: await auth() });
      if (!response.ok || !response.body) throw await failure(response, "Originalen kunne ikke hentes.");
      const reader = response.body.getReader();
      const parts: Uint8Array[] = [];
      let size = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) {
          await reader.cancel().catch(() => {});
          throw new ApiError("Originalen er større end tilladt.", 413, null);
        }
        parts.push(value);
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const part of parts) {
        bytes.set(part, offset);
        offset += part.byteLength;
      }
      return bytes;
    },
  };
}
