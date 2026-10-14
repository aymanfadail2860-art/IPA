import "server-only";

import { isDemoMode } from "@/dev/demo/demo-mode";
import { getServerSession } from "@/lib/auth/server-session";
import { runtimeEnv } from "@/lib/knowledge/core/grade";
import { getRetrievalAvailability, retrieveEvidence } from "@/lib/knowledge/retrieval";
import { getSupabaseConfig } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { createGatewayDbDeps } from "./gateway-deps";
import { runGateway, type AiCallLogEntry, type AiDevOptions } from "./core/gateway-core";
import type { Model } from "./core/model";
import { createModel } from "./core/registry";
import type { AiRequest } from "./core/types";
import type { AiOutcome } from "./outcome";
import { configuredAnthropicModel } from "./providers/anthropic/server";
import { createUsageLedger } from "./usage-ledger";

/**
 * runAiRequest (docs/08 §1) — the ONLY entry to AI on the platform. Server-only, no HTTP
 * route. Runs as the signed-in user: permissions, case access, gating state and the log are
 * all read and written with the user's own identity (RLS), never with the service role.
 *
 * Beta L4 (B-039): IPA_AI_MODEL may name a Claude model. It is constructed only here, from the
 * server environment (providers/anthropic/server.ts), and spends only through the user's usage
 * ledger in the database. Every call writes one structured log line without content.
 */

let configuredModel: Model | null = null;

/** The configured model (IPA_AI_MODEL, default "stub"). Throws — fail-closed — when not allowed here. */
function gatewayModel(): Model {
  configuredModel ??= createModel(undefined, undefined, { anthropic: configuredAnthropicModel });
  return configuredModel;
}

/** The structured log (docs/beta.md §16.11): one JSON line per call, without content. */
function logCall(entry: AiCallLogEntry): void {
  console.info(JSON.stringify(entry));
}

export async function runAiRequest(request: AiRequest, dev: AiDevOptions = {}): Promise<AiOutcome> {
  if (isDemoMode() || !getSupabaseConfig()) return { kind: "unavailable", message: "AI kræver en database og er ikke tilgængelig i demoen." };
  const supabase = await createSupabaseServerClient();
  const db = createGatewayDbDeps(supabase);
  return runGateway(
    request,
    {
      ...db,
      async user() {
        const session = await getServerSession();
        return session ? { id: session.user.id, name: session.user.name } : null;
      },
      async hasPermission(key, scope) {
        const session = await getServerSession();
        return Boolean(session?.grants.some((grant) => grant.key === key && (!scope || grant.scope === scope)));
      },
      retrieve: (retrievalRequest, retrievalDev) => retrieveEvidence(retrievalRequest, retrievalDev),
      model: gatewayModel,
      usage: createUsageLedger(supabase),
      log: logCall,
      environment: runtimeEnv(),
    },
    dev,
  );
}

export type GatewayAvailability = { state: "available"; model: { id: string; grade: string } } | { state: "unavailable"; reason: string };

/** Whether the gateway can run at all (docs/08 §12) — a readable state, like B-007. */
export async function getGatewayAvailability(): Promise<GatewayAvailability> {
  if (isDemoMode() || !getSupabaseConfig()) return { state: "unavailable", reason: "AI kræver en database og er ikke tilgængelig i demoen." };
  let model: Model;
  try {
    model = gatewayModel();
  } catch (error) {
    return { state: "unavailable", reason: (error as Error).message };
  }
  const retrieval = await getRetrievalAvailability();
  if (retrieval.state === "unavailable") return { state: "unavailable", reason: retrieval.reason };
  const supabase = await createSupabaseServerClient();
  const db = createGatewayDbDeps(supabase);
  try {
    await db.gatingState();
    if ((await db.policyRows(model.id)).length === 0) return { state: "unavailable", reason: `Datakategori-matricen har ingen regler for modellen "${model.id}".` };
  } catch {
    return { state: "unavailable", reason: "Gating-tilstanden eller datakategori-matricen kunne ikke læses." };
  }
  if (model.grade !== "development") {
    // An external model: the limits must be readable and the model approved with a verified price.
    try {
      await createUsageLedger(supabase).limits();
      const { data, error } = await supabase.schema("ai").from("model_prices").select("model_id").eq("model_id", model.id).eq("active", true).maybeSingle();
      if (error || !data) return { state: "unavailable", reason: `Modellen "${model.id}" er ikke godkendt med en verificeret pris.` };
    } catch {
      return { state: "unavailable", reason: "Forbrugsgrænserne for AI kunne ikke læses." };
    }
  }
  return { state: "available", model: { id: model.id, grade: model.grade } };
}
