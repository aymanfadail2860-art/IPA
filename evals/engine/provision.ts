import { createHash, randomUUID } from "node:crypto";

import type { EmbeddingProvider } from "../../src/lib/knowledge/core/embedding.ts";

import { actorEmail, conflictRef, documentRef, type ActorSession, type EvaluationEnvironment } from "./evaluation-environment.ts";
import type { FixtureDocument } from "./fixture-retrieval.ts";
import { sectionsToPdf } from "./fixture-pdf.ts";
import type { IngestionSamples } from "./performance.ts";
import type { Manifest, ManifestDocument } from "./types.ts";

/**
 * Provisioning of the evaluation corpus in the evaluation environment (docs/08b §4.5, §5.5;
 * 8B-I7). Idempotent: what already exists is kept, so a regression run evaluates the same
 * corpus as the baseline (the corpus checksum shows it).
 *
 *   1. The environment must say "evaluation" — nothing happens otherwise.
 *   2. The embedding models of the configurations under test exist (candidate), and every chunk
 *      has their embeddings (re-embedding is requested and awaited).
 *   3. The products are created with the manifest's stable ids (B-031), so a registered run's
 *      scope names the very products of production.
 *   4. Every document version is uploaded through the normal path as an evaluation operator
 *      (quarantine, scanning, processing by the environment's own worker), reviewed and
 *      published; withdrawn versions are withdrawn. Fixtures become PDFs; a public source is
 *      downloaded and must match its checksum.
 *   5. The evaluation users get exactly the manifest's grants — no roles.
 *   6. The manifest's conflicts are flagged (and resolved where the manifest says so).
 *
 * It measures ingestion (§12): seconds from upload to processed per version, with its pages.
 */

export interface ProvisionOptions {
  env: EvaluationEnvironment;
  manifest: Manifest;
  fixtures: Record<string, FixtureDocument>;
  /** The embedders of the configurations under test (their models must be embedded). */
  embedders: readonly EmbeddingProvider[];
  /** Downloads a public source (default: fetch). */
  download?: (url: string) => Promise<Uint8Array>;
  /** Called while waiting for the worker (tests run the worker here). */
  awaitWorker?: () => Promise<void>;
  timeoutMs?: number;
  log?: (event: Record<string, unknown>) => void;
  now?: () => Date;
}

export interface ProvisionResult {
  uploaded: number;
  published: number;
  ingestion: IngestionSamples;
  acknowledgedWarnings: string[];
}

const PROCESSED = new Set(["processed", "under_review", "published", "withdrawn"]);
const FAILED = new Set(["processing_failed", "rejected", "discarded"]);

async function ok<T>(promise: PromiseLike<{ data: unknown; error: { message: string } | null }>, what: string): Promise<T> {
  const { data, error } = await promise;
  if (error) throw new Error(`${what}: ${error.message}`);
  return data as T;
}

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

async function sourceBytes(document: ManifestDocument, label: string, options: ProvisionOptions): Promise<Uint8Array> {
  if (document.source.kind === "fixture") {
    const fixture = options.fixtures[document.source.path];
    const sections = fixture?.versions[label]?.sections;
    if (!fixture || fixture.document !== document.key || fixture.fictional !== true || !sections) {
      throw new Error(`${document.key} v${label}: fixture-teksten mangler eller passer ikke.`);
    }
    return sectionsToPdf(document.title, sections);
  }
  const download = options.download ?? (async (url: string) => new Uint8Array(await (await fetch(url)).arrayBuffer()));
  const bytes = await download(document.source.url);
  if (sha256(bytes) !== document.source.sha256) throw new Error(`${document.key}: kildens checksum stemmer ikke med manifestet.`);
  return bytes;
}

export async function provisionEvaluationCorpus(options: ProvisionOptions): Promise<ProvisionResult> {
  const { env, manifest } = options;
  const log = options.log ?? (() => {});
  const now = options.now ?? (() => new Date());
  await env.assertEvaluation();
  const admin = env.admin.schema("knowledge");

  // 2. Models of the configurations under test.
  const models: string[] = [];
  for (const embedder of options.embedders) {
    const d = embedder.descriptor;
    const existing = await ok<{ id: string; status: string }[]>(
      admin.from("embedding_models").select("id, status").eq("provider", d.provider).eq("model_name", d.model).eq("model_version", d.modelVersion),
      "modeller",
    );
    let id = existing[0]?.id;
    if (!id) {
      id = (await ok<{ id: string }>(
        admin.from("embedding_models").insert({ provider: d.provider, model_name: d.model, model_version: d.modelVersion, dimensions: d.dimensions, status: "candidate" }).select("id").single(),
        "model",
      )).id;
    } else if (existing[0]!.status === "retired") {
      throw new Error(`Modellen ${d.provider}:${d.model}@${d.modelVersion} er udfaset i evalueringsmiljøet.`);
    }
    models.push(id);
  }

  // 3. Products with the manifest's stable ids.
  for (const product of manifest.products) {
    if (!product.id) throw new Error(`Produktet ${product.key} har intet stabilt id i manifestet (B-031).`);
    await ok(admin.from("products").upsert({ id: product.id, name: product.name, status: "active" }, { onConflict: "id" }), `produkt ${product.key}`);
  }

  // 4. Documents and versions, uploaded as the evaluation operator.
  const operator = await env.operator();
  const op = operator.client.schema("knowledge");
  const uploadedAt = new Map<string, number>();
  let uploaded = 0;
  for (const document of manifest.documents) {
    const ref = documentRef(manifest.setId, document.key);
    let documentId = (await ok<{ id: string }[]>(admin.from("documents").select("id").eq("external_ref", ref), "dokument"))[0]?.id ?? null;
    for (const version of document.versions) {
      if (documentId) {
        const found = await ok<{ id: string }[]>(admin.from("document_versions").select("id").eq("document_id", documentId).eq("version_label", version.label), "version");
        if (found.length > 0) continue;
      }
      const bytes = await sourceBytes(document, version.label, options);
      const isNew = documentId === null;
      const newDocumentId = documentId ?? randomUUID();
      const versionId = randomUUID();
      const path = `${newDocumentId}/${versionId}/original.pdf`;
      const signed = await operator.client.storage.from("knowledge-intake").createSignedUploadUrl(path);
      if (signed.error) throw new Error(`${document.key} v${version.label}: ${signed.error.message}`);
      const put = await operator.client.storage.from("knowledge-intake").uploadToSignedUrl(path, signed.data.token, bytes, { contentType: "application/pdf" });
      if (put.error) throw new Error(`${document.key} v${version.label}: ${put.error.message}`);
      await ok(
        op.rpc("register_upload", {
          p_version_id: versionId,
          p_document_id: newDocumentId,
          p_new_document: isNew ? { product_id: manifest.products.find((product) => product.key === document.product)!.id, document_type: document.type, title: document.title } : null,
          p_version_label: version.label,
          p_language: document.language,
          p_valid_from: version.validFrom,
          p_valid_to: version.validTo,
          p_checksum_sha256: sha256(bytes),
          p_original_filename: `${document.key}-${version.label}.pdf`,
        }),
        `${document.key} v${version.label}`,
      );
      if (isNew) await ok(admin.from("documents").update({ external_ref: ref }).eq("id", newDocumentId), `${document.key}`);
      documentId = newDocumentId;
      uploadedAt.set(versionId, now().getTime());
      uploaded += 1;
      log({ event: "eval_provision_uploaded", document: document.key, version: version.label });
    }
  }

  // Wait for the environment's worker: scanning and processing.
  const deadline = now().getTime() + (options.timeoutMs ?? 30 * 60 * 1000);
  for (;;) {
    const snapshot = await env.snapshot(manifest);
    const expected = manifest.documents.flatMap((document) => document.versions.map((version) => snapshot.binding.documents[document.key]?.versions[version.label]));
    const states = expected.map((id) => (id ? snapshot.versions.get(id)?.status ?? "missing" : "missing"));
    const failed = [...snapshot.versions.values()].filter((version) => FAILED.has(version.status));
    if (failed.length > 0) throw new Error(`Behandlingen fejlede: ${failed.map((version) => `${version.documentKey} v${version.label} (${version.status})`).join(", ")}.`);
    if (states.every((status) => PROCESSED.has(status))) break;
    if (now().getTime() > deadline) throw new Error(`Evalueringskorpusset blev ikke behandlet i tide (${states.filter((status) => !PROCESSED.has(status)).length} versioner venter).`);
    if (options.awaitWorker) await options.awaitWorker();
    else await new Promise((resolve) => setTimeout(resolve, 5000));
  }

  // Ingestion times (§12): upload → the process job finished, per version uploaded in this run.
  const ingestion: IngestionSamples = { documents: [], corpusPages: 0, corpusSeconds: null };
  let snapshot = await env.snapshot(manifest);
  let firstUpload = Infinity;
  let lastFinish = 0;
  for (const version of snapshot.versions.values()) {
    ingestion.corpusPages += version.pageCount ?? 0;
    const started = uploadedAt.get(version.id);
    if (started === undefined) continue;
    const jobs = await ok<{ finished_at: string | null }[]>(
      admin.from("ingestion_jobs").select("finished_at").eq("document_version_id", version.id).eq("kind", "process").eq("status", "succeeded").order("finished_at", { ascending: false }).limit(1),
      "job",
    );
    const finished = jobs[0]?.finished_at ? new Date(jobs[0].finished_at).getTime() : null;
    if (finished === null) continue;
    ingestion.documents.push({ pages: version.pageCount ?? 0, seconds: Math.max(0, Math.round((finished - started) / 1000)) });
    firstUpload = Math.min(firstUpload, started);
    lastFinish = Math.max(lastFinish, finished);
  }
  // The whole corpus only counts when all of it was ingested in this run.
  if (uploaded > 0 && uploaded === snapshot.versions.size && lastFinish > 0) ingestion.corpusSeconds = Math.max(0, Math.round((lastFinish - firstUpload) / 1000));

  // Review and publication; withdrawn versions are withdrawn.
  const acknowledged = new Set<string>();
  let published = 0;
  for (const document of manifest.documents) {
    for (const version of document.versions) {
      const id = snapshot.binding.documents[document.key]?.versions[version.label];
      const state = id ? snapshot.versions.get(id)?.status : undefined;
      if (!id || !state) continue;
      if (state === "processed") await ok(op.rpc("start_review", { p_version_id: id }), `gennemgang ${document.key} v${version.label}`);
      if (state === "processed" || state === "under_review") {
        const review = await ok<{ warnings?: { code: string }[] }>(op.rpc("review_state", { p_version_id: id }), "gennemgang");
        const warnings = (review.warnings ?? []).map((warning) => warning.code);
        warnings.forEach((code) => acknowledged.add(code));
        await ok(op.rpc("approve_version", { p_version_id: id, p_acknowledged_warnings: warnings }), `publicering ${document.key} v${version.label}`);
        published += 1;
      }
      if (version.status === "withdrawn" && state !== "withdrawn") {
        await ok(op.rpc("withdraw_version", { p_version_id: id, p_category: "other", p_reason: "Evalueringssæt: versionen er tilbagetrukket i manifestet." }), "tilbagetrækning");
      }
    }
  }
  snapshot = await env.snapshot(manifest);

  // 5. Evaluation users with exactly the manifest's grants.
  for (const actor of manifest.actors) {
    const session = await env.signInUser(actorEmail(manifest.setId, actor.id), `Evalueringsbruger ${actor.id} (fiktiv)`, []);
    await signOut(session.client);
    const wanted = new Set<string>();
    for (const grant of actor.grants) {
      const documentId = snapshot.binding.documents[grant.document]?.documentId;
      if (!documentId) throw new Error(`Tildelingen til ${actor.id} peger på et ukendt dokument: ${grant.document}.`);
      wanted.add(`${documentId}|knowledge.document.read`);
      if (grant.historical) wanted.add(`${documentId}|knowledge.document.read_historical`);
    }
    const existing = await ok<{ id: string; document_id: string; permission_key: string }[]>(
      admin.from("document_access_grants").select("id, document_id, permission_key").eq("grantee_type", "user").eq("user_id", session.userId),
      "tildelinger",
    );
    for (const grant of existing) {
      if (!wanted.has(`${grant.document_id}|${grant.permission_key}`)) await ok(admin.from("document_access_grants").delete().eq("id", grant.id), "tildeling");
    }
    for (const key of wanted) {
      const [documentId, permission] = key.split("|");
      if (existing.some((grant) => grant.document_id === documentId && grant.permission_key === permission)) continue;
      await ok(admin.from("document_access_grants").insert({ document_id: documentId, permission_key: permission, grantee_type: "user", user_id: session.userId }), "tildeling");
    }
  }

  // 6. Conflicts, on version level (all versions of both documents).
  for (const conflict of manifest.conflicts) {
    const ref = conflictRef(manifest.setId, conflict.id);
    let id = snapshot.binding.conflicts[conflict.id];
    if (!id) {
      const passages = conflict.documents.flatMap((key, i) =>
        Object.values(snapshot.binding.documents[key]?.versions ?? {}).map((versionId) => ({ side: i === 0 ? "A" : "B", version_id: versionId })),
      );
      id = await ok<string>(op.rpc("flag_conflict", { p_description: ref, p_passages: passages }), `konflikt ${conflict.id}`);
    }
    const current = (await ok<{ status: string }[]>(op.from("conflicts").select("status").eq("id", id), "konflikt"))[0]?.status;
    if (conflict.status === "resolved" && current === "open") {
      await ok(op.rpc("resolve_conflict", { p_conflict_id: id, p_note: "Evalueringssæt: konflikten er løst i manifestet." }), "konflikt");
    }
  }
  // 2 (continued). Every chunk must have the embeddings of every model under test.
  for (const modelId of models) {
    for (;;) {
      const coverage = await ok<{ chunks: number; embedded: number }>(admin.rpc("embedding_coverage", { p_model_id: modelId }), "dækning");
      if (coverage.embedded >= coverage.chunks) break;
      await ok(admin.rpc("request_reembedding", { p_model_id: modelId }), "re-embedding");
      if (now().getTime() > deadline) throw new Error("Embeddings for evalueringskorpusset blev ikke færdige i tide.");
      if (options.awaitWorker) await options.awaitWorker();
      else await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }

  log({ event: "eval_provisioned", uploaded, published, acknowledged_warnings: [...acknowledged].sort() });
  return { uploaded, published, ingestion, acknowledgedWarnings: [...acknowledged].sort() };
}

async function signOut(client: ActorSession["client"]): Promise<void> {
  await client.auth.signOut().catch(() => undefined);
}
