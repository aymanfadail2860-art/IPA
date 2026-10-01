import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/lib/utils";

/** Minimal form controls for the Knowledge administration (labels are always visible). */
const control =
  "w-full rounded-md border border-border-strong/60 bg-surface-raised px-3 py-2 text-body text-fg-primary outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function Field({ label, hint, children, className }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <label className={cn("flex flex-col gap-1.5", className)}>
      <span className="text-label font-medium text-fg-primary">{label}</span>
      {children}
      {hint ? <span className="text-caption text-fg-tertiary">{hint}</span> : null}
    </label>
  );
}

export function TextInput(props: ComponentProps<"input">) {
  return <input {...props} className={cn(control, props.className)} />;
}

export function SelectInput(props: ComponentProps<"select">) {
  return <select {...props} className={cn(control, props.className)} />;
}

export function TextArea(props: ComponentProps<"textarea">) {
  return <textarea rows={3} {...props} className={cn(control, props.className)} />;
}

export function FormError({ errors }: { errors: readonly string[] }) {
  if (errors.length === 0) return null;
  return (
    <div role="alert" className="rounded-md border border-error/40 bg-error-subtle px-3 py-2 text-body text-error">
      {errors.map((error) => (
        <p key={error}>{error}</p>
      ))}
    </div>
  );
}
