"use client";

import { FlaskConical, ShieldAlert } from "lucide-react";
import { useState, useTransition } from "react";

import { Field, FormError, SelectInput, TextInput } from "@/components/knowledge-admin/form";
import { SourceCard } from "@/components/knowledge/source-card";
import { InsufficientEvidence } from "@/components/knowledge/insufficient-evidence";
import { ErrorState } from "@/components/states/error-state";
import { StatusBadge } from "@/components/status/status-badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { testRetrieval } from "@/lib/knowledge/admin-actions";
import type { EvidenceSet } from "@/lib/knowledge/admin-types";
import { INSUFFICIENT_TITLE, presentRetrieval, UNAVAILABLE_TITLE, type RetrievalOutcome } from "@/lib/knowledge/result-presentation";
import { FORCE_INSUFFICIENT_LABEL } from "@/dev/knowledge/force-insufficient";
import { DOCUMENT_TYPES } from "@/lib/knowledge/document-types";
import { evidenceToSource } from "@/lib/knowledge/evidence-source";

/**
 * "Afprøv retrieval" (docs/07 §12.1) — read only, for the signed-in user only. Calls the same
 * retrieveEvidence as later modules; it cannot choose a reranker or change weights. The query
 * is not stored.
 */
export function RetrievalTool({ products, devTools }: { products: readonly { id: string; name: string }[]; devTools: boolean }) {
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<string[]>([]);
  const [outcome, setOutcome] = useState<RetrievalOutcome | null>(null);
  const [form, setForm] = useState({ query: "", mode: "current", asOf: "", productId: "", documentType: "", topK: "8" });
  const [forceInsufficient, setForceInsufficient] = useState(false);

  function search() {
    setErrors([]);
    startTransition(async () => {
      const result = await testRetrieval({
        query: form.query,
        mode: form.mode === "as_of" ? "as_of" : "current",
        asOf: form.mode === "as_of" ? form.asOf : undefined,
        productIds: form.productId ? [form.productId] : undefined,
        documentTypes: form.documentType ? [form.documentType] : undefined,
        topK: Number(form.topK),
      }, { devForceInsufficient: devTools && forceInsufficient });
      setOutcome(result);
    });
  }

  return (
    <div className="space-y-8">
      <Card className="space-y-4">
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            search();
          }}
        >
          <Field label="Forespørgsel" hint="Gemmes ikke og logges ikke.">
            <TextInput value={form.query} onChange={(event) => setForm({ ...form, query: event.target.value })} maxLength={1000} required />
          </Field>
          <div className="grid gap-3 md:grid-cols-5">
            <Field label="Tilstand">
              <SelectInput value={form.mode} onChange={(event) => setForm({ ...form, mode: event.target.value })}>
                <option value="current">Gældende i dag</option>
                <option value="as_of">Gældende på dato</option>
              </SelectInput>
            </Field>
            <Field label="Dato">
              <TextInput type="date" disabled={form.mode !== "as_of"} value={form.asOf} onChange={(event) => setForm({ ...form, asOf: event.target.value })} />
            </Field>
            <Field label="Produkt">
              <SelectInput value={form.productId} onChange={(event) => setForm({ ...form, productId: event.target.value })}>
                <option value="">Alle</option>
                {products.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.name}
                  </option>
                ))}
              </SelectInput>
            </Field>
            <Field label="Dokumenttype">
              <SelectInput value={form.documentType} onChange={(event) => setForm({ ...form, documentType: event.target.value })}>
                <option value="">Alle</option>
                {DOCUMENT_TYPES.map((type) => (
                  <option key={type.key} value={type.key}>
                    {type.label}
                  </option>
                ))}
              </SelectInput>
            </Field>
            <Field label="Antal (topK)">
              <TextInput type="number" min={1} max={20} value={form.topK} onChange={(event) => setForm({ ...form, topK: event.target.value })} />
            </Field>
          </div>
          {devTools ? (
            <label className="flex w-fit items-center gap-2 rounded-md border border-warning/40 bg-warning-subtle px-3 py-2 text-body">
              <input type="checkbox" checked={forceInsufficient} onChange={(event) => setForceInsufficient(event.target.checked)} />
              {FORCE_INSUFFICIENT_LABEL} — kun lokalt og i test
            </label>
          ) : null}
          <FormError errors={errors} />
          <Button type="submit" variant="secondary" loading={pending}>
            <FlaskConical aria-hidden />
            Søg
          </Button>
        </form>
      </Card>

      {outcome ? <Outcome outcome={outcome} onRetry={search} /> : null}
    </div>
  );
}

/**
 * docs/04 §16: a system failure and "no documentation" must never look alike. The mapping is
 * presentRetrieval() — an unavailable retrieval can only become ErrorState.
 */
function Outcome({ outcome, onRetry }: { outcome: RetrievalOutcome; onRetry: () => void }) {
  switch (presentRetrieval(outcome)) {
    case "error":
      return (
        <ErrorState
          title={UNAVAILABLE_TITLE}
          actions={
            <Button variant="secondary" size="sm" onClick={onRetry}>
              Prøv igen
            </Button>
          }
        >
          {outcome.kind === "unavailable" ? outcome.message : null} Det er en systemfejl — ikke et svar om vidensgrundlaget.
        </ErrorState>
      );
    case "invalid":
    case "denied":
      return <FormError errors={[outcome.kind === "evidence" ? "" : outcome.message]} />;
    case "insufficient":
    case "evidence":
      return outcome.kind === "evidence" ? <Result set={outcome.set} /> : null;
  }
}

function Result({ set }: { set: EvidenceSet }) {
  const { retrieval } = set;
  return (
    <section aria-label="Resultat" className="space-y-4">
      {retrieval.devOverride ? (
        <div role="status" className="flex items-center gap-2 rounded-md border border-warning/40 bg-warning-subtle px-4 py-3 text-body font-medium">
          <ShieldAlert className="size-4 shrink-0" aria-hidden />
          Udviklingsværktøj: utilstrækkeligt grundlag er fremtvunget — retrieval er ikke kørt
        </div>
      ) : null}
      {retrieval.grade === "development" ? (
        <div role="status" className="flex items-center gap-2 rounded-md border border-warning/40 bg-warning-subtle px-4 py-3 text-body font-medium">
          <ShieldAlert className="size-4 shrink-0" aria-hidden />
          Udviklingsresultat — ikke produktionsevidens
        </div>
      ) : null}
      <Card className="grid gap-x-6 gap-y-1 text-body md:grid-cols-2">
        <p>
          <span className="text-fg-secondary">Kandidater:</span> {retrieval.candidateCount}
        </p>
        <p>
          <span className="text-fg-secondary">Evidensgrad:</span> {retrieval.grade}
        </p>
        <p>
          <span className="text-fg-secondary">Embedding-model:</span> {retrieval.embeddingModel ? `${retrieval.embeddingModel.id} (${retrieval.embeddingModel.grade})` : "ingen aktiv model — kun leksikalsk"}
        </p>
        <p>
          <span className="text-fg-secondary">Reranker:</span> {retrieval.reranker.id} {retrieval.reranker.version} ({retrieval.reranker.grade})
        </p>
        <p>
          <span className="text-fg-secondary">Konfiguration:</span>{" "}
          {retrieval.configuration ? `${retrieval.configuration.id} (${retrieval.configuration.fingerprint.slice(0, 12)}…, ${retrieval.configuration.algorithmVersion})` : "ingen i drift"}
        </p>
        {retrieval.unmet.length > 0 ? (
          <p>
            <span className="text-fg-secondary">Ikke opfyldt (P1–P9):</span> {retrieval.unmet.join(", ")}
          </p>
        ) : null}
        <p>
          <span className="text-fg-secondary">Gyldig på:</span> {set.query.asOf} ({set.query.mode === "current" ? "gældende" : "historisk opslag"})
        </p>
        <p>
          <span className="text-fg-secondary">Signaler:</span> {set.signals.itemCount} elementer, topscore {set.signals.topScore ?? "—"}
          {set.signals.hasConflicts ? ", konflikter" : ""}
          {set.signals.hasHistorical ? ", historisk" : ""}
        </p>
      </Card>
      {set.items.length === 0 ? (
        <InsufficientEvidence title={INSUFFICIENT_TITLE}>
          <p>
            {retrieval.devOverride
              ? "Fremtvunget af udviklingsværktøjet, så tilstanden kan ses. Retrieval er ikke kørt."
              : "Retrieval kørte, men fandt ingen passager, du har adgang til, gældende på datoen."}
          </p>
        </InsufficientEvidence>
      ) : null}
      <ol className="space-y-4">
        {set.items.map((item) => (
          <li key={item.evidenceId} className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
            <SourceCard source={evidenceToSource(item, set.items)} />
            <Card className="space-y-1 text-caption">
              <p className="font-mono text-fg-secondary">
                {item.evidenceId} · rank {item.relevance.rank} · score {item.relevance.score}
              </p>
              <p>RRF: {item.relevance.fusedScore} · vektor: {item.relevance.vectorScore ?? "—"} · leksikalsk: {item.relevance.lexicalScore ?? "—"}</p>
              <p>
                Begrundelser:{" "}
                {item.relevance.reasons
                  .map((reason) =>
                    reason.kind === "lexical_match"
                      ? `ord: ${reason.terms.join(", ")}`
                      : reason.kind === "vector_similarity"
                        ? `vektorlighed ${reason.score}`
                        : reason.kind === "fused_rank"
                          ? `RRF-rang ${reason.rank}`
                          : `reranker ${reason.score}`,
                  )
                  .join(" · ") || "—"}
              </p>
              <p>Kildehenvisning: {item.sourceReference.label}</p>
              {item.conflicts.map((conflict, i) =>
                conflict.visibility === "restricted" ? (
                  <StatusBadge key={i} status="conflict" label={conflict.message} className="whitespace-normal" />
                ) : (
                  <p key={i} className="text-knowledge-conflict">
                    Konflikt med {conflict.counterpartEvidenceId} (åben)
                  </p>
                ),
              )}
            </Card>
          </li>
        ))}
      </ol>
    </section>
  );
}
