/**
 * The eight document types from docs/03 §6 (docs/07 §1.2), as seeded in
 * supabase/migrations/20261001000100_knowledge_foundation.sql. Kept in sync by
 * src/tests/knowledge-upload.test.ts. No further types are invented.
 */
export const DOCUMENT_TYPES = [
  { key: "policy_text", label: "Policetekst" },
  { key: "terms", label: "Betingelser" },
  { key: "product_description", label: "Produktbeskrivelse" },
  { key: "acceptance_rules", label: "Acceptregler" },
  { key: "business_procedure", label: "Forretningsgang" },
  { key: "guidance", label: "Vejledning" },
  { key: "sales_material", label: "Salgsmateriale" },
  { key: "internal_document", label: "Internt fagligt dokument" },
] as const;

export type DocumentTypeKey = (typeof DOCUMENT_TYPES)[number]["key"];

export function isDocumentTypeKey(value: unknown): value is DocumentTypeKey {
  return DOCUMENT_TYPES.some((type) => type.key === value);
}
