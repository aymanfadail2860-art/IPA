"use client";

import { createContext, useContext, type ReactNode } from "react";

import type { PermissionGrant } from "@/lib/auth/permissions";

/**
 * The session the UI renders against.
 *
 * PHASE 5: the value is supplied by the development-only mock provider in `src/dev/`.
 * LATER: it is replaced by a session derived server-side from Supabase Auth and the
 * user's effective permissions. Components only depend on this interface, so the swap
 * does not touch them.
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
