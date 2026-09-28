import type { Metadata } from "next";

import { BrandMark } from "@/components/shell/brand-mark";
import { getSupabaseConfig } from "@/lib/supabase/config";

import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Log ind" };

export default async function LoginPage(props: PageProps<"/login">) {
  const { next } = await props.searchParams;
  const configured = Boolean(getSupabaseConfig());

  return (
    <main className="flex min-h-dvh items-center justify-center bg-surface-base px-4 py-10">
      <div className="w-full max-w-sm space-y-8">
        <BrandMark />
        <div className="rounded-lg border border-border-subtle bg-surface-raised p-6">
          <h1 className="text-heading-2 text-fg-primary">Log ind</h1>
          <p className="mt-1 text-body text-fg-secondary">Brug den konto, din administrator har oprettet til dig.</p>
          <LoginForm next={typeof next === "string" ? next : ""} configured={configured} />
        </div>
      </div>
    </main>
  );
}
