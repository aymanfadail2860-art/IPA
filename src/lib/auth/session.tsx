"use client";

import { createContext, useContext, type ReactNode } from "react";

import type { PermissionGrant } from "@/lib/auth/permissions";

/**
 * The session the UI renders against.
 *
 * The value is built server-side (src/lib/auth/server-session.ts) from Supabase Auth and
 * the user's effective permissions in the database, and handed to client components for
 * rendering. It only shapes the UI — authorization is enforced server-side and by RLS.
 */
export interface SessionUser {
  id: string;
  name: string;
  firstName: string;
  initials: string;
  title: string;
  teamName: string;
}

export interface Session {
  user: SessionUser;
  grants: readonly PermissionGrant[];
}

const SessionContext = createContext<Session | null>(null);

export function SessionProvider({ session, children }: { session: Session; children: ReactNode }) {
  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;
}

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) {
    throw new Error("useSession must be used inside <SessionProvider>.");
  }
  return session;
}
