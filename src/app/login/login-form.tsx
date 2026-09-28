"use client";

import { CircleX } from "lucide-react";
import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { signIn, type SignInState } from "@/lib/auth/actions";

const initialState: SignInState = { error: null };

const inputClass =
  "h-10 w-full rounded-md border border-border-strong/60 bg-surface-raised px-3 text-body text-fg-primary focus-visible:border-focus-ring";

export function LoginForm({ next, configured }: { next: string; configured: boolean }) {
  const [state, formAction, pending] = useActionState(signIn, initialState);
  const error = configured ? state.error : "Platformen er ikke forbundet til databasen endnu. Kontakt en administrator.";

  return (
    <form action={formAction} className="mt-6 space-y-4" noValidate>
      <input type="hidden" name="next" value={next} />
      <div className="space-y-1.5">
        <label htmlFor="email" className="block text-label text-fg-primary">
          E-mail
        </label>
        <input id="email" name="email" type="email" autoComplete="username" required className={inputClass} aria-invalid={Boolean(error)} />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="password" className="block text-label text-fg-primary">
          Adgangskode
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className={inputClass}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? "login-error" : undefined}
        />
      </div>
      {error ? (
        <p id="login-error" role="alert" className="flex items-start gap-2 text-body text-error">
          <CircleX className="mt-0.5 size-4 shrink-0" aria-hidden />
          {error}
        </p>
      ) : null}
      <Button type="submit" variant="primary" className="w-full" loading={pending} disabled={!configured}>
        Log ind
      </Button>
    </form>
  );
}
