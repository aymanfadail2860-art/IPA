"use client";

import { createBrowserClient } from "@supabase/ssr";

import { getSupabaseConfig } from "./config";

/**
 * Browser client, used ONLY to upload an original to a signed upload URL issued by the
 * server (docs/07 §5.1) — large PDFs go straight to the private bucket. The anon key is
 * public by design; access is decided by the signed URL, RLS and the database functions.
 */
export function createSupabaseBrowserClient() {
  const config = getSupabaseConfig();
  if (!config) throw new Error("Supabase er ikke konfigureret.");
  return createBrowserClient(config.url, config.anonKey);
}
