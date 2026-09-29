import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { isDemoMode } from "@/dev/demo/demo-mode";
import { getSupabaseConfig } from "@/lib/supabase/config";

/** Routes reachable without a session. */
const PUBLIC_PATHS = ["/login"];

/**
 * Proxy (Next.js 16 "middleware"): refreshes the Supabase session cookie on every request
 * and sends unauthenticated visitors to /login.
 *
 * This is the optimistic first check only. Authorization is enforced again server-side in
 * layouts/pages (requireSession / requirePermission) and in the database via RLS.
 */
export async function proxy(request: NextRequest) {
  const isPublic = PUBLIC_PATHS.some((path) => request.nextUrl.pathname === path);
  if (isDemoMode()) {
    // Temporary demo without login (B-003): only when no database is connected.
    return isPublic ? NextResponse.redirect(new URL("/home", request.url)) : NextResponse.next();
  }
  const config = getSupabaseConfig();
  if (!config) {
    // Without configuration nobody can be authenticated; the login page explains why.
    return isPublic ? NextResponse.next() : NextResponse.redirect(new URL("/login", request.url));
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(config.url, config.anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
      },
    },
  });

  // Verifies the JWT (and refreshes the session when needed). Do not put code between
  // client creation and this call.
  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims?.sub);

  if (!signedIn && !isPublic) {
    const url = new URL("/login", request.url);
    if (request.nextUrl.pathname !== "/") url.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  if (signedIn && isPublic) {
    return NextResponse.redirect(new URL("/home", request.url));
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|.*\\.(?:svg|png|jpg|jpeg|gif|webp|woff2?)$).*)"],
};
