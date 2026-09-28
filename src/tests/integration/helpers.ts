import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { SEED_USERS } from "../../../scripts/seed-fixtures.mjs";

/**
 * Integration tests run against a real Supabase (local stack + dev seed).
 * Required: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, IPA_DEV_SEED_PASSWORD.
 */
export const env = {
  url: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
  password: process.env.IPA_DEV_SEED_PASSWORD ?? "",
  appUrl: process.env.IPA_APP_URL ?? "",
};

export const integrationConfigured = Boolean(env.url && env.anonKey && env.password);

export type SeedUserKey = (typeof SEED_USERS)[number]["key"];

export function seedUser(key: SeedUserKey) {
  const user = SEED_USERS.find((entry) => entry.key === key);
  if (!user) throw new Error(`Unknown seed user ${key}`);
  return user;
}

export function anonClient(): SupabaseClient {
  return createClient(env.url, env.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

const cache = new Map<string, SupabaseClient>();

/** A client signed in as the given seed user through Supabase Auth. */
export async function signedInClient(key: SeedUserKey): Promise<SupabaseClient> {
  const cached = cache.get(key);
  if (cached) return cached;
  const client = anonClient();
  const { error } = await client.auth.signInWithPassword({ email: seedUser(key).email, password: env.password });
  if (error) throw new Error(`Sign-in failed for ${key}: ${error.message}`);
  cache.set(key, client);
  return client;
}

export async function myUserId(client: SupabaseClient): Promise<string> {
  const { data, error } = await client.schema("identity").rpc("current_user_id");
  if (error) throw error;
  return data as string;
}

export async function userIdOf(key: SeedUserKey): Promise<string> {
  return myUserId(await signedInClient(key));
}
