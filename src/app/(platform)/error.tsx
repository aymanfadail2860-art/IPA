"use client";

import Link from "next/link";

import { ErrorState } from "@/components/states/error-state";
import { Button } from "@/components/ui/button";

/** Page-level error: what happened, and a way forward (docs/04-ui-ux-design.md §18.2). */
export default function PlatformError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="px-4 py-10 md:px-8">
      <ErrorState
        variant="page"
        title="Siden kunne ikke indlæses"
        actions={
          <>
            <Button variant="primary" onClick={reset}>
              Prøv igen
            </Button>
            <Button asChild variant="secondary">
              <Link href="/home">Gå til Home</Link>
            </Button>
          </>
        }
      >
        Der opstod en fejl, da siden skulle vises. Prøv igen, eller gå tilbage til Home.
      </ErrorState>
    </div>
  );
}
