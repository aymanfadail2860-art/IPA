import type { AssessmentStatus, CaseStatus, DevicePolicy, LearningStatus, PipelineStage } from "@/types/domain";

import type { Status } from "./status";

/**
 * Domain statuses mapped onto the shared status system — so a case status, a pipeline
 * stage or a learning status is always colour + icon + text as well.
 */
export const CASE_STATUS: Record<CaseStatus, { label: string; status: Status }> = {
  draft: { label: "Kladde", status: "neutral" },
  active: { label: "Aktiv", status: "info" },
  awaitingCustomer: { label: "Afventer kunde", status: "warning" },
  closed: { label: "Afsluttet", status: "success" },
};

export const LEARNING_STATUS: Record<LearningStatus, { label: string; status: Status }> = {
  notStarted: { label: "Ikke påbegyndt", status: "neutral" },
  inProgress: { label: "I gang", status: "info" },
  completed: { label: "Gennemført", status: "success" },
};

export const ASSESSMENT_STATUS: Record<AssessmentStatus, { label: string; status: Status }> = {
  available: { label: "Klar til at tage", status: "info" },
  locked: { label: "Kræver forudsætning", status: "neutral" },
  passed: { label: "Bestået", status: "success" },
  failed: { label: "Ikke bestået", status: "error" },
};

export const DEVICE_POLICY: Record<DevicePolicy, string> = {
  mobileAllowed: "Kan tages på alle enheder",
  desktopRecommended: "Desktop anbefales",
  desktopRequired: "Kræver desktop",
};

export const PIPELINE_STAGE: Record<PipelineStage, { label: string; status: Status }> = {
  uploaded: { label: "Uploadet", status: "neutral" },
  processing: { label: "Behandles", status: "info" },
  readyForReview: { label: "Klar til review", status: "warning" },
  approved: { label: "Godkendt", status: "authoritative" },
  active: { label: "Aktiv", status: "authoritative" },
  failed: { label: "Kunne ikke læses", status: "error" },
  partial: { label: "Delvist behandlet", status: "warning" },
};
