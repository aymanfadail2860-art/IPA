import { randomBytes } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { checksumOf } from "./checksum.ts";
import type { CorpusBinding, Manifest } from "./types.ts";

/**
 * The evaluation environment (docs/08b §4.5; 8B-I7): a separate Supabase project with the same
 * migrations, the real providers and the evaluation corpus. Evaluation documents are never
 * mixed into production knowledge.
 *
 *   * Every operation first asks the database what it is (knowledge.environment_kind(), set
 *     only by its owner at deployment). Anything but "evaluation" is refused before a single
 *     row is read or written — the evaluation can never touch production data (H7).
 *   * The credentials are the evaluation project's own (its URL, anon key and service-role
 *     key, from the environment's secret handling). They are never production credentials:
 *     registration in production goes through evaluation_publisher in a separate step.
 *   * Evaluation users are created here (docs/08b §5.5). Their passwords are random, set for
 *     each run and never stored; the evaluation signs in as each user and retrieval runs
 *     through RLS like any other user.
 */

export interface EvaluationEnvironmentConfig {
  url: string;
  anonKey: string;
  serviceRoleKey: string;
}

/**
 * The evaluation project's own credentials: IPA_EVAL_SUPABASE_URL, IPA_EVAL_SUPABASE_ANON_KEY and
 * IPA_EVAL_SUPABASE_SERVICE_ROLE_KEY. The application's own variables (its public URL and keys, its
 * service-role key) are never read here — an evaluation can only reach the
 * project it was explicitly given, and even that one must say it is an evaluation environment.
 */
export function evaluationEnvironmentFromEnv(env: Record<string, string | undefined>): EvaluationEnvironmentConfig | { missing: string[] } {
  const names = { url: "IPA_EVAL_SUPABASE_URL", anonKey: "IPA_EVAL_SUPABASE_ANON_KEY", serviceRoleKey: "IPA_EVAL_SUPABASE_SERVICE_ROLE_KEY" } as const;
  const missing = Object.values(names).filter((name) => !env[name]);
  if (missing.length > 0) return { missing };
  return { url: env[names.url]!, anonKey: env[names.anonKey]!, serviceRoleKey: env[names.serviceRoleKey]! };
}

export class NotAnEvaluationEnvironmentError extends Error {
  constructor(kind: string) {
    super(`Databasen er ikke et evalueringsmiljø (miljøart "${kind}"). Evalueringen rører aldrig andre miljøer.`);
    this.name = "NotAnEvaluationEnvironmentError";
  }
}

/** The evaluation corpus as the environment holds it (manifest keys → database ids). */
export interface CorpusSnapshot {
  binding: CorpusBinding;
  /** document key → version label → reconstructed normalized text (from the chunks). */
  texts: Map<string, string>;
  /** chunk id → chunker version (P7/H6). */
  chunkerVersions: Record<string, string>;
  /** Everything that decides what the evaluation can return — compared before and after (H7). */
  checksum: string;
  /** Version id → status, for provisioning. */
  versions: Map<string, { id: string; status: string; documentKey: string; label: string; pageCount: number | null }>;
}

export interface ActorSession {
  client: SupabaseClient;
  /** identity.users.id of the evaluation user. */
  userId: string;
  /** auth.users.id — what the database reports as the caller (auth.uid()). */
  authId: string;
}

const EMAIL_DOMAIN = "evaluation.invalid";

export const actorEmail = (setId: string, actor: string) => `eval.${setId}.${actor}@${EMAIL_DOMAIN}`;
export const OPERATOR_EMAIL = `eval.operator@${EMAIL_DOMAIN}`;
export const documentRef = (setId: string, key: string) => `eval:${setId}:${key}`;
export const conflictRef = (setId: string, id: string) => `eval:${setId}:${id}`;

async function rows<T>(promise: PromiseLike<{ data: unknown; error: { message: string } | null }>, what: string): Promise<T> {
  const { data, error } = await promise;
  if (error) throw new Error(`${what}: ${error.message}`);
  return data as T;
}

export interface EvaluationEnvironment {
  readonly url: string;
  /** The service-role client of the EVALUATION project (provisioning, snapshot). */
  readonly admin: SupabaseClient;
  /** Throws NotAnEvaluationEnvironmentError unless the database says "evaluation". */
  assertEvaluation(): Promise<void>;
  /** Creates the user if missing, sets a fresh random password, signs in. */
  signInUser(email: string, displayName: string, roles: readonly string[]): Promise<ActorSession>;
  /** The evaluation operator (an administrator in the evaluation environment), signed in once. */
  operator(): Promise<ActorSession>;
  snapshot(manifest: Manifest): Promise<CorpusSnapshot>;
}

export function connectEvaluationEnvironment(config: EvaluationEnvironmentConfig): EvaluationEnvironment {
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  const admin = createClient(config.url, config.serviceRoleKey, options);
  let verified = false;

  async function assertEvaluation(): Promise<void> {
    if (verified) return;
    const kind = await rows<string>(admin.schema("knowledge").rpc("environment_kind"), "miljøart");
    if (kind !== "evaluation") throw new NotAnEvaluationEnvironmentError(String(kind));
    verified = true;
  }

  async function findAuthUser(email: string) {
    for (let page = 1; page < 100; page += 1) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
      if (error) throw new Error(`brugere: ${error.message}`);
      const hit = data.users.find((user) => user.email === email);
      if (hit) return hit;
      if (data.users.length < 200) return null;
    }
    return null;
  }

  async function signInUser(email: string, displayName: string, roles: readonly string[]): Promise<ActorSession> {
    await assertEvaluation();
    const password = randomBytes(24).toString("hex");
    let user = await findAuthUser(email);
    if (!user) {
      const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { display_name: displayName } });
      if (error) throw new Error(`opret ${email}: ${error.message}`);
      user = data.user;
    } else {
      const { error } = await admin.auth.admin.updateUserById(user.id, { password });
      if (error) throw new Error(`adgangskode ${email}: ${error.message}`);
    }
    const identity = admin.schema("identity");
    const profile = await rows<{ id: string }>(identity.from("users").select("id").eq("auth_id", user.id).single(), `profil ${email}`);
    await rows(identity.from("users").update({ display_name: displayName, status: "active" }).eq("id", profile.id), `profil ${email}`);
    // Exactly the given roles: an evaluation reader has none, so it reads only through grants.
    const all = await rows<{ id: string; key: string }[]>(identity.from("roles").select("id, key"), "roller");
    const wanted = new Set(all.filter((role) => roles.includes(role.key)).map((role) => role.id));
    if (wanted.size !== roles.length) throw new Error(`ukendte roller: ${roles.join(", ")}`);
    await rows(identity.from("user_roles").delete().eq("user_id", profile.id).not("role_id", "in", `(${[...wanted].join(",") || "00000000-0000-0000-0000-000000000000"})`), "roller");
    for (const roleId of wanted) await rows(identity.from("user_roles").upsert({ user_id: profile.id, role_id: roleId }, { ignoreDuplicates: true }), "rolle");

    const client = createClient(config.url, config.anonKey, options);
    const { error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw new Error(`login ${email}: ${error.message}`);
    return { client, userId: profile.id, authId: user.id };
  }

  let operatorSession: Promise<ActorSession> | null = null;
  function operator(): Promise<ActorSession> {
    operatorSession ??= signInUser(OPERATOR_EMAIL, "Evalueringsoperatør (fiktiv)", ["administrator"]).catch((error: unknown) => {
      operatorSession = null;
      throw error;
    });
    return operatorSession;
  }

  async function snapshot(manifest: Manifest): Promise<CorpusSnapshot> {
    await assertEvaluation();
    const knowledge = admin.schema("knowledge");
    const products: Record<string, string> = {};
    for (const product of manifest.products) {
      if (!product.id) throw new Error(`Produktet ${product.key} har intet stabilt id i manifestet (B-031); det kræves i evalueringsmiljøet.`);
      products[product.key] = product.id;
    }
    const refs = manifest.documents.map((document) => documentRef(manifest.setId, document.key));
    const documents = await rows<{ id: string; external_ref: string; title: string; document_type: string; product_id: string }[]>(
      knowledge.from("documents").select("id, external_ref, title, document_type, product_id").in("external_ref", refs),
      "dokumenter",
    );
    const byRef = new Map(documents.map((document) => [document.external_ref, document]));
    const docIds = documents.map((document) => document.id);
    const versionRows = docIds.length
      ? await rows<{ id: string; document_id: string; version_label: string | null; status: string; valid_from: string | null; valid_to: string | null; checksum_sha256: string; chunker_version: string | null; page_count: number | null }[]>(
          knowledge.from("document_versions").select("id, document_id, version_label, status, valid_from, valid_to, checksum_sha256, chunker_version, page_count").in("document_id", docIds),
          "versioner",
        )
      : [];
    const versionIds = versionRows.map((version) => version.id);
    const chunks: { id: string; document_version_id: string; chunk_index: number; text: string; char_start: number; content_hash: string }[] = [];
    for (let i = 0; i < versionIds.length; i += 50) {
      chunks.push(
        ...(await rows<typeof chunks>(
          knowledge.from("document_chunks").select("id, document_version_id, chunk_index, text, char_start, content_hash").in("document_version_id", versionIds.slice(i, i + 50)).order("chunk_index"),
          "chunks",
        )),
      );
    }
    // Conflicts are read as the operator (RLS: knowledge managers) — not even the service role reads them.
    const conflictRows = await rows<{ id: string; description: string | null; status: string }[]>(
      (await operator()).client.schema("knowledge").from("conflicts").select("id, description, status").like("description", `eval:${manifest.setId}:%`),
      "konflikter",
    );
    const grantRows = docIds.length
      ? await rows<{ document_id: string; permission_key: string; grantee_type: string; user_id: string | null }[]>(
          knowledge.from("document_access_grants").select("document_id, permission_key, grantee_type, user_id").in("document_id", docIds),
          "tildelinger",
        )
      : [];

    const binding: CorpusBinding = { products, documents: {}, conflicts: {} };
    const texts = new Map<string, string>();
    const chunkerVersions: Record<string, string> = {};
    const versions = new Map<string, { id: string; status: string; documentKey: string; label: string; pageCount: number | null }>();
    const material: unknown[] = [];
    for (const document of manifest.documents) {
      const row = byRef.get(documentRef(manifest.setId, document.key));
      if (!row) continue;
      if (row.product_id !== products[document.product] || row.document_type !== document.type) {
        throw new Error(`Dokumentet ${document.key} i evalueringsmiljøet svarer ikke til manifestet (produkt eller dokumenttype).`);
      }
      const own = versionRows.filter((version) => version.document_id === row.id);
      binding.documents[document.key] = {
        documentId: row.id,
        title: row.title,
        versions: Object.fromEntries(own.filter((version) => version.version_label !== null).map((version) => [version.version_label!, version.id])),
      };
      for (const version of own) {
        const ordered = chunks.filter((chunk) => chunk.document_version_id === version.id).sort((a, b) => a.chunk_index - b.chunk_index);
        let text = "";
        for (const chunk of ordered) {
          if (version.chunker_version) chunkerVersions[chunk.id] = version.chunker_version;
          // Chunks overlap; each is placed at its own offset in the normalized text.
          if (chunk.char_start >= text.length) text += "\n".repeat(chunk.char_start - text.length) + chunk.text;
          else if (chunk.char_start + chunk.text.length > text.length) text += chunk.text.slice(text.length - chunk.char_start);
        }
        if (version.version_label !== null) {
          texts.set(`${document.key}\u0000${version.version_label}`, text);
          versions.set(version.id, { id: version.id, status: version.status, documentKey: document.key, label: version.version_label, pageCount: version.page_count });
        }
        material.push([document.key, version.version_label, version.id, version.status, version.valid_from, version.valid_to, version.checksum_sha256, version.chunker_version, ordered.map((chunk) => chunk.content_hash)]);
      }
      material.push(["grants", document.key, grantRows.filter((grant) => grant.document_id === row.id).map((grant) => [grant.permission_key, grant.grantee_type, grant.user_id]).sort()]);
    }
    for (const conflict of manifest.conflicts) {
      const row = conflictRows.find((entry) => entry.description === conflictRef(manifest.setId, conflict.id));
      if (row) {
        binding.conflicts[conflict.id] = row.id;
        material.push(["conflict", conflict.id, row.id, row.status]);
      }
    }
    return { binding, texts, chunkerVersions, checksum: checksumOf({ setId: manifest.setId, products, material }), versions };
  }

  return { url: config.url, admin, assertEvaluation, signInUser, operator, snapshot };
}
