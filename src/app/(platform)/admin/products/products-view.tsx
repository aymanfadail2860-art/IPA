"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { DataTable } from "@/components/data/data-table";
import { Field, FormError, TextInput } from "@/components/knowledge-admin/form";
import { EmptyState } from "@/components/states/empty-state";
import { StatusBadge } from "@/components/status/status-badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { saveProduct, setProductStatus } from "@/lib/knowledge/admin-actions";
import type { AdminProduct } from "@/lib/knowledge/admin-types";

/** Produkter (docs/07 §12): list, create, edit and retire. Products are never deleted. */
export function ProductsView({ products, canWrite, linkable }: { products: readonly AdminProduct[]; canWrite: boolean; linkable: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<string[]>([]);
  const [form, setForm] = useState<{ id?: string; name: string; category: string }>({ name: "", category: "" });

  function run(action: () => Promise<{ ok: true } | { ok: false; error: string }>, after?: () => void) {
    setErrors([]);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) return setErrors([result.error]);
      after?.();
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      <DataTable
        caption="Produkter"
        density="compact"
        columns={[
          {
            id: "name",
            header: "Produkt",
            sortValue: (row) => row.name,
            cell: (row) =>
              linkable ? (
                <Link href={`/admin/products/${row.id}`} className="font-medium text-fg-link hover:underline">
                  {row.name}
                </Link>
              ) : (
                <span className="font-medium">{row.name}</span>
              ),
          },
          { id: "category", header: "Kategori", sortValue: (row) => row.category ?? "", cell: (row) => row.category ?? "—" },
          { id: "documents", header: "Dokumenter", align: "right", cell: (row) => <span className="tabular">{row.documentCount}</span> },
          { id: "status", header: "Status", cell: (row) => <StatusBadge status={row.status === "active" ? "success" : "neutral"} label={row.status === "active" ? "Aktiv" : "Udfaset"} /> },
        ]}
        rows={products}
        getRowId={(row) => row.id}
        getRowLabel={(row) => row.name}
        rowActions={
          canWrite
            ? [
                { label: "Redigér", onSelect: (row) => setForm({ id: row.id, name: row.name, category: row.category ?? "" }) },
                { label: "Udfas / genaktivér", onSelect: (row) => run(() => setProductStatus(row.id, row.status === "active" ? "retired" : "active")) },
              ]
            : undefined
        }
        emptyState={<EmptyState title="Ingen produkter endnu">Opret et produkt, før du uploader dokumenter til det.</EmptyState>}
      />
      {canWrite ? (
        <Card className="max-w-2xl space-y-3">
          <h2 className="text-heading-3">{form.id ? "Redigér produkt" : "Opret produkt"}</h2>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Navn">
              <TextInput value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} maxLength={200} />
            </Field>
            <Field label="Kategori" hint="Valgfri">
              <TextInput value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })} maxLength={200} />
            </Field>
          </div>
          <FormError errors={errors} />
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" loading={pending} onClick={() => run(() => saveProduct(form), () => setForm({ name: "", category: "" }))}>
              {form.id ? "Gem" : "Opret"}
            </Button>
            {form.id ? (
              <Button variant="ghost" size="sm" onClick={() => setForm({ name: "", category: "" })}>
                Annullér
              </Button>
            ) : null}
          </div>
        </Card>
      ) : null}
    </div>
  );
}
