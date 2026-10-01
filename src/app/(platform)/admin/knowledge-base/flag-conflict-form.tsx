"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Field, FormError, SelectInput, TextArea } from "@/components/knowledge-admin/form";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { flagConflict } from "@/lib/knowledge/admin-actions";

/** "Registrér konflikt" — a person chooses the two contradicting sources (docs/07 §11.2). */
export function FlagConflictForm({ versions }: { versions: readonly { id: string; label: string }[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<string[]>([]);
  const [form, setForm] = useState({ description: "", versionA: "", versionB: "" });
  const select = (key: "versionA" | "versionB", label: string) => (
    <Field label={label}>
      <SelectInput value={form[key]} onChange={(event) => setForm({ ...form, [key]: event.target.value })}>
        <option value="">Vælg version</option>
        {versions.map((version) => (
          <option key={version.id} value={version.id}>
            {version.label}
          </option>
        ))}
      </SelectInput>
    </Field>
  );
  return (
    <Card className="space-y-3">
      <h3 className="text-heading-3">Registrér konflikt</h3>
      <div className="grid gap-3 md:grid-cols-2">
        {select("versionA", "Kilde A")}
        {select("versionB", "Kilde B")}
      </div>
      <Field label="Beskrivelse">
        <TextArea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} maxLength={2000} />
      </Field>
      <FormError errors={errors} />
      <Button
        variant="secondary"
        size="sm"
        loading={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await flagConflict(form);
            if (!result.ok) return setErrors([result.error]);
            setErrors([]);
            setForm({ description: "", versionA: "", versionB: "" });
            router.refresh();
          })
        }
      >
        Registrér
      </Button>
    </Card>
  );
}
