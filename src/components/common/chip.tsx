"use client";

import { cn } from "@/lib/utils";

/** Chip — a selectable choice or filter (clickable). Badges are read-only status. */
export function Chip({
  selected = false,
  onClick,
  children,
  className,
}: {
  selected?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        "inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 text-label transition-colors",
        selected
          ? "border-brand bg-brand text-fg-inverse"
          : "border-border-subtle bg-surface-raised text-fg-primary hover:border-border-strong",
        className,
      )}
    >
      {children}
    </button>
  );
}
