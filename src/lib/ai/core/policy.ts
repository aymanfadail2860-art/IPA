import { DATA_CATEGORIES, type DataCategory, type PolicyRule } from "./types";

/**
 * The data category matrix (docs/08 §5, B-017). The rows live in the database
 * (ai.data_category_policy); this is how they are evaluated. Fail-closed: a missing row is
 * "deny", audit_access is always "deny", and a profile can only narrow the matrix.
 */

export interface PolicyRow {
  model_id: string;
  category: string;
  rule: string;
}

export type Matrix = ReadonlyMap<DataCategory, PolicyRule>;

const STRICTNESS: Record<PolicyRule, number> = { allow: 0, allow_redacted: 1, deny: 2 };

export function buildMatrix(rows: readonly PolicyRow[], modelId: string): Matrix {
  const matrix = new Map<DataCategory, PolicyRule>();
  for (const row of rows) {
    if (row.model_id !== modelId) continue;
    if (!(DATA_CATEGORIES as readonly string[]).includes(row.category)) continue;
    if (row.rule !== "allow" && row.rule !== "allow_redacted" && row.rule !== "deny") continue;
    matrix.set(row.category as DataCategory, row.rule);
  }
  return matrix;
}

/** The effective rule: the strictest of the matrix and the profile. Missing = deny. */
export function effectiveRule(matrix: Matrix, category: DataCategory, profileCategories: readonly DataCategory[]): PolicyRule {
  if (category === "audit_access") return "deny";
  if (!profileCategories.includes(category)) return "deny";
  const rule = matrix.get(category) ?? "deny";
  return STRICTNESS[rule] >= STRICTNESS.deny ? "deny" : rule;
}
