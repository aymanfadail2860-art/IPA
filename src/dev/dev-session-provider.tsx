"use client";

/**
 * ⚠ DEVELOPMENT ONLY — NOT AUTHENTICATION, NOT AUTHORIZATION.
 *
 * Supplies a mock session so the role-dependent UI (navigation, Home sections, Analytics,
 * Admin) can be evaluated for Rådgiver, Leder and Administrator.
 *
 * TO BE REPLACED by a session derived server-side from Supabase Auth and the user's
 * effective permissions (docs/03-technical-architecture.md §10). Hiding UI is never an
 * access control; real checks happen on the server in a later phase.
 */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

import { SessionProvider } from "@/lib/auth/session";
import { MOCK_SESSIONS, type MockRoleId } from "@/mocks/sessions";

import { DEV_ROLE_COOKIE } from "./dev-tools";

interface DevRoleContextValue {
  role: MockRoleId;
  setRole: (role: MockRoleId) => void;
}

const DevRoleContext = createContext<DevRoleContextValue | null>(null);

export function DevSessionProvider({
  initialRole,
  children,
}: {
  initialRole: MockRoleId;
  children: ReactNode;
}) {
  const [role, setRoleState] = useState<MockRoleId>(initialRole);

  const setRole = useCallback((next: MockRoleId) => {
    setRoleState(next);
    document.cookie = `${DEV_ROLE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
  }, []);

  const value = useMemo(() => ({ role, setRole }), [role, setRole]);

  return (
    <DevRoleContext.Provider value={value}>
      <SessionProvider session={MOCK_SESSIONS[role]}>{children}</SessionProvider>
    </DevRoleContext.Provider>
  );
}

export function useDevRole(): DevRoleContextValue {
  const value = useContext(DevRoleContext);
  if (!value) throw new Error("useDevRole must be used inside <DevSessionProvider>.");
  return value;
}
