import "server-only";

import { cache } from "react";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { CaseParticipant, CaseStatus, CaseSummary } from "@/types/domain";

/*
 * Customer cases — access is decided by the database (RLS in schema `advise`): a user sees
 * only cases they own or are assigned to, whatever their role (docs/03 §10, B-001).
 */

const STATUS: Record<string, CaseStatus> = {
  draft: "draft",
  active: "active",
  awaiting_customer: "awaitingCustomer",
  closed: "closed",
};

const ACCESS: Record<string, CaseParticipant["access"]> = {
  owner: "Ejer",
  editor: "Kan redigere",
  viewer: "Kan læse",
  reviewer: "Reviewer",
};

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]!.toUpperCase()).join("");
}

interface CaseRow {
  id: string;
  company_name: string;
  status: string;
  updated_at: string;
}

async function participantsOf(caseId: string): Promise<CaseParticipant[]> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.schema("advise").rpc("case_participant_list", { p_case_id: caseId });
  return ((data ?? []) as { user_id: string; display_name: string; access_type: string }[]).map((row) => ({
    userId: row.user_id,
    name: row.display_name,
    initials: initials(row.display_name),
    access: ACCESS[row.access_type] ?? "Kan læse",
  }));
}

async function toSummary(row: CaseRow): Promise<CaseSummary> {
  return {
    id: row.id,
    companyName: row.company_name,
    status: STATUS[row.status] ?? "draft",
    updatedAt: row.updated_at,
    participants: await participantsOf(row.id),
  };
}

/** Cases the signed-in user owns or is assigned to. */
export const listMyCases = cache(async (): Promise<CaseSummary[]> => {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .schema("advise")
    .from("customer_cases")
    .select("id, company_name, status, updated_at")
    .order("updated_at", { ascending: false });
  if (error) throw new Error(`Kunne ikke hente kundecases: ${error.message}`);
  return Promise.all(((data ?? []) as CaseRow[]).map(toSummary));
});

/** One case, or null when it does not exist OR the user has no access (indistinguishable). */
export async function getCase(caseId: string): Promise<CaseSummary | null> {
  if (!/^[0-9a-f-]{36}$/i.test(caseId)) return null;
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .schema("advise")
    .from("customer_cases")
    .select("id, company_name, status, updated_at")
    .eq("id", caseId)
    .maybeSingle();
  return data ? toSummary(data as CaseRow) : null;
}
