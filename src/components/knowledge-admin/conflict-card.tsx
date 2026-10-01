"use client";

import { GitCompare } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { StatusBadge } from "@/components/status/status-badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { closeConflict } from "@/lib/knowledge/admin-actions";
import { CONFLICT_RULE_LABEL, type AdminConflict } from "@/lib/knowledge/admin-types";
import { formatDate } from "@/lib/format";

import { Field, FormError, TextArea } from "./form";

const OUTCOME = { open: "Åben", resolved: "Løst", dismissed: "Afvist" } as const;

/**
 * A conflict with both sources side by side (docs/04 §14.3, docs/07 §11). The system never
 * decides which source is right; a person with knowledge.version.publish resolves (note) or
 * dismisses (reason) it.
 */
export function ConflictCard({ conflict, canDecide, linkable = true }: { conflict: AdminConflict; canDecide: boolean; linkable?: boolean }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();

  function decide(outcome: "resolved" | "dismissed") {
    setErrors([]);
    startTransition(async () => {
      const result = await closeConflict(conflict.id, outcome, note);
      if (!result.ok) return setErrors([result.error]);
      router.refresh();
    });
  }

  return (
    <Card className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-heading-3">
          <GitCompare className="size-4 text-knowledge-conflict" aria-hidden />
          {conflict.description ?? CONFLICT_RULE_LABEL[conflict.rule]}
        </p>
        <span className="flex items-center gap-2 text-caption text-fg-tertiary">
          <StatusBadge status={conflict.status === "open" ? "conflict" : "neutral"} label={OUTCOME[conflict.status]} />
          {conflict.detectedBy === "system" ? "Fundet af systemet" : "Registreret"} {formatDate(conflict.createdAt)}
        </span>
      </div>
      <p className="text-caption text-fg-secondary">Regel: {CONFLICT_RULE_LABEL[conflict.rule]}</p>
      <div className="grid gap-3 md:grid-cols-2">
        {(["A", "B"] as const).map((side) => (
          <div key={side} className="space-y-2 rounded-md border-l-4 border-l-knowledge-conflict bg-knowledge-conflict-subtle px-4 py-3 text-body">
            {conflict.passages
              .filter((passage) => passage.side === side)
              .map((passage) => (
                <div key={`${passage.versionId}-${passage.chunk?.id ?? "v"}`}>
                  <p className="font-medium">
                    {linkable && passage.documentId ? (
                      <Link href={`/admin/documents/${passage.documentId}/versions/${passage.versionId}`} className="text-fg-link hover:underline">
                        {passage.documentTitle}
                      </Link>
                    ) : (
                      passage.documentTitle
                    )}
                    {passage.versionLabel ? `, version ${passage.versionLabel}` : ""}
                  </p>
                  {passage.chunk ? (
                    <p className="mt-1 line-clamp-6 text-fg-secondary">
                      {passage.chunk.heading ? `${passage.chunk.heading} · ` : ""}side {passage.chunk.pageStart}: {passage.chunk.text}
                    </p>
                  ) : (
                    <p className="mt-1 text-fg-secondary">Hele versionen</p>
                  )}
                </div>
              ))}
          </div>
        ))}
      </div>
      {conflict.status !== "open" && conflict.resolutionNote ? (
        <p className="text-body text-fg-secondary">
          {OUTCOME[conflict.status]} {conflict.resolvedAt ? formatDate(conflict.resolvedAt) : ""}: {conflict.resolutionNote}
        </p>
      ) : null}
      {conflict.status === "open" && canDecide ? (
        <div className="space-y-2">
          <Field label="Note eller begrundelse" hint="Den faglige løsning gennemføres med de almindelige handlinger, fx deaktivering eller en ny version.">
            <TextArea value={note} onChange={(event) => setNote(event.target.value)} maxLength={2000} />
          </Field>
          <FormError errors={errors} />
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" loading={pending} disabled={note.trim().length === 0} onClick={() => decide("resolved")}>
              Løs
            </Button>
            <Button variant="ghost" size="sm" loading={pending} disabled={note.trim().length === 0} onClick={() => decide("dismissed")}>
              Afvis som ikke-en-konflikt
            </Button>
          </div>
        </div>
      ) : null}
    </Card>
  );
}
