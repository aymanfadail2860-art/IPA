"use server";

import { getServerSession } from "@/lib/auth/server-session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isDemoMode } from "@/dev/demo/demo-mode";

import { aiDevToolsAllowed } from "./gating-tool";

/** ⚠ DEVELOPMENT TOOL (docs/08 §13) — see gating-tool.ts. Refused outside local/test. */

export type DevGatingAction = "start_assessment" | "submit_assessment" | "start_roleplay" | "end_roleplay";
export type DevGatingState = { assessmentId: string | null; roleplaySessionId: string | null };

async function context() {
  if (isDemoMode() || !aiDevToolsAllowed()) throw new Error("Udviklingsværktøjet kan kun bruges lokalt og i test.");
  if (!(await getServerSession())) throw new Error("Du skal være logget ind.");
  return createSupabaseServerClient();
}

export async function devGatingState(): Promise<DevGatingState> {
  const supabase = await context();
  const [{ data: attempt }, { data: roleplay }] = await Promise.all([
    supabase.schema("assessment").from("assessment_attempts").select("id").eq("status", "active").maybeSingle(),
    supabase.schema("practice").from("roleplay_sessions").select("id").eq("status", "active").maybeSingle(),
  ]);
  return { assessmentId: (attempt?.id as string) ?? null, roleplaySessionId: (roleplay?.id as string) ?? null };
}

export async function devGating(action: DevGatingAction): Promise<DevGatingState> {
  const supabase = await context();
  const state = await devGatingState();
  if (action === "start_assessment") await supabase.schema("assessment").rpc("start_attempt", {});
  if (action === "submit_assessment" && state.assessmentId) await supabase.schema("assessment").rpc("submit_attempt", { p_id: state.assessmentId });
  if (action === "start_roleplay") await supabase.schema("practice").rpc("start_roleplay");
  if (action === "end_roleplay" && state.roleplaySessionId) await supabase.schema("practice").rpc("end_roleplay", { p_id: state.roleplaySessionId });
  return devGatingState();
}
