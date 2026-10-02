import type { SupabaseClient } from "@supabase/supabase-js";

import type { CallRecord, GatewayDeps } from "./core/gateway-core";
import type { PolicyRow } from "./core/policy";

/**
 * The gateway's database dependencies for ONE user's client (RLS applies). Not server-only, so
 * integration tests can run the real pipeline as a signed-in test user.
 */
export function createGatewayDbDeps(client: SupabaseClient): Pick<GatewayDeps, "loadCase" | "gatingState" | "policyRows" | "record"> {
  const ai = client.schema("ai");
  return {
    async loadCase(caseId) {
      const { data, error } = await client.schema("advise").from("customer_cases").select("id, company_name").eq("id", caseId).maybeSingle();
      if (error || !data) return null;
      return { id: data.id as string, companyName: data.company_name as string };
    },
    async gatingState() {
      const { data, error } = await ai.rpc("my_gating_state");
      if (error) throw new Error("gating_state_unreadable");
      const row = ((data ?? []) as { assessment_active: boolean; roleplay_session_id: string | null }[])[0];
      if (!row) throw new Error("gating_state_unreadable");
      return { assessmentActive: row.assessment_active === true, roleplaySessionId: row.roleplay_session_id ?? null };
    },
    async policyRows(modelId) {
      const { data, error } = await ai.from("data_category_policy").select("model_id, category, rule").eq("model_id", modelId);
      // An unreadable matrix is an empty matrix: everything is denied (fail-closed).
      if (error) return [];
      return (data ?? []) as PolicyRow[];
    },
    async record(entry: CallRecord) {
      const { error } = await ai.rpc("record_call", {
        p_call: entry.call,
        p_sources: entry.sources,
        p_payload: entry.payload,
        p_gap_question: entry.gapQuestion,
      });
      if (error) throw new Error(`record_call: ${error.code ?? "error"}`);
    },
  };
}
