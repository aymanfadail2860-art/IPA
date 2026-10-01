import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";

import type {
  AccessGrant,
  AdminConflict,
  AdminProduct,
  AdminVersionRow,
  ConflictPassage,
  CoverageRow,
  ValidityGap,
  VersionStatus,
} from "./admin-types";

/*
 * Reads for the Knowledge Engine administration (docs/07 §12). Every query runs as the
 * signed-in user: RLS and the database functions decide what is returned. The pages check
 * permissions themselves first; nothing here is a shortcut around the database.
 */

async function knowledge() {
  return (await createSupabaseServerClient()).schema("knowledge");
}

type VersionRecord = {
  id: string;
  document_id: string;
  version_label: string | null;
  language: string;
  status: VersionStatus;
  valid_from: string | null;
  valid_to: string | null;
  superseded_by: string | null;
  uploaded_at: string;
  updated_at: string;
  documents: { title: string; document_type: string; products: { name: string } | null } | null;
};

const VERSION_COLUMNS =
  "id, document_id, version_label, language, status, valid_from, valid_to, superseded_by, uploaded_at, updated_at, documents(title, document_type, products(name))";

async function gapDocumentIds(): Promise<Set<string>> {
  const { data } = await (await knowledge()).rpc("validity_gaps");
  return new Set(((data ?? []) as { document_id: string }[]).map((row) => row.document_id));
}

async function failureReasons(versionIds: string[]): Promise<Map<string, string>> {
  if (versionIds.length === 0) return new Map();
  const { data } = await (await knowledge())
    .from("ingestion_jobs")
    .select("document_version_id, error_message, finished_at")
    .eq("status", "failed")
    .in("document_version_id", versionIds)
    .order("finished_at", { ascending: false });
  const reasons = new Map<string, string>();
  for (const row of (data ?? []) as { document_version_id: string; error_message: string | null }[]) {
    if (row.error_message && !reasons.has(row.document_version_id)) reasons.set(row.document_version_id, row.error_message);
  }
  return reasons;
}

function toVersionRow(record: VersionRecord, gaps: Set<string>, reasons: Map<string, string>): AdminVersionRow {
  return {
    id: record.id,
    documentId: record.document_id,
    documentTitle: record.documents?.title ?? "",
    productName: record.documents?.products?.name ?? "",
    documentType: record.documents?.document_type ?? "",
    versionLabel: record.version_label,
    language: record.language,
    status: record.status,
    validFrom: record.valid_from,
    validTo: record.valid_to,
    supersededBy: record.superseded_by,
    uploadedAt: record.uploaded_at,
    updatedAt: record.updated_at,
    errorMessage: record.status === "processing_failed" ? (reasons.get(record.id) ?? null) : null,
    documentHasGap: gaps.has(record.document_id),
  };
}

/** All versions except discarded ones, newest first (the document list). */
export async function listVersions(documentId?: string): Promise<AdminVersionRow[]> {
  let query = (await knowledge()).from("document_versions").select(VERSION_COLUMNS).neq("status", "discarded").order("updated_at", { ascending: false }).limit(500);
  if (documentId) query = query.eq("document_id", documentId);
  const { data } = await query;
  const records = (data ?? []) as unknown as VersionRecord[];
  const [gaps, reasons] = await Promise.all([gapDocumentIds(), failureReasons(records.filter((r) => r.status === "processing_failed").map((r) => r.id))]);
  return records.map((record) => toVersionRow(record, gaps, reasons));
}

export async function getVersionRow(versionId: string): Promise<AdminVersionRow | null> {
  const { data } = await (await knowledge()).from("document_versions").select(VERSION_COLUMNS).eq("id", versionId).maybeSingle();
  if (!data) return null;
  const record = data as unknown as VersionRecord;
  const [gaps, reasons] = await Promise.all([gapDocumentIds(), failureReasons([record.id])]);
  return toVersionRow(record, gaps, reasons);
}

export async function listProducts(): Promise<AdminProduct[]> {
  const db = await knowledge();
  const [{ data: products }, { data: documents }] = await Promise.all([
    db.from("products").select("id, name, category, status").order("name"),
    db.from("documents").select("product_id"),
  ]);
  const counts = new Map<string, number>();
  for (const row of (documents ?? []) as { product_id: string }[]) counts.set(row.product_id, (counts.get(row.product_id) ?? 0) + 1);
  return ((products ?? []) as Omit<AdminProduct, "documentCount">[]).map((product) => ({ ...product, documentCount: counts.get(product.id) ?? 0 }));
}

export interface AdminDocumentDetail {
  id: string;
  title: string;
  productId: string;
  productName: string;
  documentType: string;
  sourceType: string;
  externalRef: string | null;
}

export async function listDocuments(productId?: string): Promise<(AdminDocumentDetail & { versionCount: number })[]> {
  let query = (await knowledge()).from("documents").select("id, title, product_id, document_type, external_ref, products(name), sources(type), document_versions(id)").order("title");
  if (productId) query = query.eq("product_id", productId);
  const { data } = await query;
  return ((data ?? []) as unknown as {
    id: string;
    title: string;
    product_id: string;
    document_type: string;
    external_ref: string | null;
    products: { name: string } | null;
    sources: { type: string } | null;
    document_versions: { id: string }[];
  }[]).map((row) => ({
    id: row.id,
    title: row.title,
    productId: row.product_id,
    productName: row.products?.name ?? "",
    documentType: row.document_type,
    sourceType: row.sources?.type ?? "",
    externalRef: row.external_ref,
    versionCount: row.document_versions.length,
  }));
}

export async function getDocument(documentId: string): Promise<AdminDocumentDetail | null> {
  const { data } = await (await knowledge())
    .from("documents")
    .select("id, title, product_id, document_type, external_ref, products(name), sources(type)")
    .eq("id", documentId)
    .maybeSingle();
  if (!data) return null;
  const row = data as unknown as {
    id: string;
    title: string;
    product_id: string;
    document_type: string;
    external_ref: string | null;
    products: { name: string } | null;
    sources: { type: string } | null;
  };
  return {
    id: row.id,
    title: row.title,
    productId: row.product_id,
    productName: row.products?.name ?? "",
    documentType: row.document_type,
    sourceType: row.sources?.type ?? "",
    externalRef: row.external_ref,
  };
}

export async function listGrants(documentId: string): Promise<AccessGrant[]> {
  const db = await knowledge();
  const { data } = await db
    .from("document_access_grants")
    .select("id, permission_key, grantee_type, team_id, user_id, include_descendants, granted_at")
    .eq("document_id", documentId)
    .order("granted_at");
  const rows = (data ?? []) as {
    id: string;
    permission_key: AccessGrant["permission"];
    grantee_type: AccessGrant["granteeType"];
    team_id: string | null;
    user_id: string | null;
    include_descendants: boolean;
    granted_at: string;
  }[];
  const identity = (await createSupabaseServerClient()).schema("identity");
  const teamIds = rows.flatMap((row) => (row.team_id ? [row.team_id] : []));
  const userIds = rows.flatMap((row) => (row.user_id ? [row.user_id] : []));
  const [{ data: teams }, { data: users }] = await Promise.all([
    teamIds.length ? identity.from("teams").select("id, name").in("id", teamIds) : Promise.resolve({ data: [] }),
    userIds.length ? identity.from("users").select("id, display_name").in("id", userIds) : Promise.resolve({ data: [] }),
  ]);
  const teamName = new Map(((teams ?? []) as { id: string; name: string }[]).map((team) => [team.id, team.name]));
  const userName = new Map(((users ?? []) as { id: string; display_name: string }[]).map((user) => [user.id, user.display_name]));
  return rows.map((row) => ({
    id: row.id,
    permission: row.permission_key,
    granteeType: row.grantee_type,
    granteeLabel:
      row.grantee_type === "all_users"
        ? "Alle brugere"
        : row.grantee_type === "team"
          ? `Team: ${teamName.get(row.team_id!) ?? "(ikke synligt for dig)"}${row.include_descendants ? " + underteams" : ""}`
          : `Bruger: ${userName.get(row.user_id!) ?? "(ikke synlig for dig)"}`,
    includeDescendants: row.include_descendants,
    grantedAt: row.granted_at,
  }));
}

/** Teams and users the signed-in user may see (RLS), for the access form. */
export async function grantCandidates(): Promise<{ teams: { id: string; name: string }[]; users: { id: string; name: string }[] }> {
  const identity = (await createSupabaseServerClient()).schema("identity");
  const [{ data: teams }, { data: users }] = await Promise.all([
    identity.from("teams").select("id, name").order("name"),
    identity.from("users").select("id, display_name").eq("status", "active").order("display_name"),
  ]);
  return {
    teams: (teams ?? []) as { id: string; name: string }[],
    users: ((users ?? []) as { id: string; display_name: string }[]).map((user) => ({ id: user.id, name: user.display_name })),
  };
}

type GapRecord = { document_id: string; language: string; gap_from: string; gap_to: string | null; kind: ValidityGap["kind"] };

async function withTitles(rows: GapRecord[]): Promise<ValidityGap[]> {
  if (rows.length === 0) return [];
  const { data } = await (await knowledge()).from("documents").select("id, title").in("id", [...new Set(rows.map((row) => row.document_id))]);
  const titles = new Map(((data ?? []) as { id: string; title: string }[]).map((row) => [row.id, row.title]));
  return rows.map((row) => ({
    documentId: row.document_id,
    documentTitle: titles.get(row.document_id) ?? "",
    language: row.language,
    from: row.gap_from,
    to: row.gap_to,
    kind: row.kind,
  }));
}

/** Gaps in validity (B-006) — a state that needs attention; closed only by publishing a new version. */
export async function listGaps(documentId?: string): Promise<ValidityGap[]> {
  const { data } = await (await knowledge()).rpc("validity_gaps", documentId ? { p_document_id: documentId } : {});
  return withTitles((data ?? []) as GapRecord[]);
}

/** The gaps a withdrawal would leave (shown in the confirmation dialog). */
export async function gapsAfterWithdrawal(versionId: string): Promise<ValidityGap[]> {
  const { data } = await (await knowledge()).rpc("gaps_after_withdrawal", { p_version_id: versionId });
  return withTitles((data ?? []) as GapRecord[]);
}

export async function listConflicts(options: { status?: AdminConflict["status"]; documentId?: string } = {}): Promise<AdminConflict[]> {
  const db = await knowledge();
  let query = db
    .from("conflicts")
    .select("id, status, detected_by, detection_rule, description, created_at, resolved_at, resolution_note, conflict_passages(side, document_version_id, chunk_id)")
    .order("created_at", { ascending: false })
    .limit(200);
  if (options.status) query = query.eq("status", options.status);
  const { data } = await query;
  const records = (data ?? []) as {
    id: string;
    status: AdminConflict["status"];
    detected_by: AdminConflict["detectedBy"];
    detection_rule: AdminConflict["rule"];
    description: string | null;
    created_at: string;
    resolved_at: string | null;
    resolution_note: string | null;
    conflict_passages: { side: "A" | "B"; document_version_id: string; chunk_id: string | null }[];
  }[];
  const versionIds = [...new Set(records.flatMap((record) => record.conflict_passages.map((passage) => passage.document_version_id)))];
  const chunkIds = [...new Set(records.flatMap((record) => record.conflict_passages.flatMap((passage) => (passage.chunk_id ? [passage.chunk_id] : []))))];
  const [{ data: versions }, { data: chunks }] = await Promise.all([
    versionIds.length ? db.from("document_versions").select("id, document_id, version_label, status, documents(title)").in("id", versionIds) : Promise.resolve({ data: [] }),
    chunkIds.length ? db.from("document_chunks").select("id, text, heading, page_start, page_end").in("id", chunkIds) : Promise.resolve({ data: [] }),
  ]);
  const versionById = new Map(
    ((versions ?? []) as unknown as { id: string; document_id: string; version_label: string | null; status: VersionStatus; documents: { title: string } | null }[]).map(
      (version) => [version.id, version],
    ),
  );
  const chunkById = new Map(
    ((chunks ?? []) as { id: string; text: string; heading: string | null; page_start: number; page_end: number }[]).map((chunk) => [chunk.id, chunk]),
  );
  return records
    .map((record) => ({
      id: record.id,
      status: record.status,
      detectedBy: record.detected_by,
      rule: record.detection_rule,
      description: record.description,
      createdAt: record.created_at,
      resolvedAt: record.resolved_at,
      resolutionNote: record.resolution_note,
      passages: record.conflict_passages
        .map((passage): ConflictPassage => {
          const version = versionById.get(passage.document_version_id);
          const chunk = passage.chunk_id ? chunkById.get(passage.chunk_id) : undefined;
          return {
            side: passage.side,
            versionId: passage.document_version_id,
            documentId: version?.document_id ?? "",
            documentTitle: version?.documents?.title ?? "",
            versionLabel: version?.version_label ?? null,
            versionStatus: version?.status ?? "published",
            chunk: chunk ? { id: chunk.id, text: chunk.text, heading: chunk.heading, pageStart: chunk.page_start, pageEnd: chunk.page_end } : null,
          };
        })
        .sort((a, b) => a.side.localeCompare(b.side)),
    }))
    .filter((conflict) => !options.documentId || conflict.passages.some((passage) => passage.documentId === options.documentId));
}

/** Published documents per product and type, and the types that are missing (docs/07 §12). */
export async function coverage(): Promise<CoverageRow[]> {
  const db = await knowledge();
  const [{ data: products }, { data: versions }] = await Promise.all([
    db.from("products").select("id, name").eq("status", "active").order("name"),
    db.from("document_versions").select("document_id, documents(product_id, document_type)").eq("status", "published"),
  ]);
  const seen = new Map<string, Map<string, Set<string>>>();
  for (const row of (versions ?? []) as unknown as { document_id: string; documents: { product_id: string; document_type: string } | null }[]) {
    if (!row.documents) continue;
    const byType = seen.get(row.documents.product_id) ?? new Map<string, Set<string>>();
    const documents = byType.get(row.documents.document_type) ?? new Set<string>();
    documents.add(row.document_id);
    byType.set(row.documents.document_type, documents);
    seen.set(row.documents.product_id, byType);
  }
  return ((products ?? []) as { id: string; name: string }[]).map((product) => ({
    productId: product.id,
    productName: product.name,
    publishedByType: Object.fromEntries([...(seen.get(product.id) ?? new Map<string, Set<string>>()).entries()].map(([type, documents]) => [type, documents.size])),
  }));
}

export interface StructureChunk {
  id: string;
  index: number;
  kind: string;
  text: string;
  leadIn: string | null;
  headingPath: string[];
  pageStart: number;
  pageEnd: number;
}

export interface VersionDetail {
  pages: { number: number; hasTextLayer: boolean; chars: number }[];
  chunks: StructureChunk[];
  reviewState: {
    status: string;
    canApprove: boolean;
    blockers: { code: string; message: string }[];
    warnings: { code: string; message: string }[];
    publication: Record<string, unknown>;
    qualityReport: Record<string, unknown>;
  } | null;
  conflictCandidates: { rule: AdminConflict["rule"]; documentTitle: string; versionLabel: string | null; chunkCount: number; registered: boolean }[];
  reviews: { decision: string; reason: string | null; decidedAt: string }[];
  metadata: { originalFilename: string | null; byteSize: number | null; pageCount: number | null; extractorVersion: string | null; chunkerVersion: string | null; approvedAt: string | null; withdrawnAt: string | null; withdrawalReason: string | null };
}

export async function getVersionDetail(versionId: string): Promise<VersionDetail> {
  const db = await knowledge();
  const [pages, chunks, review, candidates, reviews, version] = await Promise.all([
    db.from("document_pages").select("page_number, has_text_layer, char_start, char_end").eq("document_version_id", versionId).order("page_number"),
    db.from("document_chunks").select("id, chunk_index, kind, text, lead_in, heading_path, page_start, page_end").eq("document_version_id", versionId).order("chunk_index").limit(2000),
    db.rpc("review_state", { p_version_id: versionId }),
    db.rpc("conflict_candidates", { p_version_id: versionId }),
    db.from("version_reviews").select("decision, reason, decided_at").eq("version_id", versionId).order("decided_at"),
    db.from("document_versions").select("original_filename, byte_size, page_count, extractor_version, chunker_version, approved_at, withdrawn_at, withdrawal_reason").eq("id", versionId).maybeSingle(),
  ]);
  const state = review.data as {
    status: string;
    can_approve: boolean;
    blockers: { code: string; message: string }[];
    warnings: { code: string; message: string }[];
    publication: Record<string, unknown>;
    quality_report: Record<string, unknown>;
  } | null;
  const meta = (version.data ?? {}) as Record<string, unknown>;
  return {
    pages: ((pages.data ?? []) as { page_number: number; has_text_layer: boolean; char_start: number; char_end: number }[]).map((page) => ({
      number: page.page_number,
      hasTextLayer: page.has_text_layer,
      chars: page.char_end - page.char_start,
    })),
    chunks: ((chunks.data ?? []) as { id: string; chunk_index: number; kind: string; text: string; lead_in: string | null; heading_path: string[]; page_start: number; page_end: number }[]).map(
      (chunk) => ({
        id: chunk.id,
        index: chunk.chunk_index,
        kind: chunk.kind,
        text: chunk.text,
        leadIn: chunk.lead_in,
        headingPath: chunk.heading_path,
        pageStart: chunk.page_start,
        pageEnd: chunk.page_end,
      }),
    ),
    reviewState: state
      ? { status: state.status, canApprove: state.can_approve, blockers: state.blockers, warnings: state.warnings, publication: state.publication, qualityReport: state.quality_report }
      : null,
    conflictCandidates: ((candidates.data ?? []) as { rule: AdminConflict["rule"]; document_title: string; version_label: string | null; chunk_count: number; registered: boolean }[]).map(
      (candidate) => ({
        rule: candidate.rule,
        documentTitle: candidate.document_title,
        versionLabel: candidate.version_label,
        chunkCount: candidate.chunk_count,
        registered: candidate.registered,
      }),
    ),
    reviews: ((reviews.data ?? []) as { decision: string; reason: string | null; decided_at: string }[]).map((row) => ({ decision: row.decision, reason: row.reason, decidedAt: row.decided_at })),
    metadata: {
      originalFilename: (meta.original_filename as string | null) ?? null,
      byteSize: (meta.byte_size as number | null) ?? null,
      pageCount: (meta.page_count as number | null) ?? null,
      extractorVersion: (meta.extractor_version as string | null) ?? null,
      chunkerVersion: (meta.chunker_version as string | null) ?? null,
      approvedAt: (meta.approved_at as string | null) ?? null,
      withdrawnAt: (meta.withdrawn_at as string | null) ?? null,
      withdrawalReason: (meta.withdrawal_reason as string | null) ?? null,
    },
  };
}

export interface EmbeddingSettings {
  models: { id: string; label: string; dimensions: number; status: string; activatedAt: string | null; embeddings: number }[];
  publishedChunks: number;
}

/** Systemindstillinger → Embedding (read only, system.settings.manage via RLS). */
export async function embeddingSettings(): Promise<EmbeddingSettings> {
  const db = await knowledge();
  const { data: models } = await db.from("embedding_models").select("id, provider, model_name, model_version, dimensions, status, activated_at").order("created_at");
  const rows = (models ?? []) as { id: string; provider: string; model_name: string; model_version: string; dimensions: number; status: string; activated_at: string | null }[];
  const counts = await Promise.all(
    rows.map(async (model) => (await db.from("chunk_embeddings").select("chunk_id", { count: "exact", head: true }).eq("embedding_model_id", model.id)).count ?? 0),
  );
  const { data: published } = await db.from("document_versions").select("id").eq("status", "published");
  const ids = ((published ?? []) as { id: string }[]).map((row) => row.id);
  const publishedChunks = ids.length
    ? ((await db.from("document_chunks").select("id", { count: "exact", head: true }).in("document_version_id", ids)).count ?? 0)
    : 0;
  return {
    models: rows.map((model, i) => ({
      id: model.id,
      label: `${model.provider}:${model.model_name}@${model.model_version}`,
      dimensions: model.dimensions,
      status: model.status,
      activatedAt: model.activated_at,
      embeddings: counts[i] ?? 0,
    })),
    publishedChunks,
  };
}
