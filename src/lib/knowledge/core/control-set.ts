import { syntheticText } from "../../egress/synthetic.ts";

import type { EmbeddingModelSpec, EmbeddingProvider } from "./embedding.ts";
import { canonicalJson, sha256, type EmbeddingInputType, type EmbeddingProviderDescriptor, type ProviderSettings } from "./provider.ts";
import { hashEmbedding } from "./test-embedder.ts";

/**
 * The embedding control set (docs/08b §2.5, §15; 8B-I8 C6).
 *
 * A provider can change the model behind an unchanged id. The configuration fingerprint cannot
 * see that: it identifies the DECLARED material (provider, model, version label, dimensions,
 * settings). The control set measures the model itself — a small, fixed, versioned set of
 * synthetic Danish insurance texts, embedded and compared with an approved reference:
 *
 *   * dimensions and invariants (finite, non-zero vectors);
 *   * the reference's identity: control set (version, checksum), provider, model, version label,
 *     dimensions, settings (incl. the input types) and the embedding part of the fingerprint;
 *   * the cosine of every vector to the reference vector of the same text;
 *   * relations: a query is closer to its related document than to a clearly different one.
 *
 * Tolerances are versioned and calibrated at the first approved baseline with the real provider
 * — none is invented here. Only an explicitly approved reference captured through a real
 * provider credential path can be the production reference; a fake or development capture never
 * can (productionReferenceProblems). A failed comparison is never accepted automatically: the
 * worker stops embedding with the model and raises a critical alarm, and the evaluation marks
 * the runtime model version, so the run fails H6 (a hard regression for the configuration in
 * service; invalid for any other).
 *
 * The texts are fictional. They are the ONLY texts this module classifies as synthetic — it
 * takes no text from a caller (guardrail).
 */

export interface ControlText {
  readonly id: string;
  readonly inputType: EmbeddingInputType;
  readonly text: string;
}

/** The anchor must be closer to `closer` than to `farther`. */
export interface ControlRelation {
  readonly anchor: string;
  readonly closer: string;
  readonly farther: string;
}

export interface ControlSet {
  readonly id: string;
  readonly version: number;
  readonly texts: readonly ControlText[];
  readonly relations: readonly ControlRelation[];
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const entry of Object.values(value)) deepFreeze(entry);
    Object.freeze(value);
  }
  return value;
}

export const EMBEDDING_CONTROL_SET: ControlSet = deepFreeze({
  id: "embedding-control",
  version: 1,
  texts: [
    { id: "q-opbevaring", inputType: "query", text: "Dækker erhvervsansvarsforsikringen skade på maskiner, som virksomheden har til reparation?" },
    { id: "q-brand", inputType: "query", text: "Hvor stor er selvrisikoen ved en brandskade i lagerbygningen?" },
    { id: "q-cyber", inputType: "query", text: "Er udgifter efter et hackerangreb på virksomhedens it-systemer dækket?" },
    { id: "d-opbevaring", inputType: "document", text: "Forsikringen dækker ikke skade på ting, som sikrede har til opbevaring, reparation, bearbejdning eller lån." },
    { id: "d-brand", inputType: "document", text: "Ved brandskade på bygninger og lagre udgør selvrisikoen 10.000 kr. pr. skadebegivenhed." },
    { id: "d-cyber", inputType: "document", text: "Cyberdækningen omfatter udgifter til genetablering af data og it-systemer efter et uautoriseret angreb." },
    { id: "d-arbejdsskade", inputType: "document", text: "Arbejdsskadeforsikringen dækker ansattes ulykker under arbejdet efter arbejdsskadesikringsloven." },
    { id: "d-motor", inputType: "document", text: "Kaskoforsikringen for firmabiler dækker kollisionsskader på køretøjet uanset skyld." },
  ],
  relations: [
    { anchor: "q-opbevaring", closer: "d-opbevaring", farther: "d-motor" },
    { anchor: "q-brand", closer: "d-brand", farther: "d-cyber" },
    { anchor: "q-cyber", closer: "d-cyber", farther: "d-arbejdsskade" },
  ],
} satisfies ControlSet);

export function controlSetChecksum(set: ControlSet = EMBEDDING_CONTROL_SET): string {
  return sha256(canonicalJson(set));
}

/** The embedding part of the configuration fingerprint material (docs/08b §10.1). */
export function embeddingMaterialChecksum(descriptor: Pick<EmbeddingProviderDescriptor, "provider" | "model" | "modelVersion" | "dimensions" | "processing" | "settings">): string {
  const { provider, model, modelVersion, dimensions, processing, settings } = descriptor;
  return sha256(canonicalJson({ provider, model, modelVersion, dimensions, processing, settings }));
}

export interface ControlTolerances {
  /** The tolerance version. A new calibration is a new version. */
  readonly version: number;
  /** Every vector's cosine to its reference vector must be at least this. */
  readonly minCosineToReference: number;
  /** cos(anchor, closer) − cos(anchor, farther) must be at least this for every relation. */
  readonly minRelationalMargin: number;
  /** How the numbers were calibrated (runs, observed spread, decision). */
  readonly calibration: string;
}

export interface ControlReference {
  readonly schema: 1;
  readonly controlSet: { readonly id: string; readonly version: number; readonly checksum: string };
  readonly model: { readonly provider: string; readonly model: string; readonly modelVersion: string; readonly dimensions: number };
  readonly settings: ProviderSettings;
  readonly embeddingFingerprint: string;
  readonly vectors: Readonly<Record<string, readonly number[]>>;
  /** Null until calibrated at the first real baseline. */
  readonly tolerances: ControlTolerances | null;
  readonly capture: { readonly runtime: "evaluation" | "worker"; readonly credentialSource: string; readonly capturedAt: string; readonly runId: string };
  /** Null until a person approves it with a decision (docs/decisions.md). */
  readonly approval: { readonly decision: string; readonly approvedBy: string; readonly approvedAt: string } | null;
}

/**
 * Credential paths through which a real provider was called: those of 8B's evaluation job and
 * worker. Beta L2 (docs/beta.md §14) removed that runtime and its provider, so nothing captures
 * through them today and CONTROL_REFERENCES stays empty. A future provider adds its own path
 * here — a reviewed change.
 */
const REAL_PROVIDER_CAPTURE = new Set(["github-oidc", "ecs-task-role"]);

function cosine(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb);
}

const validVector = (vector: readonly number[] | undefined, dimensions: number): boolean =>
  Array.isArray(vector) && vector.length === dimensions && vector.every((value) => Number.isFinite(value)) && vector.some((value) => value !== 0);

/** Embeds the control set: queries as queries, documents as documents (one call each). */
export async function embedControlSet(embedder: EmbeddingProvider, set: ControlSet = EMBEDDING_CONTROL_SET): Promise<Record<string, number[]>> {
  if (set !== EMBEDDING_CONTROL_SET) throw new Error("Kun det versionerede kontrolsæt kan embeddes.");
  const vectors: Record<string, number[]> = {};
  for (const inputType of ["query", "document"] as const) {
    const texts = set.texts.filter((entry) => entry.inputType === inputType);
    const embedded = await embedder.embed(texts.map((entry) => syntheticText(entry.text)), { inputType });
    texts.forEach((entry, i) => {
      vectors[entry.id] = embedded[i]!;
    });
  }
  return vectors;
}

/** A DRAFT reference: not approved and not calibrated. It becomes production only by a person's decision. */
export async function captureControlReference(
  embedder: EmbeddingProvider,
  capture: ControlReference["capture"],
): Promise<ControlReference> {
  const descriptor = embedder.descriptor;
  return {
    schema: 1,
    controlSet: { id: EMBEDDING_CONTROL_SET.id, version: EMBEDDING_CONTROL_SET.version, checksum: controlSetChecksum() },
    model: { provider: descriptor.provider, model: descriptor.model, modelVersion: descriptor.modelVersion, dimensions: descriptor.dimensions },
    settings: descriptor.settings,
    embeddingFingerprint: embeddingMaterialChecksum(descriptor),
    vectors: await embedControlSet(embedder),
    tolerances: null,
    capture,
    approval: null,
  };
}

/**
 * Why a reference cannot be the production reference. Empty = it can. A fake, a development
 * capture, an unapproved or uncalibrated reference, or one for another control set never can.
 */
export function productionReferenceProblems(reference: ControlReference): string[] {
  const problems: string[] = [];
  const set = EMBEDDING_CONTROL_SET;
  if (reference.schema !== 1) problems.push("schema");
  if (reference.controlSet.id !== set.id || reference.controlSet.version !== set.version || reference.controlSet.checksum !== controlSetChecksum()) problems.push("control_set");
  if (reference.model.provider === "test" || reference.model.provider === "") problems.push("development_model");
  if (!REAL_PROVIDER_CAPTURE.has(reference.capture.credentialSource)) problems.push("not_a_real_provider_capture");
  const dimensions = reference.model.dimensions;
  for (const entry of set.texts) {
    const vector = reference.vectors[entry.id];
    if (!validVector(vector, dimensions)) {
      problems.push(`vector:${entry.id}`);
      continue;
    }
    // A development fake (the test embedder, or 8B's fake transport) hashes the words of the text.
    if (cosine(vector!, hashEmbedding(entry.text, dimensions)) > 0.999) problems.push(`fake_vector:${entry.id}`);
  }
  const tolerances = reference.tolerances;
  if (
    !tolerances ||
    !Number.isInteger(tolerances.version) || tolerances.version < 1 ||
    !(tolerances.minCosineToReference > 0 && tolerances.minCosineToReference <= 1) ||
    !(tolerances.minRelationalMargin >= 0 && tolerances.minRelationalMargin < 2) ||
    tolerances.calibration.trim().length < 20
  ) {
    problems.push("tolerances_not_calibrated");
  }
  const approval = reference.approval;
  if (!approval || !/^B-\d{3}$/.test(approval.decision) || approval.approvedBy.trim() === "" || Number.isNaN(Date.parse(approval.approvedAt))) problems.push("not_approved");
  return problems;
}

export type ControlStatus = "pass" | "fail";

export interface ControlResult {
  status: ControlStatus;
  /** Codes, never vectors or texts. */
  problems: string[];
  minCosine: number | null;
  minMargin: number | null;
}

/** Compares vectors of the control set with a production reference for this embedder. */
export function compareWithReference(vectors: Readonly<Record<string, readonly number[]>>, reference: ControlReference, descriptor: EmbeddingProviderDescriptor): ControlResult {
  const problems = productionReferenceProblems(reference).map((problem) => `reference:${problem}`);
  if (problems.length > 0) return { status: "fail", problems, minCosine: null, minMargin: null };
  const tolerances = reference.tolerances!;
  if (reference.model.provider !== descriptor.provider || reference.model.model !== descriptor.model) problems.push("model");
  if (reference.model.modelVersion !== descriptor.modelVersion) problems.push("model_version");
  if (reference.model.dimensions !== descriptor.dimensions) problems.push("reference_dimensions");
  if (canonicalJson(reference.settings) !== canonicalJson(descriptor.settings)) problems.push("settings");
  if (reference.embeddingFingerprint !== embeddingMaterialChecksum(descriptor)) problems.push("embedding_fingerprint");

  let minCosine: number | null = null;
  for (const entry of EMBEDDING_CONTROL_SET.texts) {
    const vector = vectors[entry.id];
    if (!validVector(vector, descriptor.dimensions)) {
      problems.push(`dimensions:${entry.id}`);
      continue;
    }
    const similarity = cosine(vector!, reference.vectors[entry.id]!);
    minCosine = minCosine === null ? similarity : Math.min(minCosine, similarity);
    if (similarity < tolerances.minCosineToReference) problems.push(`cosine:${entry.id}`);
  }
  let minMargin: number | null = null;
  for (const relation of EMBEDDING_CONTROL_SET.relations) {
    const [anchor, closer, farther] = [vectors[relation.anchor], vectors[relation.closer], vectors[relation.farther]];
    if (!anchor || !closer || !farther) continue;
    const margin = cosine(anchor, closer) - cosine(anchor, farther);
    minMargin = minMargin === null ? margin : Math.min(minMargin, margin);
    if (margin < tolerances.minRelationalMargin) problems.push(`relation:${relation.anchor}`);
  }
  return { status: problems.length === 0 ? "pass" : "fail", problems, minCosine, minMargin };
}

/** Embeds the control set and compares. A provider error is thrown (not drift): the caller decides. */
export async function runControlCheck(embedder: EmbeddingProvider, reference: ControlReference): Promise<ControlResult> {
  const referenceProblems = productionReferenceProblems(reference);
  if (referenceProblems.length > 0) return { status: "fail", problems: referenceProblems.map((problem) => `reference:${problem}`), minCosine: null, minMargin: null };
  return compareWithReference(await embedControlSet(embedder), reference, embedder.descriptor);
}

/** The approved reference for a registered model, if there is one. */
export function referenceFor(model: Pick<EmbeddingModelSpec, "provider" | "model_name" | "model_version" | "dimensions">, references: readonly ControlReference[]): ControlReference | null {
  return (
    references.find(
      (reference) =>
        reference.model.provider === model.provider &&
        reference.model.model === model.model_name &&
        reference.model.modelVersion === model.model_version &&
        reference.model.dimensions === model.dimensions,
    ) ?? null
  );
}

/** The version label a runtime reports after a failed control check: it no longer IS the declared model. */
export const CONTROL_DRIFT_MARKER = "+control-drift";

/**
 * The runtime material of an embedder that failed the control check (the evaluation's H6 path):
 * the same model, but with a version label that says it is no longer the approved one, so the
 * runtime fingerprint differs from the declared configuration.
 */
export function withControlDriftMarker<T extends Pick<EmbeddingProviderDescriptor, "modelVersion">>(descriptor: T): T {
  return Object.freeze({ ...descriptor, modelVersion: `${descriptor.modelVersion}${CONTROL_DRIFT_MARKER}` });
}
