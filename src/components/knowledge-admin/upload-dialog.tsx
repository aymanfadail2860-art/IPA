"use client";

import { Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { DOCUMENT_TYPES } from "@/lib/knowledge/document-types";
import { findDuplicateVersions, registerUploadedVersion, requestUploadTarget, type DuplicateVersion } from "@/lib/knowledge/upload-actions";
import { MAX_ORIGINAL_BYTES, ORIGINAL_MIME_TYPE, ORIGINALS_BUCKET } from "@/lib/knowledge/upload-validation";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

import { Field, FormError, SelectInput, TextInput } from "./form";

async function sha256Hex(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Upload dialog (docs/07 §12, §2.3): file + metadata → SHA-256 in the browser → duplicate
 * dialog → signed upload URL → upload straight to the private bucket → registration. The
 * worker processes the file afterwards; nothing here can make a version authoritative.
 */
export function UploadDialog({
  products,
  documents,
  fixedDocument,
}: {
  products: readonly { id: string; name: string; status: string }[];
  documents: readonly { id: string; title: string }[];
  /** "Ny version" from a document page. */
  fixedDocument?: { id: string; title: string };
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [duplicates, setDuplicates] = useState<DuplicateVersion[] | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<"new" | "version">(fixedDocument ? "version" : "new");
  const [form, setForm] = useState({
    documentId: fixedDocument?.id ?? "",
    productId: products.find((product) => product.status === "active")?.id ?? "",
    documentType: "terms",
    title: "",
    versionLabel: "",
    validFrom: "",
    validTo: "",
    language: "da",
  });
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) => setForm((current) => ({ ...current, [key]: event.target.value }));

  function reset() {
    setErrors([]);
    setDuplicates(null);
    setBusy(false);
  }

  async function submit(options: { skipDuplicateCheck?: boolean; asVersionOf?: string } = {}) {
    if (!file) return setErrors(["Vælg en PDF-fil."]);
    if (file.type !== ORIGINAL_MIME_TYPE) return setErrors(["Kun PDF-filer kan uploades i denne fase."]);
    if (file.size > MAX_ORIGINAL_BYTES) return setErrors(["Filen er for stor (højst 50 MB)."]);
    setBusy(true);
    setErrors([]);
    try {
      const checksumSha256 = await sha256Hex(file);
      if (!options.skipDuplicateCheck) {
        const found = await findDuplicateVersions(checksumSha256);
        if (found.length > 0) {
          setDuplicates(found);
          setBusy(false);
          return;
        }
      }
      const documentId = options.asVersionOf ?? (mode === "version" ? form.documentId : null);
      const metadata = {
        documentId,
        newDocument: documentId ? null : { productId: form.productId, documentType: form.documentType, title: form.title },
        versionLabel: form.versionLabel || null,
        language: form.language,
        validFrom: form.validFrom || null,
        validTo: form.validTo || null,
        checksumSha256,
        originalFilename: file.name,
        byteSize: file.size,
        mimeType: file.type,
      };
      const target = await requestUploadTarget(metadata);
      if (!target.ok) return reset(), setErrors(target.errors);
      const upload = await createSupabaseBrowserClient()
        .storage.from(ORIGINALS_BUCKET)
        .uploadToSignedUrl(target.path, target.token, file, { contentType: ORIGINAL_MIME_TYPE });
      if (upload.error) return reset(), setErrors(["Filen kunne ikke uploades. Prøv igen."]);
      const registered = await registerUploadedVersion({ ...metadata, documentId: target.documentId, versionId: target.versionId, isNewDocument: !documentId });
      if (!registered.ok) return reset(), setErrors(registered.errors);
      setOpen(false);
      reset();
      router.push(`/admin/documents/${target.documentId}/versions/${target.versionId}`);
    } catch {
      reset();
      setErrors(["Upload mislykkedes. Prøv igen."]);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (setOpen(next), reset())}>
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm">
          <Upload aria-hidden />
          {fixedDocument ? "Ny version" : "Upload dokument"}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{fixedDocument ? `Ny version af ${fixedDocument.title}` : "Upload dokument"}</DialogTitle>
          <DialogDescription>
            Filen behandles automatisk efter upload. Den bliver først autoritativ, når en fagligt ansvarlig har godkendt den.
          </DialogDescription>
        </DialogHeader>

        {duplicates ? (
          <div className="space-y-3">
            <p className="text-body text-fg-primary">Filen findes allerede:</p>
            <ul className="space-y-1 text-body text-fg-secondary">
              {duplicates.map((duplicate) => (
                <li key={duplicate.versionId}>
                  {duplicate.title}
                  {duplicate.versionLabel ? `, version ${duplicate.versionLabel}` : ""} ({duplicate.status})
                </li>
              ))}
            </ul>
            <FormError errors={errors} />
            <DialogFooter className="flex-wrap gap-2">
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Afvis upload
              </Button>
              <Button variant="secondary" disabled={busy} onClick={() => submit({ skipDuplicateCheck: true })}>
                Upload som angivet
              </Button>
              <Button variant="secondary" disabled={busy} onClick={() => submit({ skipDuplicateCheck: true, asVersionOf: duplicates[0]!.documentId })}>
                Ny version af {duplicates[0]!.title}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <Field label="Fil (PDF)">
              <TextInput type="file" accept={ORIGINAL_MIME_TYPE} onChange={(event) => setFile(event.target.files?.[0] ?? null)} required />
            </Field>
            {fixedDocument ? null : (
              <div className="flex gap-4 text-body">
                <label className="flex items-center gap-2">
                  <input type="radio" checked={mode === "new"} onChange={() => setMode("new")} /> Nyt dokument
                </label>
                <label className="flex items-center gap-2">
                  <input type="radio" checked={mode === "version"} onChange={() => setMode("version")} /> Ny version af et dokument
                </label>
              </div>
            )}
            {mode === "version" && !fixedDocument ? (
              <Field label="Dokument">
                <SelectInput value={form.documentId} onChange={set("documentId")} required>
                  <option value="">Vælg dokument</option>
                  {documents.map((document) => (
                    <option key={document.id} value={document.id}>
                      {document.title}
                    </option>
                  ))}
                </SelectInput>
              </Field>
            ) : null}
            {mode === "new" ? (
              <>
                <Field label="Titel">
                  <TextInput value={form.title} onChange={set("title")} maxLength={300} required />
                </Field>
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Produkt">
                    <SelectInput value={form.productId} onChange={set("productId")} required>
                      {products
                        .filter((product) => product.status === "active")
                        .map((product) => (
                          <option key={product.id} value={product.id}>
                            {product.name}
                          </option>
                        ))}
                    </SelectInput>
                  </Field>
                  <Field label="Dokumenttype">
                    <SelectInput value={form.documentType} onChange={set("documentType")}>
                      {DOCUMENT_TYPES.map((type) => (
                        <option key={type.key} value={type.key}>
                          {type.label}
                        </option>
                      ))}
                    </SelectInput>
                  </Field>
                </div>
              </>
            ) : null}
            <div className="grid grid-cols-3 gap-4">
              <Field label="Versionsbetegnelse">
                <TextInput value={form.versionLabel} onChange={set("versionLabel")} maxLength={100} />
              </Field>
              <Field label="Gyldig fra">
                <TextInput type="date" value={form.validFrom} onChange={set("validFrom")} />
              </Field>
              <Field label="Gyldig til" hint="Valgfri">
                <TextInput type="date" value={form.validTo} onChange={set("validTo")} />
              </Field>
            </div>
            <Field label="Sprog">
              <SelectInput value={form.language} onChange={set("language")}>
                <option value="da">Dansk</option>
                <option value="en">Engelsk</option>
              </SelectInput>
            </Field>
            <FormError errors={errors} />
            <DialogFooter>
              <Button type="submit" variant="secondary" loading={busy}>
                Upload
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
