import { modelLabel, type EmbeddingModelSpec, type EmbeddingProvider } from "../../src/lib/knowledge/core/embedding.ts";
import { ProviderError, providerErrorFields } from "../../src/lib/knowledge/core/provider.ts";
import { referenceFor, runControlCheck, type ControlReference } from "../../src/lib/knowledge/core/control-set.ts";
import { createAlert, type AlertSink } from "../../src/lib/observability/alerts.ts";

/**
 * The worker's embedding control check (docs/08b §2.5, §15; 8B-I8 C6): at startup and on a
 * schedule (daily by default), every active or candidate model with an approved reference is
 * embedded on the control set and compared.
 *
 *   * pass → a log line with the smallest cosine and margin;
 *   * fail → the provider no longer answers as the approved model: the worker stops embedding
 *     with it (fail closed — vectors of two model versions are never mixed in one index) and
 *     raises the critical alarm embedding_model_changed. A new version label, re-embedding and a
 *     new evaluation are a person's decision; nothing is accepted automatically;
 *   * a provider error is not drift: it is logged with its class, and the next check retries;
 *   * no approved reference (VALIDATION PENDING) → embedding_control_unverified in the log.
 */

export interface ControlGate {
  blocked(modelId: string): boolean;
  block(modelId: string): void;
}

export function createControlGate(): ControlGate {
  const blocked = new Set<string>();
  return Object.freeze({ blocked: (id: string) => blocked.has(id), block: (id: string) => void blocked.add(id) });
}

/** The embedder resolution, refusing a model the control check has stopped. */
export function guardedEmbedderFor(embedderFor: (model: EmbeddingModelSpec) => EmbeddingProvider, gate: ControlGate): (model: EmbeddingModelSpec) => EmbeddingProvider {
  return (model) => {
    if (gate.blocked(model.id)) {
      throw new ProviderError("configuration", model.provider, `${modelLabel(model)} svarer ikke længere som den godkendte reference (kontrolsættet). Der embeddes ikke med modellen.`);
    }
    return embedderFor(model);
  };
}

export interface ControlCheckDeps {
  embedderFor: (model: EmbeddingModelSpec) => EmbeddingProvider;
  references: readonly ControlReference[];
  gate: ControlGate;
  sink: AlertSink;
  log: (event: Record<string, unknown> & { event: string }) => void;
}

export async function checkEmbeddingControl(models: readonly EmbeddingModelSpec[], deps: ControlCheckDeps): Promise<void> {
  for (const model of models) {
    if (model.provider === "test") continue;
    const label = modelLabel(model);
    const reference = referenceFor(model, deps.references);
    if (!reference) {
      deps.log({ event: "embedding_control_unverified", model: label, reason: "no_approved_reference" });
      continue;
    }
    if (deps.gate.blocked(model.id)) continue;
    let result;
    try {
      result = await runControlCheck(deps.embedderFor(model), reference);
    } catch (error) {
      deps.log({ event: "embedding_control_error", model: label, ...providerErrorFields(error) });
      continue;
    }
    if (result.status === "pass") {
      deps.log({ event: "embedding_control_passed", model: label, min_cosine: result.minCosine, min_margin: result.minMargin });
      continue;
    }
    deps.gate.block(model.id);
    deps.log({ event: "embedding_control_failed", model: label, problems: result.problems.join(","), min_cosine: result.minCosine, min_margin: result.minMargin });
    await deps.sink.send(
      createAlert("embedding_model_changed", {
        model: label,
        model_id: model.id,
        problems: result.problems.join(","),
        min_cosine: result.minCosine ?? "n/a",
        min_margin: result.minMargin ?? "n/a",
      }),
    );
  }
}

export interface ControlMonitor {
  stop(): void;
}

/** Runs the check on a schedule; one at a time; a failing run never stops the worker. */
export function createControlMonitor(options: { intervalMs: number; run: () => Promise<void>; log: ControlCheckDeps["log"] }): ControlMonitor {
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    options
      .run()
      .catch((error: unknown) => options.log({ event: "embedding_control_error", ...providerErrorFields(error) }))
      .finally(() => {
        running = false;
      });
  }, options.intervalMs);
  timer.unref?.();
  return { stop: () => clearInterval(timer) };
}
