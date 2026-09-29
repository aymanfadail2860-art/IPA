"use server";

import { redirect } from "next/navigation";

import { isDemoMode } from "@/dev/demo/demo-mode";
import { getSupabaseConfig } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface SignInState {
  error: string | null;
}

/** Only relative, same-site paths are accepted as a post-login destination. */
function safeNext(value: FormDataEntryValue | null): string {
  const next = typeof value === "string" ? value : "";
  return next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/login") ? next : "/home";
}

export async function signIn(_state: SignInState, formData: FormData): Promise<SignInState> {
  if (isDemoMode()) redirect("/home");
  if (!getSupabaseConfig()) {
    return { error: "Platformen er ikke forbundet til databasen endnu. Kontakt en administrator." };
  }
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) {
    return { error: "Udfyld både e-mail og adgangskode." };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    // Same message whether the account exists or not.
    return { error: "E-mail eller adgangskode er forkert." };
  }

  const { data: userId } = await supabase.schema("identity").rpc("current_user_id");
  if (!userId) {
    await supabase.auth.signOut();
    return { error: "Kontoen er ikke aktiv på platformen. Kontakt en administrator." };
  }

  redirect(safeNext(formData.get("next")));
}

export async function signOut(): Promise<void> {
  if (getSupabaseConfig()) {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.signOut();
  }
  redirect("/login");
}
