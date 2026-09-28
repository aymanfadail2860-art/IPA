import Link from "next/link";

import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <div className="max-w-md space-y-4 text-center">
        <p className="font-mono text-label text-fg-tertiary">404</p>
        <h1 className="text-heading-1 text-fg-primary">Siden findes ikke</h1>
        <p className="text-body text-fg-secondary">Adressen er forkert, eller siden er flyttet.</p>
        <Button asChild variant="primary">
          <Link href="/home">Gå til Home</Link>
        </Button>
      </div>
    </main>
  );
}
