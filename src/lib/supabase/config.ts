/**
 * Supabase connection settings. Only the public URL and the anon (publishable) key are
 * used by the application — the service-role key is never read by app code.
 * Values come from environment variables; nothing is committed (see .env.example).
 */
export interface SupabaseConfig {
  url: string;
  anonKey: string;
}

export function getSupabaseConfig(): SupabaseConfig | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  return { url, anonKey };
}
