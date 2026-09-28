import { Lock } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * LockedState — explains why AI is not available here (active Assessment, AI roleplay).
 * The lock is shown, not hidden: a Copilot entry that silently disappears leaves the user
 * wondering whether something is broken (docs/04-ui-ux-design.md §9.3). The lock itself
 * is enforced server-side; the UI only explains it.
 */
export function LockedState({
  title,
  children,
  className,
}: {
  title: string;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      role="note"
      className={cn(
        "flex items-start gap-3 rounded-md border border-border-subtle bg-surface-sunken px-4 py-3 text-fg-secondary",
        className,
      )}
    >
      <Lock className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="text-body">
        <p className="font-medium text-fg-primary">{title}</p>
        {children ? <div className="mt-0.5">{children}</div> : null}
      </div>
    </div>
  );
}
