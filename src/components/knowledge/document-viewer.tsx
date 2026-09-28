"use client";

import { ArrowLeft, FileText, Layers } from "lucide-react";

import { StatusBadge } from "@/components/status/status-badge";
import { Button } from "@/components/ui/button";
import type { SourceReference } from "@/types/domain";

import { sourceLocation, sourceStatus } from "./source-validity";

/**
 * DocumentViewer — level 3 of the citation UX (§17.1). Opens in the context panel with the
 * cited passage highlighted. Header: title, version, validity, status and a shortcut to
 * the version history.
 *
 * PHASE 5: shows only the cited excerpt; the full document text arrives with the
 * Knowledge Engine in a later phase.
 */
export function DocumentViewer({ source, onBack }: { source: SourceReference; onBack?: () => void }) {
  const { status, label } = sourceStatus(source);
  return (
    <section aria-label={`Dokument: ${source.documentTitle}`} className="space-y-4">
      {onBack ? (
        <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2">
          <ArrowLeft aria-hidden />
          Tilbage til kilder
        </Button>
      ) : null}
      <header className="space-y-2 border-b border-border-subtle pb-4">
        <p className="flex items-center gap-2 text-caption text-fg-tertiary">
          <FileText className="size-3.5" aria-hidden />
          Dokument
        </p>
        <h2 className="text-heading-3 text-fg-primary">{source.documentTitle}</h2>
        <p className="font-mono text-caption text-fg-secondary">{sourceLocation(source)}</p>
        <StatusBadge status={status} label={label} />
        <div>
          <Button variant="link" size="sm">
            <Layers aria-hidden />
            Versionshistorik
          </Button>
        </div>
      </header>
      <div className="space-y-4 text-reading text-fg-primary">
        <p className="text-caption text-fg-tertiary">{source.section}</p>
        <p>
          <mark className="rounded-sm bg-brand-subtle px-0.5 text-fg-primary ring-1 ring-brand/20">
            {source.excerpt}
          </mark>
        </p>
        <p className="text-body text-fg-secondary">
          Den fulde dokumenttekst vises, når Knowledge Engine er tilsluttet. I denne udviklingsversion vises kun den
          citerede passage.
        </p>
      </div>
    </section>
  );
}
