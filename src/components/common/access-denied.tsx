import Link from "next/link";

import { ErrorState } from "@/components/states/error-state";
import { Button } from "@/components/ui/button";

/**
 * Rendered server-side when the signed-in user lacks the permission for a page. No
 * protected data has been loaded at that point, and nothing about the content is revealed.
 */
export function AccessDenied({ title = "Du har ikke adgang til dette område" }: { title?: string }) {
  return (
    <div className="px-4 py-10 md:px-8">
      <ErrorState
        variant="access"
        title={title}
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
