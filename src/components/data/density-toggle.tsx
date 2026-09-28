"use client";

import { Rows3, Rows4 } from "lucide-react";

import { cn } from "@/lib/utils";

export type TableDensity = "comfortable" | "compact";

/** DensityToggle — Comfortable (default) or Compact rows (§3.6). */
export function DensityToggle({
  value,
  onChange,
}: {
  value: TableDensity;
  onChange: (value: TableDensity) => void;
}) {
  const options: { value: TableDensity; label: string; icon: typeof Rows3 }[] = [
    { value: "comfortable", label: "Komfortabel", icon: Rows3 },
    { value: "compact", label: "Kompakt", icon: Rows4 },
  ];
  return (
    <div role="radiogroup" aria-label="Tabeltæthed" className="inline-flex rounded-md border border-border-subtle bg-surface-raised p-0.5">
      {options.map((option) => {
        const Icon = option.icon;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={value === option.value}
            onClick={() => onChange(option.value)}
            className={cn(
              "inline-flex cursor-pointer items-center gap-1.5 rounded-sm px-2.5 py-1 text-label",
              value === option.value ? "bg-accent-subtle text-fg-primary" : "text-fg-secondary hover:text-fg-primary",
            )}
          >
            <Icon className="size-3.5" aria-hidden />
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
