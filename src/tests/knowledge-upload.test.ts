import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { DOCUMENT_TYPES } from "@/lib/knowledge/document-types";
import { originalPath, sanitizeFilename, validateUploadMetadata, type UploadMetadataInput } from "@/lib/knowledge/upload-validation";

const migration = readFileSync(
  path.resolve(__dirname, "../../supabase/migrations/20261001000100_knowledge_foundation.sql"),
  "utf8",
);

const base: UploadMetadataInput = {
  newDocument: { productId: "00000000-0000-4000-a000-000000000301", documentType: "terms", title: "Testbetingelser" },
  versionLabel: "1",
  validFrom: "2026-01-01",
  checksumSha256: "a".repeat(64),
  originalFilename: "testbetingelser.pdf",
  byteSize: 1024,
  mimeType: "application/pdf",
};

describe("document types (docs/07 §1.2)", () => {
  it("are exactly the eight types seeded by the migration", () => {
    const block = migration.slice(migration.indexOf("insert into knowledge.document_types"), migration.indexOf("-- Kilder"));
    const seeded = [...block.matchAll(/\('([a-z_]+)', '([^']+)', \d+\)/g)].map((match) => ({ key: match[1], label: match[2] }));
    expect(seeded).toEqual(DOCUMENT_TYPES.map((type) => ({ key: type.key, label: type.label })));
  });
});

describe("upload metadata validation (docs/07 §5.1, §14)", () => {
  it("accepts a new document with complete metadata", () => {
    const result = validateUploadMetadata(base);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.language).toBe("da");
  });

  it("accepts a new version without validity — it can be processed, just not approved", () => {
    expect(validateUploadMetadata({ ...base, validFrom: null, versionLabel: null }).ok).toBe(true);
  });

  it("requires either an existing document or a new one, not both", () => {
    expect(validateUploadMetadata({ ...base, documentId: "00000000-0000-4000-a000-000000000999" }).ok).toBe(false);
    expect(validateUploadMetadata({ ...base, newDocument: null }).ok).toBe(false);
  });

  it("only accepts PDF (docs/07 §5.4, B-14)", () => {
    expect(validateUploadMetadata({ ...base, originalFilename: "betingelser.docx" }).ok).toBe(false);
    expect(validateUploadMetadata({ ...base, mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }).ok).toBe(false);
    expect(validateUploadMetadata({ ...base, originalFilename: "skannet.png", mimeType: "image/png" }).ok).toBe(false);
  });

  it("rejects empty and too large files", () => {
    expect(validateUploadMetadata({ ...base, byteSize: 0 }).ok).toBe(false);
    expect(validateUploadMetadata({ ...base, byteSize: 50 * 1024 * 1024 + 1 }).ok).toBe(false);
  });

  it("rejects unknown document types and invalid dates", () => {
    expect(validateUploadMetadata({ ...base, newDocument: { ...base.newDocument!, documentType: "contract" } }).ok).toBe(false);
    expect(validateUploadMetadata({ ...base, validFrom: "2026-02-30" }).ok).toBe(false);
    expect(validateUploadMetadata({ ...base, validFrom: "2026-01-01", validTo: "2026-01-01" }).ok).toBe(false);
  });

  it("requires a SHA-256 checksum", () => {
    expect(validateUploadMetadata({ ...base, checksumSha256: "abc" }).ok).toBe(false);
  });

  it("keeps only the base name of the file and never uses it in the storage path", () => {
    expect(sanitizeFilename("C:\\Users\\x\\..\\betingelser.pdf")).toBe("betingelser.pdf");
    expect(sanitizeFilename("../../etc/passwd.pdf")).toBe("passwd.pdf");
    expect(originalPath("11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222")).toBe(
      "11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/original.pdf",
    );
  });
});
