import type { CheckResult, ProductList, RowOutcome, StatusCategory, StatusResult } from "./importer.ts";
import { CATEGORY_LABEL } from "./importer.ts";

/**
 * The importer's reports (beta L3): Danish text for the administrator and the same facts as JSON
 * for the record. Only metadata — file name, line, outcome, ids, counts and plain-language
 * reasons. Never document text, never a credential.
 */

const OUTCOME_LABEL: Record<RowOutcome, string> = {
  ready: "Klar til upload",
  exists: "Findes allerede (springes over)",
  imported: "Importeret (venter på sikkerhedskontrol)",
  invalid: "Afvist før upload",
  failed: "Fejl (kan genoptages)",
};

function count<T extends string>(values: T[]): Map<T, number> {
  const counts = new Map<T, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return counts;
}

export function renderCheck(title: string, result: CheckResult, at: Date): string {
  const lines = [`${title} — ${at.toISOString()}`, ""];
  if (result.manifestErrors.length > 0) {
    lines.push("Importlisten kan ikke bruges:", ...result.manifestErrors.map((error) => `  - ${error}`), "", "Intet er uploadet.");
    return `${lines.join("\n")}\n`;
  }
  const counts = count(result.rows.map((row) => row.outcome));
  lines.push("Opsummering:");
  for (const outcome of ["imported", "ready", "exists", "invalid", "failed"] as RowOutcome[]) {
    if (counts.get(outcome)) lines.push(`  ${OUTCOME_LABEL[outcome]}: ${counts.get(outcome)}`);
  }
  lines.push(`  I alt: ${result.rows.length}`, "");
  for (const row of result.rows) {
    lines.push(`Række ${row.line}: ${row.file || "(intet filnavn)"} — ${OUTCOME_LABEL[row.outcome]}`);
    if (row.productName) lines.push(`  Produkt: ${row.productName}`);
    if (row.sha256) lines.push(`  SHA-256: ${row.sha256}`);
    if (row.versionId) lines.push(`  Version: ${row.versionId}`);
    for (const message of row.messages) lines.push(`  - ${message}`);
  }
  if (result.unlisted.length > 0) {
    lines.push("", "PDF'er i importmappen, som ikke står på importlisten (importeres ikke):", ...result.unlisted.map((name) => `  - ${name}`));
  }
  return `${lines.join("\n")}\n`;
}

export function renderStatus(result: StatusResult, at: Date): string {
  const lines = [`Status for importen — ${at.toISOString()}`, ""];
  if (result.manifestErrors.length > 0) {
    lines.push("Importlisten kan ikke bruges:", ...result.manifestErrors.map((error) => `  - ${error}`));
    return `${lines.join("\n")}\n`;
  }
  const counts = count(result.rows.map((row) => row.category));
  lines.push("Opsummering:");
  for (const [category, value] of counts) lines.push(`  ${CATEGORY_LABEL[category as StatusCategory]}: ${value}`);
  lines.push(`  I alt: ${result.rows.length}`, "");
  for (const row of result.rows) {
    lines.push(`Række ${row.line}: ${row.file || "(intet filnavn)"} — ${row.label}`);
    if (row.productName) lines.push(`  Produkt: ${row.productName}`);
    if (row.versionStatus) lines.push(`  Versionens status: ${row.versionStatus}; sikkerhed: ${row.security ?? "ukendt"}`);
    if (row.completeness) {
      const c = row.completeness;
      lines.push(`  Sider: ${c.pages} (med tekstlag: ${c.pagesWithText}); tegn: ${c.characters}; tekstsegmenter: ${c.chunks}; original: ${c.originalMatches ? "samme SHA-256 som filen" : "AFVIGER eller kunne ikke hentes"}`);
    }
    if (row.accessGrants !== undefined) lines.push(`  Adgangstildelinger: ${row.accessGrants}`);
    if (row.versionId) lines.push(`  Version: ${row.versionId}`);
    for (const message of row.messages) lines.push(`  - ${message}`);
  }
  return `${lines.join("\n")}\n`;
}

export function renderProducts(list: ProductList): string {
  const lines = ["Aktive produkter (brug id'et i kolonnen produkt_id):", ""];
  if (list.products.length === 0) lines.push("  (ingen — opret produkterne i Admin først)");
  for (const product of list.products) lines.push(`  ${product.id}  ${product.name}${product.category ? ` (${product.category})` : ""}`);
  lines.push("", "Dokumenttyper (brug nøglen eller navnet i kolonnen dokumenttype):", "");
  for (const type of list.documentTypes) lines.push(`  ${type.key.padEnd(20)} ${type.label}`);
  return `${lines.join("\n")}\n`;
}
