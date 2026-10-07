import { RESTRICTED_CONFLICT_MESSAGE, type EvidenceItem, type EvidenceSet } from "../../src/lib/knowledge/core/evidence.ts";
import { embeddingLabel } from "../../src/lib/knowledge/core/provider.ts";

import type {
  CaseObservation,
  ConfigurationInput,
  CorpusBinding,
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
  return {
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
}

/**
 * H6 (docs/08b §4.4): the evidence must come from exactly the configuration under evaluation,
 * with production implementations. Every reason is reported once per set.
 */
export function developmentEvidence(caseId: string, run: RetrievalRun, configuration: ConfigurationInput): Violation[] {
  const reasons: string[] = [];
  const retrieval = run.set.retrieval;
  // H6 judges the IMPLEMENTATIONS, not the set's P1–P9 grade (8B-I6): a configuration under
  // evaluation is by definition not yet active, so its evidence can never meet P3 — the grade
  // would make every evaluation fail. Development implementations, devOverride, another
  // embedding model or reranker, the runtime fingerprint (runner.ts) and chunker versions are
  // all checked here.
  if (retrieval.devOverride) reasons.push("Evidensen er fremtvunget af et udviklingsværktøj.");
  if (retrieval.reranker.id === "none") reasons.push('Rerankeren er "none".');
  if (retrieval.reranker.grade !== "production") reasons.push(`Rerankeren har graden "${retrieval.reranker.grade}".`);
  if (!retrieval.embeddingModel) reasons.push("Forespørgslen er ikke embedded med en aktiv model.");
  else if (retrieval.embeddingModel.grade !== "production") reasons.push(`Embedding-modellen har graden "${retrieval.embeddingModel.grade}".`);
  const expectedModel = configuration.embedding ? embeddingLabel(configuration.embedding) : null;
  if ((retrieval.embeddingModel?.id ?? null) !== expectedModel) {
    reasons.push(`Embedding-modellen (${retrieval.embeddingModel?.id ?? "ingen"}) er ikke den evaluerede (${expectedModel ?? "ingen"}).`);
  }
  if (retrieval.reranker.id !== configuration.reranker.id || retrieval.reranker.version !== configuration.reranker.version) {
    reasons.push(`Rerankeren (${retrieval.reranker.id}@${retrieval.reranker.version}) er ikke den evaluerede (${configuration.reranker.id}@${configuration.reranker.version}).`);
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
