"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { ConflictCard } from "@/components/knowledge-admin/conflict-card";
import { Field, FormError, SelectInput, TextInput } from "@/components/knowledge-admin/form";
import { VersionStatusBadge } from "@/components/knowledge-admin/version-status";
import { EmptyState } from "@/components/states/empty-state";
import { StatusBadge } from "@/components/status/status-badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { addGrant, removeGrant, updateDocumentMetadata } from "@/lib/knowledge/admin-actions";
import { GAP_KIND_LABEL, type AccessGrant, type AdminConflict, type AdminVersionRow, type ValidityGap } from "@/lib/knowledge/admin-types";
import { DOCUMENT_TYPES } from "@/lib/knowledge/document-types";
import { formatDate, formatValidTo } from "@/lib/format";

const PERMISSION_LABEL = { "knowledge.document.read": "Læsning", "knowledge.document.read_historical": "Historisk læsning" } as const;

export function DocumentView({
  document,
  versions,
  grants,
  conflicts,
  gaps,
  products,
  candidates,
  today,
  canWrite,
  canPublish,
}: {
  document: { id: string; title: string; productId: string; documentType: string; externalRef: string | null };
  versions: readonly AdminVersionRow[];
  grants: readonly AccessGrant[];
  conflicts: readonly AdminConflict[];
  gaps: readonly ValidityGap[];
  products: readonly { id: string; name: string; status: string }[];
  candidates: { teams: readonly { id: string; name: string }[]; users: readonly { id: string; name: string }[] };
  today: string;
  canWrite: boolean;
  canPublish: boolean;
}) {
  return (
    <Tabs defaultValue="versions" className="space-y-6">
      <TabsList variant="line" aria-label="Dokument">
        <TabsTrigger value="versions">Versioner</TabsTrigger>
        <TabsTrigger value="access">Adgang</TabsTrigger>
        <TabsTrigger value="conflicts">
          Konflikter
          <span className="tabular rounded-sm bg-surface-sunken px-1.5 text-caption">{conflicts.filter((conflict) => conflict.status === "open").length}</span>
        </TabsTrigger>
        {canWrite ? <TabsTrigger value="metadata">Metadata</TabsTrigger> : null}
      </TabsList>

      <TabsContent value="versions" className="space-y-4">
        {gaps.length > 0 ? (
          <div role="status" className="rounded-md border border-warning/40 bg-warning-subtle px-4 py-3 text-body">
            <p className="font-medium">Kræver opmærksomhed: hul i gyldigheden</p>
            {gaps.map((gap) => (
              <p key={`${gap.language}-${gap.from}`}>
                {GAP_KIND_LABEL[gap.kind]}: fra {formatDate(gap.from)}
                {gap.to ? ` til og med ${formatValidTo(gap.to)}` : " og fremefter"} ({gap.language})
              </p>
            ))}
            <p className="text-fg-secondary">Hullet lukkes kun ved at publicere en ny version.</p>
          </div>
        ) : null}
        <Card className="p-0">
          <ul className="divide-y divide-border-subtle">
            {versions.map((version) => (
              <li key={version.id} className="flex flex-wrap items-center justify-between gap-2 px-6 py-3">
                <span>
                  <Link href={`/admin/documents/${document.id}/versions/${version.id}`} className="font-medium text-fg-link hover:underline">
                    {version.versionLabel ? `Version ${version.versionLabel}` : "Version uden betegnelse"}
                  </Link>
                  <span className="block text-caption text-fg-secondary">
                    {version.validFrom ? `Gyldig fra ${formatDate(version.validFrom)}` : "Ingen gyldighed angivet"}
                    {version.validTo ? ` til og med ${formatValidTo(version.validTo)}` : ""} · {version.language}
                  </span>
                </span>
                <VersionStatusBadge version={version} today={today} />
              </li>
            ))}
          </ul>
        </Card>
      </TabsContent>

      <TabsContent value="access">
        <AccessTab documentId={document.id} grants={grants} candidates={candidates} canWrite={canWrite} />
      </TabsContent>

      <TabsContent value="conflicts" className="space-y-4">
        {conflicts.length === 0 ? <EmptyState title="Ingen konflikter">Der er ingen registrerede konflikter for dette dokument.</EmptyState> : null}
        {conflicts.map((conflict) => (
          <ConflictCard key={conflict.id} conflict={conflict} canDecide={canPublish} />
        ))}
      </TabsContent>

      {canWrite ? (
        <TabsContent value="metadata">
          <MetadataTab document={document} products={products} />
        </TabsContent>
      ) : null}
    </Tabs>
  );
}

function AccessTab({
  documentId,
  grants,
  candidates,
  canWrite,
}: {
  documentId: string;
  grants: readonly AccessGrant[];
  candidates: { teams: readonly { id: string; name: string }[]; users: readonly { id: string; name: string }[] };
  canWrite: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<string[]>([]);
  const [form, setForm] = useState({ permission: "knowledge.document.read", granteeType: "team", teamId: "", userId: "", includeDescendants: false });

  function run(action: () => Promise<{ ok: true } | { ok: false; error: string }>) {
    setErrors([]);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) return setErrors([result.error]);
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      <p className="max-w-3xl text-body text-fg-secondary">
        Adgang gives pr. dokument til alle brugere, et team (dets medlemmer, eventuelt med underteams) eller en bruger. Et lederscope giver ingen
        adgang til viden. Fjernes en tildeling, forsvinder adgangen straks.
      </p>
      {grants.length === 0 ? (
        <EmptyState title="Ingen tildelinger">Kun brugere med adgang til alle dokumenter kan finde dette dokument.</EmptyState>
      ) : (
        <Card className="p-0">
          <ul className="divide-y divide-border-subtle">
            {grants.map((grant) => (
              <li key={grant.id} className="flex flex-wrap items-center justify-between gap-2 px-6 py-3">
                <span>
                  <span className="block font-medium text-fg-primary">{grant.granteeLabel}</span>
                  <span className="block text-caption text-fg-secondary">
                    {PERMISSION_LABEL[grant.permission]} · givet {formatDate(grant.grantedAt)}
                  </span>
                </span>
                {canWrite ? (
                  <Button variant="ghost" size="sm" loading={pending} onClick={() => run(() => removeGrant(documentId, grant.id))}>
                    Fjern
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      )}
      {canWrite ? (
        <Card className="space-y-3">
          <h2 className="text-heading-3">Tilføj tildeling</h2>
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="Rettighed">
              <SelectInput value={form.permission} onChange={(event) => setForm({ ...form, permission: event.target.value })}>
                <option value="knowledge.document.read">Læsning</option>
                <option value="knowledge.document.read_historical">Historisk læsning</option>
              </SelectInput>
            </Field>
            <Field label="Modtager">
              <SelectInput value={form.granteeType} onChange={(event) => setForm({ ...form, granteeType: event.target.value })}>
                <option value="all_users">Alle brugere</option>
                <option value="team">Team</option>
                <option value="user">Bruger</option>
              </SelectInput>
            </Field>
            {form.granteeType === "team" ? (
              <Field label="Team">
                <SelectInput value={form.teamId} onChange={(event) => setForm({ ...form, teamId: event.target.value })}>
                  <option value="">Vælg team</option>
                  {candidates.teams.map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.name}
                    </option>
                  ))}
                </SelectInput>
              </Field>
            ) : form.granteeType === "user" ? (
              <Field label="Bruger">
                <SelectInput value={form.userId} onChange={(event) => setForm({ ...form, userId: event.target.value })}>
                  <option value="">Vælg bruger</option>
                  {candidates.users.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.name}
                    </option>
                  ))}
                </SelectInput>
              </Field>
            ) : null}
          </div>
          {form.granteeType === "team" ? (
            <label className="flex items-center gap-2 text-body">
              <input type="checkbox" checked={form.includeDescendants} onChange={(event) => setForm({ ...form, includeDescendants: event.target.checked })} />
              Også medlemmer af underteams
            </label>
          ) : null}
          <FormError errors={errors} />
          <Button variant="secondary" size="sm" loading={pending} onClick={() => run(() => addGrant(documentId, form))}>
            Tilføj
          </Button>
        </Card>
      ) : null}
    </div>
  );
}

function MetadataTab({
  document,
  products,
}: {
  document: { id: string; title: string; productId: string; documentType: string; externalRef: string | null };
  products: readonly { id: string; name: string; status: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const [form, setForm] = useState({ title: document.title, productId: document.productId, documentType: document.documentType, externalRef: document.externalRef ?? "" });
  return (
    <Card className="max-w-2xl space-y-3">
      <Field label="Titel">
        <TextInput value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} maxLength={300} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Produkt">
          <SelectInput value={form.productId} onChange={(event) => setForm({ ...form, productId: event.target.value })}>
            {products.map((product) => (
              <option key={product.id} value={product.id} disabled={product.status !== "active" && product.id !== document.productId}>
                {product.name}
              </option>
            ))}
          </SelectInput>
        </Field>
        <Field label="Dokumenttype">
          <SelectInput value={form.documentType} onChange={(event) => setForm({ ...form, documentType: event.target.value })}>
            {DOCUMENT_TYPES.map((type) => (
              <option key={type.key} value={type.key}>
                {type.label}
              </option>
            ))}
          </SelectInput>
        </Field>
      </div>
      <Field label="Ekstern reference" hint="Valgfri">
        <TextInput value={form.externalRef} onChange={(event) => setForm({ ...form, externalRef: event.target.value })} maxLength={500} />
      </Field>
      <FormError errors={errors} />
      {saved ? <StatusBadge status="success" label="Gemt" /> : null}
      <Button
        variant="secondary"
        size="sm"
        loading={pending}
        onClick={() =>
          startTransition(async () => {
            setSaved(false);
            const result = await updateDocumentMetadata(document.id, form);
            if (!result.ok) return setErrors([result.error]);
            setErrors([]);
            setSaved(true);
            router.refresh();
          })
        }
      >
        Gem
      </Button>
    </Card>
  );
}
