/**
 * ⚠ MOCK DATA — DEVELOPMENT ONLY. The phase 5 admin mock rows mapped onto the Knowledge
 * Engine view models, for the temporary demo without a database (decision B-003). Never used
 * while a database is connected. Must never be used as or mixed with production data.
 */
import type { AdminConflict, AdminProduct, AdminVersionRow, CoverageRow, VersionStatus } from "@/lib/knowledge/admin-types";
import type { PipelineStage } from "@/types/domain";

import { mockAdminDocuments, mockAdminProducts, mockDocumentConflicts } from "./admin";

const STAGE_TO_STATUS: Record<PipelineStage, VersionStatus> = {
  uploaded: "uploaded",
  processing: "processing",
  readyForReview: "processed",
  approved: "published",
  active: "published",
  failed: "processing_failed",
  partial: "processed",
};

const TYPE_TO_KEY: Record<string, string> = {
  Forsikringsbetingelser: "terms",
  Produktvejledning: "guidance",
  Acceptregler: "acceptance_rules",
  Forretningsgang: "business_procedure",
  Salgsmateriale: "sales_material",
};

export function demoKnowledgeVersions(): AdminVersionRow[] {
  return mockAdminDocuments.map((document) => ({
    id: `demo-${document.id}`,
    documentId: `demo-doc-${document.title}`,
    documentTitle: document.title,
    productName: document.product,
    documentType: TYPE_TO_KEY[document.type] ?? "internal_document",
    versionLabel: document.version,
    language: "da",
    status: STAGE_TO_STATUS[document.stage],
    validFrom: document.validFrom ?? null,
    validTo: null,
    supersededBy: null,
    uploadedAt: document.updatedAt,
    updatedAt: document.updatedAt,
    errorMessage: document.stage === "failed" ? (document.detail ?? null) : null,
    documentHasGap: false,
  }));
}

export function demoKnowledgeProducts(): AdminProduct[] {
  return mockAdminProducts.map((product) => ({
    id: `demo-${product.id}`,
    name: product.name,
    category: product.category,
    status: product.status === "Aktiv" ? "active" : "retired",
    documentCount: product.documents,
  }));
}

export function demoKnowledgeConflicts(): AdminConflict[] {
  return mockDocumentConflicts.map((conflict) => ({
    id: `demo-${conflict.id}`,
    status: "open",
    detectedBy: "user",
    rule: "manual",
    description: conflict.topic,
    createdAt: conflict.reportedAt,
    resolvedAt: null,
    resolutionNote: null,
    passages: [conflict.left, conflict.right].map((text, i) => ({
      side: i === 0 ? ("A" as const) : ("B" as const),
      versionId: `demo-${conflict.id}-${i}`,
      documentId: `demo-${conflict.id}-${i}`,
      documentTitle: text.split(" · ")[0] ?? text,
      versionLabel: null,
      versionStatus: "published" as const,
      chunk: { id: `demo-${conflict.id}-${i}`, text, heading: null, pageStart: 1, pageEnd: 1 },
    })),
  }));
}

export function demoKnowledgeCoverage(): CoverageRow[] {
  return mockAdminProducts.map((product) => ({
    productId: `demo-${product.id}`,
    productName: product.name,
    publishedByType: Object.fromEntries(
      mockAdminDocuments
        .filter((document) => document.product === product.name && (document.stage === "active" || document.stage === "approved"))
        .map((document) => [TYPE_TO_KEY[document.type] ?? "internal_document", 1]),
    ),
  }));
}
