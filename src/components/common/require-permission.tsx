"use client";

import Link from "next/link";

import { ErrorState } from "@/components/states/error-state";
import { Button } from "@/components/ui/button";
import { meetsRequirement, type PermissionRequirement } from "@/lib/auth/permissions";
import { useSession } from "@/lib/auth/session";

/**
 * Renders children only when the session meets the requirement; otherwise an access
 * message that reveals nothing about the content.
 *
 * UI ONLY: hiding UI is not an access control (docs/03 §9–10). Real checks run server-side
 * in the application layer and RLS once authentication exists.
 */
export function RequirePermission({
  requirement,
  children,
}: {
  requirement: PermissionRequirement;
  children: React.ReactNode;
}) {
  const { grants } = useSession();
  if (meetsRequirement(grants, requirement)) return <>{children}</>;
  return (
    <div className="px-4 py-10 md:px-8">
      <ErrorState
        variant="access"
        title="Du har ikke adgang til dette område"
        actions={
          <Button asChild variant="secondary">
            <Link href="/home">Gå til Home</Link>
          </Button>
        }
      >
        Kontakt en administrator, hvis du mener, at du bør have adgang.
      </ErrorState>
    </div>
  );
}
