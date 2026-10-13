import { RESTRICTED_CONFLICT_MESSAGE, type EvidenceItem, type EvidenceSet } from "../../src/lib/knowledge/core/evidence.ts";
import { embeddingLabel, isDocumentMaterial, retrievalMethodOf, sha256 } from "../../src/lib/knowledge/core/provider.ts";

import type {
  CaseObservation,
  ConfigurationInput,
  CorpusBinding,
  DocumentObservation,
  DocumentRef,
  EvalCase,
  ExpectedPassage,
  HardGateId,
  Manifest,
  ManifestVersion,
  RetrievalRun,
  Violation,
} from "./types.ts";

/**
 * Observes one retrieval result against its facit (docs/08b §4.2, §5.4) and finds every breach
 * of the per-case hard gates H1–H6 (docs/08b §4.4). Pure and deterministic.
 *
 * Fail-closed throughout: anything the engine cannot attribute or verify — an unknown document
 * id, an unknown version, a missing chunker version — is a breach, never a pass.
 */

/** Text normalization for anchors: NFC, whitespace collapsed (as docs/07 §5). Case is kept. */
export function normalizeText(text: string): string {
  return text.normalize("NFC").replace(/\s+/g, " ").trim();
}

/** Today's date in Danish time, the date the database uses for `current` (docs/07 §3.4). */
export function danishDateOf(iso: string): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Copenhagen" }).format(new Date(iso));
}

/** The published version valid on a date, by the half-open interval [validFrom, validTo). */
export function versionValidOn(versions: readonly ManifestVersion[], date: string): ManifestVersion | null {
  return (
    versions.find(
      (version) =>
        version.status === "published" && version.validFrom !== null && version.validFrom <= date && (version.validTo === null || date < version.validTo),
    ) ?? null
  );
}

export interface ObservationContext {
  manifest: Manifest;
  binding: CorpusBinding;
  configuration: ConfigurationInput;
  k: number;
  /** Normalized text of a version, for checking where an excerpt comes from (H2). */
  versionText(document: string, version: string): string | null;
}

interface ResolvedItem {
  item: EvidenceItem;
  rank: number;
  document: string | null;
  version: string | null;
}

/** Reverse lookups from runtime ids to manifest keys. */
function reverse(binding: CorpusBinding) {
  const documents = new Map<string, string>();
  const versions = new Map<string, { document: string; version: string }>();
  for (const [document, entry] of Object.entries(binding.documents)) {
    documents.set(entry.documentId, document);
    for (const [version, id] of Object.entries(entry.versions)) versions.set(id, { document, version });
  }
  const products = new Map(Object.entries(binding.products).map(([key, id]) => [id, key]));
  return { documents, versions, products };
}

function covers(resolved: ResolvedItem, passage: ExpectedPassage): boolean {
  if (resolved.document !== passage.document || resolved.version !== passage.version) return false;
  const anchor = normalizeText(passage.anchor);
  return normalizeText(resolved.item.excerpt.text).includes(anchor) || normalizeText(resolved.item.excerpt.leadIn ?? "").includes(anchor);
}

function matchesRef(resolved: ResolvedItem, ref: DocumentRef): boolean {
  return resolved.document === ref.document && (ref.version === undefined || resolved.version === ref.version);
}

export function observeCase(evalCase: EvalCase, run: RetrievalRun, context: ObservationContext): CaseObservation {
  const { manifest, binding, k } = context;
  const lookup = reverse(binding);
  const set: EvidenceSet = run.set;
  const violations: Violation[] = [];
  const breach = (gate: HardGateId, explanation: string) => violations.push({ gate, caseId: evalCase.id, explanation });

  const actor = manifest.actors.find((entry) => entry.id === evalCase.actor)!;
  const grants = new Map(actor.grants.map((grant) => [grant.document, grant]));
  const documents = new Map(manifest.documents.map((document) => [document.key, document]));

  const resolved: ResolvedItem[] = set.items.map((item, i) => {
    const version = lookup.versions.get(item.documentVersionId) ?? null;
    const document = lookup.documents.get(item.documentId) ?? null;
    return { item, rank: i + 1, document, version: version && version.document === document ? version.version : null };
  });

  // ------------------------------------------------------------------------- H1 — access
  for (const entry of resolved) {
    if (entry.document === null || entry.version === null) {
      breach("H1", `Element ${entry.rank} kommer fra et dokument eller en version, der ikke findes i manifestet, så adgangen kan ikke efterprøves.`);
      continue;
    }
    const grant = grants.get(entry.document);
    if (!grant) breach("H1", `Element ${entry.rank} kommer fra ${entry.document}, som ${actor.id} ikke har adgang til.`);
    else if (entry.item.validity.temporalStatus === "historical" && !grant.historical) {
      breach("H1", `Element ${entry.rank} er en historisk version af ${entry.document}, men ${actor.id} har ikke historisk læseadgang.`);
    }
  }

  // ------------------------------------------------------------------------- H2 — metadata leakage
  const haystack = JSON.stringify({ set, raw: run.raw ?? null });
  for (const document of manifest.documents) {
    if (grants.has(document.key)) continue;
    const bound = binding.documents[document.key];
    const markers: [string, string][] = [];
    if (bound) {
      markers.push(["dokument-id", bound.documentId], ["titel", bound.title]);
      for (const [label, id] of Object.entries(bound.versions)) markers.push([`version-id (${label})`, id]);
    }
    for (const conflict of manifest.conflicts) {
      const runtimeId = binding.conflicts[conflict.id];
      if (conflict.documents.includes(document.key) && runtimeId) markers.push([`konflikt-id (${conflict.id})`, runtimeId]);
    }
    for (const [label, marker] of markers) {
      if (marker.length > 0 && haystack.includes(marker)) breach("H2", `Resultatet indeholder ${label} fra ${document.key}, som ${actor.id} ikke har adgang til.`);
    }
  }
  for (const entry of resolved) {
    // An excerpt must come from the version it is attributed to — otherwise text from another
    // (possibly inaccessible) document travels under a false label.
    if (entry.document && entry.version) {
      const own = context.versionText(entry.document, entry.version);
      const excerpt = normalizeText(entry.item.excerpt.text);
      if (own !== null && excerpt.length > 0 && !own.includes(excerpt)) {
        const source = manifest.documents.find(
          (document) => !grants.has(document.key) && document.versions.some((version) => context.versionText(document.key, version.label)?.includes(excerpt)),
        );
        breach("H2", `Uddraget i element ${entry.rank} findes ikke i ${entry.document} v${entry.version}${source ? `, men i ${source.key}, som ${actor.id} ikke har adgang til` : ""}.`);
      }
    }
    for (const conflict of entry.item.conflicts) {
      if (conflict.visibility === "restricted") {
        const keys = Object.keys(conflict).sort().join(",");
        if (keys !== "message,visibility" || conflict.message !== RESTRICTED_CONFLICT_MESSAGE) {
          breach("H2", `Den neutrale konfliktindikator i element ${entry.rank} bærer andet end den faste tekst (B-20).`);
        }
      }
    }
  }

  // ------------------------------------------------------------------------- H3 — validity
  const today = danishDateOf(set.retrieval.generatedAt);
  const date = evalCase.mode === "as_of" ? evalCase.asOf! : today;
  if (set.query.mode !== evalCase.mode) breach("H3", `Retrieval kørte i tilstanden "${set.query.mode}", men spørgsmålet kræver "${evalCase.mode}".`);
  if (evalCase.mode === "as_of" && set.query.asOf !== evalCase.asOf) breach("H3", `Retrieval brugte datoen ${set.query.asOf}, men spørgsmålet gælder ${evalCase.asOf}.`);
  const seenDocuments = new Map<string, string>();
  for (const entry of resolved) {
    if (!entry.document || !entry.version) continue;
    const manifestDocument = documents.get(entry.document)!;
    const version = manifestDocument.versions.find((candidate) => candidate.label === entry.version)!;
    const valid = versionValidOn(manifestDocument.versions, date);
    const validToday = versionValidOn(manifestDocument.versions, today);
    if (version.status !== "published") breach("H3", `Element ${entry.rank} er en tilbagetrukket version (${entry.document} v${entry.version}).`);
    else if (!valid || valid.label !== entry.version) {
      breach("H3", `Element ${entry.rank} (${entry.document} v${entry.version}) er ikke den version, der gælder ${date}${valid ? ` (v${valid.label})` : ""}.`);
    }
    const expectedStatus = validToday?.label === entry.version ? "current" : "historical";
    if (version.status === "published" && valid?.label === entry.version && entry.item.validity.temporalStatus !== expectedStatus) {
      breach("H3", `Element ${entry.rank} er markeret "${entry.item.validity.temporalStatus}", men er ${expectedStatus === "historical" ? "historisk" : "gældende"}.`);
    }
    const previous = seenDocuments.get(entry.document);
    if (previous !== undefined && previous !== entry.version) breach("H3", `Resultatet blander to versioner af ${entry.document} (v${previous} og v${entry.version}).`);
    seenDocuments.set(entry.document, entry.version);
    for (const ref of evalCase.expected.mustNotInclude ?? []) {
      if (matchesRef(entry, ref)) breach("H3", `Element ${entry.rank} er ${ref.document}${ref.version ? ` v${ref.version}` : ""}, som facit udelukker.`);
    }
  }

  // ------------------------------------------------------------------------- H4 — filters
  const filters = evalCase.filters;
  // product_documents (B-036): the basis is exactly ONE product, and the retrieval must have been
  // asked for exactly that product's stable id — never another or several.
  const documentMethod = isDocumentMaterial(context.configuration);
  if (documentMethod) {
    const wanted = filters?.products?.length === 1 ? (binding.products[filters.products[0]!] ?? null) : null;
    const asked = set.query.filters.productIds ?? [];
    if (wanted === null || asked.length !== 1 || asked[0] !== wanted) breach("H4", `Retrieval blev ikke spurgt om netop spørgsmålets ene produkt (${asked.length === 0 ? "intet produkt" : asked.join(", ")}).`);
  }
  if (filters) {
    for (const entry of resolved) {
      const product = lookup.products.get(entry.item.product.id) ?? null;
      if (filters.products && (!product || !filters.products.includes(product))) breach("H4", `Element ${entry.rank} ligger uden for produktfiltret (${product ?? "ukendt produkt"}).`);
      if (filters.documentTypes && !filters.documentTypes.includes(entry.item.document.type)) breach("H4", `Element ${entry.rank} har dokumenttypen "${entry.item.document.type}" uden for filtret.`);
      if (filters.documents && (!entry.document || !filters.documents.includes(entry.document))) breach("H4", `Element ${entry.rank} ligger uden for dokumentfiltret.`);
    }
  }

  // ------------------------------------------------------------------------- H5 — hidden conflict
  for (const entry of resolved) {
    if (!entry.document) continue;
    for (const conflict of manifest.conflicts) {
      if (conflict.status !== "open" || !conflict.documents.includes(entry.document)) continue;
      const counterpart = conflict.documents[0] === entry.document ? conflict.documents[1] : conflict.documents[0];
      const counterpartDocument = documents.get(counterpart)!;
      if (!versionValidOn(counterpartDocument.versions, date)) continue; // No valid counterpart that day: no conflict to show.
      if (grants.has(counterpart)) {
        if (!entry.item.conflicts.some((marker) => marker.visibility === "visible")) breach("H5", `Element ${entry.rank} (${entry.document}) er i en åben konflikt med ${counterpart}, men er ikke markeret.`);
        if (!resolved.some((other) => other.document === counterpart)) breach("H5", `Element ${entry.rank} (${entry.document}) er i konflikt med ${counterpart}, som ${actor.id} har adgang til, men kun den ene part er returneret.`);
      } else if (!entry.item.conflicts.some((marker) => marker.visibility === "restricted")) {
        breach("H5", `Element ${entry.rank} (${entry.document}) er i konflikt med et dokument, ${actor.id} ikke kan se, men mangler den neutrale indikator.`);
      }
    }
  }

  // ------------------------------------------------------------------------- H6 — development evidence (per set)
  violations.push(...developmentEvidence(evalCase.id, run, context.configuration));

  // ------------------------------------------------------------------------- metrics
  const withinK = resolved.slice(0, k);
  const passages = evalCase.expected.passages;
  // The grade-3 passages are the required set. Their order in the facit carries no meaning:
  // a passage counts once it is covered anywhere within K (Passage Recall, Full Coverage).
  const grade3 = passages.filter((passage) => passage.grade === 3);
  const expectedVersions = passages.map((passage) => ({ document: passage.document, version: passage.version }));
  const firstRank = (predicate: (entry: ResolvedItem) => boolean) => withinK.find(predicate)?.rank ?? null;

  const credited = new Set<ExpectedPassage>();
  const gainsByRank = withinK.map((entry) => {
    const fresh = passages.filter((passage) => !credited.has(passage) && covers(entry, passage));
    for (const passage of fresh) credited.add(passage);
    return Math.max(0, ...fresh.map((passage) => passage.grade));
  });

  const distractors = evalCase.expected.distractors ?? [];
  const observation: CaseObservation = {
    caseId: evalCase.id,
    type: evalCase.type,
    split: evalCase.split,
    outcome: evalCase.expected.outcome,
    itemCount: set.items.length,
    empty: set.items.length === 0,
    sourceRank: firstRank((entry) => expectedVersions.some((ref) => matchesRef(entry, ref))),
    firstGrade3Rank: firstRank((entry) => grade3.some((passage) => covers(entry, passage))),
    requiredCovered: grade3.filter((passage) => withinK.some((entry) => covers(entry, passage))).length,
    requiredTotal: grade3.length,
    gainsByRank,
    idealGains: passages.map((passage) => passage.grade as number).sort((a, b) => b - a).slice(0, k),
    itemsWithinK: withinK.length,
    distractorItems: withinK.filter((entry) => distractors.some((ref) => matchesRef(entry, ref))).length,
    violations,
    error: null,
  };
  if (documentMethod) {
    const documents = observeDocuments(evalCase, run, context, resolved, date, today);
    observation.documents = documents;
    // B-036: the whole basis is the method's contract. A valid version the actor may read that is
    // missing altogether is a breach with zero tolerance (H6), not only a quality miss (D4, D6).
    if (documents.missingVersions > 0) breach("H6", `Grundlaget mangler ${documents.missingVersions} gyldig(e) dokumentversion(er), som brugeren må læse.`);
  }
  return observation;
}

/** "document\u0000version" — a version as the manifest names it. */
const versionKey = (document: string, version: string) => `${document}\u0000${version}`;

/**
 * The basis a product_documents retrieval MUST deliver for a case (B-036), from the manifest:
 * every document of the case's product, in the case's language, document types and documents,
 * that the actor may read, in the version valid on the date. A historical version needs the
 * actor's historical grant. Nothing here comes from the retrieval under test.
 */
export function expectedBasis(evalCase: EvalCase, manifest: Manifest, date: string, today: string): Set<string> {
  const product = evalCase.filters?.products?.length === 1 ? evalCase.filters.products[0]! : null;
  const actor = manifest.actors.find((entry) => entry.id === evalCase.actor);
  const basis = new Set<string>();
  if (!product || !actor) return basis;
  const grants = new Map(actor.grants.map((grant) => [grant.document, grant]));
  for (const document of manifest.documents) {
    if (document.product !== product || document.language !== evalCase.language) continue;
    if (evalCase.filters?.documentTypes && !evalCase.filters.documentTypes.includes(document.type)) continue;
    if (evalCase.filters?.documents && !evalCase.filters.documents.includes(document.key)) continue;
    const grant = grants.get(document.key);
    const valid = versionValidOn(document.versions, date);
    if (!grant || !valid) continue;
    const historical = versionValidOn(document.versions, today)?.label !== valid.label;
    if (historical && !grant.historical) continue;
    basis.add(versionKey(document.key, valid.label));
  }
  return basis;
}

/**
 * What a product_documents basis held against what it must hold (B-036, D1–D6). The basis is the
 * items of the case's product within the case's document types and documents; a conflict
 * counterpart outside it is evidence because of the conflict and is judged by H4/H5, not here.
 */
function observeDocuments(evalCase: EvalCase, run: RetrievalRun, context: ObservationContext, resolved: ResolvedItem[], date: string, today: string): DocumentObservation {
  const { manifest, binding } = context;
  const productKey = evalCase.filters?.products?.length === 1 ? evalCase.filters.products[0]! : null;
  const productId = productKey ? (binding.products[productKey] ?? null) : null;
  const filters = evalCase.filters ?? {};
  const inBasis = (entry: ResolvedItem) => {
    if (entry.item.product.id !== productId) return false;
    if (filters.documentTypes && !filters.documentTypes.includes(entry.item.document.type)) return false;
    if (filters.documents && (!entry.document || !filters.documents.includes(entry.document))) return false;
    return true;
  };

  const expected = expectedBasis(evalCase, manifest, date, today);
  const basisItems = resolved.filter(inBasis);
  const delivered = new Set(basisItems.map((entry) => (entry.document && entry.version ? versionKey(entry.document, entry.version) : `?\u0000${entry.item.documentVersionId}`)));
  const documentOf = (key: string) => key.split("\u0000")[0]!;
  const expectedDocuments = new Set([...expected].map(documentOf));
  const deliveredDocuments = new Set([...delivered].map(documentOf));

  const asked = run.set.query.filters.productIds ?? [];
  const required = new Set(evalCase.expected.passages.map((passage) => versionKey(passage.document, passage.version)));
  const anyItem = new Set(resolved.flatMap((entry) => (entry.document && entry.version ? [versionKey(entry.document, entry.version)] : [])));
  const grade3 = evalCase.expected.passages.filter((passage) => passage.grade === 3);

  return {
    expectedVersions: expected.size,
    deliveredVersions: delivered.size,
    missingVersions: [...expected].filter((key) => !delivered.has(key)).length,
    unexpectedVersions: [...delivered].filter((key) => !expected.has(key)).length,
    missingDocuments: [...expectedDocuments].filter((key) => !deliveredDocuments.has(key)).length,
    unexpectedDocuments: [...deliveredDocuments].filter((key) => !expectedDocuments.has(key)).length,
    incompleteVersions: versionIntegrityProblems(run, productId, filters.documentTypes, filters.documents?.map((key) => binding.documents[key]?.documentId ?? "")).size,
    productQueried: productId !== null && asked.length === 1 && asked[0] === productId,
    foreignProductItems: resolved.filter((entry) => entry.item.product.id !== productId).length,
    requiredDocuments: required.size,
    requiredDocumentsCovered: [...required].filter((key) => anyItem.has(key)).length,
    requiredPassages: grade3.length,
    requiredPassagesCovered: grade3.filter((passage) => resolved.some((entry) => covers(entry, passage))).length,
  };
}

/**
 * H6 (docs/08b §4.4): the evidence must come from exactly the configuration under evaluation,
 * with production implementations. Every reason is reported once per set.
 *
 * product_documents (B-035, adapted explicitly and only for that method): the evidence must come
 * from that method — no embedder, no reranker — and every document version of the selected basis
 * (the case's product, document types and documents) must be included IN FULL: exactly the
 * version's chunks in the corpus, each once, contiguous and in chunk order, each chunk's text
 * unabridged (B-036). The basis never exceeds the budget. The corpus counts and chunk digests come
 * from the adapter (`versionChunkCounts`, `chunkDigests`); without them H6 fails.
 */
export function developmentEvidence(caseId: string, run: RetrievalRun, configuration: ConfigurationInput): Violation[] {
  const reasons: string[] = [];
  const retrieval = run.set.retrieval;
  if (retrieval.devOverride) reasons.push("Evidensen er fremtvunget af et udviklingsværktøj.");
  const declaredMethod = retrievalMethodOf(configuration);
  if (retrieval.method !== declaredMethod) reasons.push(`Metoden (${retrieval.method}) er ikke den evaluerede (${declaredMethod}).`);
  if (isDocumentMaterial(configuration)) {
    if (retrieval.embeddingModel !== null) reasons.push(`Der blev brugt en embedding-model (${retrieval.embeddingModel.id}); metoden har ingen.`);
    if (retrieval.reranker !== null) reasons.push(`Der blev brugt en reranker (${retrieval.reranker.id}); metoden har ingen.`);
    reasons.push(...incompleteVersions(run, configuration));
  } else {
    // H6 judges the IMPLEMENTATIONS, not the set's P1–P9 grade (8B-I6): a configuration under
    // evaluation is by definition not yet active, so its evidence can never meet P3 — the grade
    // would make every evaluation fail. Development implementations, devOverride, another
    // embedding model or reranker, the runtime fingerprint (runner.ts) and chunker versions are
    // all checked here.
    const declaredReranker = configuration.reranker;
    if (!retrieval.reranker) reasons.push("Der kørte ingen reranker.");
    else {
      if (retrieval.reranker.id === "none") reasons.push('Rerankeren er "none".');
      if (retrieval.reranker.grade !== "production") reasons.push(`Rerankeren har graden "${retrieval.reranker.grade}".`);
    }
    if (!retrieval.embeddingModel) reasons.push("Forespørgslen er ikke embedded med en aktiv model.");
    else if (retrieval.embeddingModel.grade !== "production") reasons.push(`Embedding-modellen har graden "${retrieval.embeddingModel.grade}".`);
    const expectedModel = configuration.embedding ? embeddingLabel(configuration.embedding) : null;
    if ((retrieval.embeddingModel?.id ?? null) !== expectedModel) {
      reasons.push(`Embedding-modellen (${retrieval.embeddingModel?.id ?? "ingen"}) er ikke den evaluerede (${expectedModel ?? "ingen"}).`);
    }
    if (retrieval.reranker && (retrieval.reranker.id !== declaredReranker.id || retrieval.reranker.version !== declaredReranker.version)) {
      reasons.push(`Rerankeren (${retrieval.reranker.id}@${retrieval.reranker.version}) er ikke den evaluerede (${declaredReranker.id}@${declaredReranker.version}).`);
    }
  }
  const allowed = new Set(configuration.chunkerVersions);
  const uncovered = new Set<string>();
  for (const item of run.set.items) {
    for (const chunkId of item.chunkIds) {
      const version = run.chunkerVersions[chunkId];
      if (version === undefined || !allowed.has(version)) uncovered.add(version ?? "ukendt");
    }
  }
  if (uncovered.size > 0) reasons.push(`Elementer fra chunker-versioner, konfigurationen ikke dækker: ${[...uncovered].sort().join(", ")}.`);
  return reasons.map((explanation) => ({ gate: "H6" as const, caseId, explanation }));
}

/**
 * product_documents (B-035, B-036): every document version of the selected basis must be included
 * in full — the version's chunks in the corpus, each once, as one contiguous run in chunk order,
 * each chunk's text unabridged — and the basis must fit the configuration's budget. The basis is
 * what the case asked for: its product, and its document types and documents when given. A
 * conflict counterpart outside it is evidence because of the conflict (as in hybrid retrieval) and
 * is not part of the basis.
 *
 * Returns the problems by version id; an empty map means the basis is whole.
 */
export function versionIntegrityProblems(run: RetrievalRun, productId: string | null, documentTypes?: readonly string[], documentIds?: readonly string[]): Map<string, string> {
  const problems = new Map<string, string>();
  const counts = run.versionChunkCounts;
  const digests = run.chunkDigests;
  const items = run.set.items;
  const inBasis = basisPredicate(productId, documentTypes, documentIds);
  const positions = new Map<string, number[]>();
  items.forEach((item, i) => {
    if (!inBasis(item)) return;
    const list = positions.get(item.documentVersionId) ?? [];
    list.push(i);
    positions.set(item.documentVersionId, list);
  });
  for (const [versionId, at] of positions) {
    const expected = counts?.[versionId];
    const versionItems = at.map((i) => items[i]!);
    const chunkIds = versionItems.flatMap((item) => item.chunkIds);
    const problem = (() => {
      if (expected === undefined) return `antallet af chunks i korpusset er ukendt`;
      if (versionItems.some((item) => item.chunkIds.length !== 1)) return `et element samler flere chunks`;
      if (new Set(chunkIds).size !== chunkIds.length || chunkIds.length !== expected) return `${new Set(chunkIds).size} af ${expected} chunks`;
      if (at.some((position, i) => i > 0 && position !== at[i - 1]! + 1)) return `versionens chunks er spredt i resultatet`;
      if (versionItems.some((item, i) => i > 0 && item.chunkIndex !== versionItems[i - 1]!.chunkIndex + 1)) return `chunks er ikke i dokumentets rækkefølge`;
      if (!digests) return `chunkenes tekst kan ikke efterprøves`;
      if (versionItems.some((item) => digests[item.chunkIds[0]!] !== sha256(item.excerpt.text))) return `en chunks tekst er ikke leveret uforkortet`;
      return null;
    })();
    if (problem) problems.set(versionId, problem);
  }
  return problems;
}

/** The items of a product_documents basis: the product, within the document types and documents. */
function basisPredicate(productId: string | null, documentTypes?: readonly string[], documentIds?: readonly string[]) {
  return (item: EvidenceItem) =>
    item.product.id === productId && (!documentTypes || documentTypes.includes(item.document.type)) && (!documentIds || documentIds.includes(item.documentId));
}

function incompleteVersions(run: RetrievalRun, configuration: ConfigurationInput): string[] {
  if (!run.versionChunkCounts) return ["Fuldstændigheden kan ikke efterprøves: adapteren oplyser ikke versionernes antal chunks."];
  if (!run.chunkDigests) return ["Fuldstændigheden kan ikke efterprøves: adapteren oplyser ikke chunkenes tekst."];
  const filters = run.set.query.filters;
  const product = filters.productIds?.length === 1 ? filters.productIds[0]! : null;
  if (!product) return ["Metoden kræver netop ét produkt, men forespørgslen havde ikke ét."];
  const reasons = [...versionIntegrityProblems(run, product, filters.documentTypes, filters.documentIds)].map(
    ([versionId, problem]) => `Dokumentversionen ${versionId} er ikke medtaget i fuld længde (${problem}).`,
  );
  // The budget (B-036): the basis never exceeds maxChars. Over budget the retrieval must refuse;
  // a basis that is delivered anyway has been neither refused nor kept within the limit.
  if (isDocumentMaterial(configuration)) {
    const inBasis = basisPredicate(product, filters.documentTypes, filters.documentIds);
    const chars = run.set.items.filter(inBasis).reduce((sum, item) => sum + item.excerpt.text.length, 0);
    if (chars > configuration.params.maxChars) reasons.push(`Grundlaget er ${chars} tegn og overskrider budgettet på ${configuration.params.maxChars}.`);
  }
  return reasons;
}
