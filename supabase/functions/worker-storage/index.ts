// Supabase Edge Function worker-storage (Deno). docs/08b §21.5, D-10 pkt. 3.
//
// The service-role key exists only here, server-side, as the function's own environment
// (SUPABASE_SERVICE_ROLE_KEY is provided by Supabase). It is never returned to the caller. The
// caller authenticates with nothing but a one-time ticket (verify_jwt = false in config.toml).
// All logic is in handler.ts.
import { createClient } from "npm:@supabase/supabase-js@2";

import { handleWorkerStorage, supabaseStorageDeps, type StorageClient } from "./handler.ts";

const client = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const deps = supabaseStorageDeps(client as unknown as StorageClient, (entry) => console.log(JSON.stringify(entry)));

Deno.serve((request: Request) => handleWorkerStorage(request, deps));
