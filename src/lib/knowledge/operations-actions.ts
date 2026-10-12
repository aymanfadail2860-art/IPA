"use server";

import { revalidatePath } from "next/cache";

import { isDemoMode } from "@/dev/demo/demo-mode";
import { authorize } from "@/lib/auth/server-session";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { SETTINGS_MANAGE } from "./admin-requirements";
import {
  MIN_DEVIATION_JUSTIFICATION,
  MIN_RETIREMENT_REASON,
  MIN_ROOT_CAUSE_NOTE,
  MIN_SUSPENSION_REASON,
  MIN_UNCERTAINTY_JUSTIFICATION,
} from "./operations-view";
import { isUuid } from "./upload-validation";

/*
 * Drift af retrieval (8B-I8 C2, docs/08b §10.2, §10.3, §21.15): the human decisions of the 8B
 * lifecycle, as server actions over the EXISTING database functions — never a table write.
 *
 *   * Each action requires system.settings.manage here; the database function requires it
 *     again (knowledge.require_settings_manager) as the logged-in user, revalidates every
 *     invariant and writes the audit entry. RLS and grants are unchanged.
 *   * Each action requires an explicit confirmation, and a justification where the database
 *     function takes one. The minimum lengths are the database's; it checks them itself.
 *   * Only decisions a person may make. Registering a run, a gate set or a measurement is the
 *     evaluation publisher's (a separate database identity in CI); nothing here can submit or
 *     change an evaluation result.
 */

const PATH = "/admin/settings";
const DEMO = "Ikke tilgængelig i demoen uden database.";
const DENIED = "Du har ikke adgang til denne handling.";
const UNCONFIRMED = "Handlingen er ikke bekræftet.";

export type OperationsActionResult = { ok: true } | { ok: false; error: string };

interface Confirmed {
  confirmed: true;
}

async function guard(input: Partial<Confirmed>): Promise<OperationsActionResult | null> {
  if (isDemoMode()) return { ok: false, error: DEMO };
  if (!(await authorize(SETTINGS_MANAGE))) return { ok: false, error: DENIED };
  if (input.confirmed !== true) return { ok: false, error: UNCONFIRMED };
  return null;
}

function fromError(error: { code?: string; message: string } | null, fallback: string): OperationsActionResult {
  if (!error) return { ok: true };
  if (error.code === "42501") return { ok: false, error: DENIED };
  // The lifecycle functions refuse with a Danish message for the user ("Afvist (kode): …").
  if (error.code === "23514" || error.code === "P0002") return { ok: false, error: error.message };
  return { ok: false, error: fallback };
}

function text(value: unknown, minimum: number, what: string): string | OperationsActionResult {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (trimmed.length < minimum) return { ok: false, error: `${what} skal være på mindst ${minimum} tegn.` };
  if (trimmed.length > 2000) return { ok: false, error: `${what} må højst være på 2000 tegn.` };
  return trimmed;
}

async function call(fn: string, args: Record<string, unknown>, fallback: string): Promise<OperationsActionResult> {
  const { error } = await (await createSupabaseServerClient()).schema("knowledge").rpc(fn, args);
  revalidatePath(PATH);
  return fromError(error, fallback);
}

const NOT_FOUND: OperationsActionResult = { ok: false, error: "Findes ikke." };

/** Godkend et registreret gate-sæt (§4.4). */
export async function approveGateSet(input: Confirmed & { gateSetId: string }): Promise<OperationsActionResult> {
  const denied = await guard(input);
  if (denied) return denied;
  if (!isUuid(input.gateSetId)) return NOT_FOUND;
  return call("approve_evaluation_gate_set", { p_gate_set_id: input.gateSetId }, "Gate-sættet kunne ikke godkendes.");
}

/** Acceptér den statistiske usikkerhed i en pilot-kørsel (B-030). */
export async function acceptUncertainty(input: Confirmed & { runId: string; justification: string }): Promise<OperationsActionResult> {
  const denied = await guard(input);
  if (denied) return denied;
  if (!isUuid(input.runId)) return NOT_FOUND;
  const justification = text(input.justification, MIN_UNCERTAINTY_JUSTIFICATION, "Begrundelsen");
  if (typeof justification !== "string") return justification;
  return call("accept_evaluation_uncertainty", { p_run_id: input.runId, p_justification: justification }, "Usikkerheden kunne ikke accepteres.");
}

/** Godkend en konfiguration på grundlag af en registreret kørsel (§10.2), med årsagsnoter for rapportens fejl. */
export async function approveConfiguration(input: Confirmed & { configurationId: string; runId: string; rootCauseNotes: string[] }): Promise<OperationsActionResult> {
  const denied = await guard(input);
  if (denied) return denied;
  if (!isUuid(input.configurationId) || !isUuid(input.runId)) return NOT_FOUND;
  if (!Array.isArray(input.rootCauseNotes) || input.rootCauseNotes.length > 500) return { ok: false, error: "Årsagsnoterne kunne ikke læses." };
  const notes: string[] = [];
  for (const note of input.rootCauseNotes) {
    const checked = text(note, MIN_ROOT_CAUSE_NOTE, "Hver årsagsnote");
    if (typeof checked !== "string") return checked;
    notes.push(checked);
  }
  return call(
    "approve_retrieval_configuration",
    { p_configuration_id: input.configurationId, p_run_id: input.runId, p_root_cause_notes: notes },
    "Konfigurationen kunne ikke godkendes.",
  );
}

/** Aktivér en godkendt konfiguration (§10.2). Databasen efterprøver alt igen og skifter model i samme transaktion. */
export async function activateConfiguration(input: Confirmed & { configurationId: string }): Promise<OperationsActionResult> {
  const denied = await guard(input);
  if (denied) return denied;
  if (!isUuid(input.configurationId)) return NOT_FOUND;
  return call("activate_retrieval_configuration", { p_configuration_id: input.configurationId }, "Konfigurationen kunne ikke aktiveres.");
}

/** Suspendér konfigurationen i drift manuelt (§10.2, D-8). Ingen fallback til en anden. */
export async function suspendConfiguration(input: Confirmed & { configurationId: string; reason: string }): Promise<OperationsActionResult> {
  const denied = await guard(input);
  if (denied) return denied;
  if (!isUuid(input.configurationId)) return NOT_FOUND;
  const reason = text(input.reason, MIN_SUSPENSION_REASON, "Begrundelsen");
  if (typeof reason !== "string") return reason;
  return call("suspend_retrieval_configuration", { p_configuration_id: input.configurationId, p_reason: reason }, "Konfigurationen kunne ikke suspenderes.");
}

/** Udfas en kandidat, en godkendt eller en suspenderet konfiguration (aldrig sletning). */
export async function retireConfiguration(input: Confirmed & { configurationId: string; reason: string }): Promise<OperationsActionResult> {
  const denied = await guard(input);
  if (denied) return denied;
  if (!isUuid(input.configurationId)) return NOT_FOUND;
  const reason = text(input.reason, MIN_RETIREMENT_REASON, "Begrundelsen");
  if (typeof reason !== "string") return reason;
  return call("retire_retrieval_configuration", { p_configuration_id: input.configurationId, p_reason: reason }, "Konfigurationen kunne ikke udfases.");
}

/** Godkend en performance-målings afvigelser (§12, §17 pkt. 10, B-032). */
export async function acceptPerformanceDeviation(input: Confirmed & { measurementId: string; justification: string }): Promise<OperationsActionResult> {
  const denied = await guard(input);
  if (denied) return denied;
  if (!isUuid(input.measurementId)) return NOT_FOUND;
  const justification = text(input.justification, MIN_DEVIATION_JUSTIFICATION, "Begrundelsen");
  if (typeof justification !== "string") return justification;
  return call("accept_performance_deviation", { p_measurement_id: input.measurementId, p_justification: justification }, "Afvigelsen kunne ikke godkendes.");
}

/** Embed alle chunks med en kandidatmodel (§2.5 trin 2). Workeren udfører det; aktiveringen kræver 100 % dækning. */
export async function requestReembedding(input: Confirmed & { modelId: string }): Promise<OperationsActionResult> {
  const denied = await guard(input);
  if (denied) return denied;
  if (!isUuid(input.modelId)) return NOT_FOUND;
  return call("request_reembedding", { p_model_id: input.modelId }, "Re-embedding kunne ikke startes.");
}
