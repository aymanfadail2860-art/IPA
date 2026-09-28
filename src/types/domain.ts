/**
 * View models the UI renders. They describe what a screen needs, not how data is stored —
 * the storage model lives in docs/03-technical-architecture.md §4 and is built later.
 *
 * In phase 5 every value of these types comes from `src/mocks/`.
 */

/** ISO 8601 date (YYYY-MM-DD) or date-time. */
export type IsoDate = string;

/* ── Knowledge and sources ─────────────────────────────────────────────── */

export type SourceValidity = "current" | "historical" | "deactivated";

export interface SourceReference {
  id: string;
  /** Number shown in the answer's inline marker, e.g. [1]. */
  number: number;
  documentTitle: string;
  version: string;
  section: string;
  page?: number;
  excerpt: string;
  validity: SourceValidity;
  validFrom: IsoDate;
  validTo?: IsoDate;
  /** Number of the source this one contradicts, when the answer is a conflict answer. */
  conflictsWith?: number;
}

/* ── Copilot ───────────────────────────────────────────────────────────── */

export type AnswerSegment = string | { source: number };
export type AnswerParagraph = readonly AnswerSegment[];

export type AnswerKind = "complete" | "conflict" | "insufficient" | "historical";

export interface CopilotExchange {
  id: string;
  question: string;
  kind: AnswerKind;
  paragraphs: readonly AnswerParagraph[];
  sources: readonly SourceReference[];
  followUps: readonly string[];
  /** Only for historical answers: the date the answer is valid for. */
  historicalAsOf?: IsoDate;
  /** Retrieval summary shown in the completed retrieval steps. */
  retrieval: { passages: number; documents: number };
}

export type ConversationGroup = "today" | "earlier" | "cases";

export interface CopilotConversation {
  id: string;
  title: string;
  group: ConversationGroup;
  /** Customer case the conversation was held in (only for group "cases"). */
  caseName?: string;
  context?: string;
  updatedAt: IsoDate;
  exchanges: readonly CopilotExchange[];
}

/* ── Learn ─────────────────────────────────────────────────────────────── */

export type LearningStatus = "notStarted" | "inProgress" | "completed";

export type ProductCategory = "Ansvar" | "Ting" | "Person" | "Særlige risici";

export interface Product {
  slug: string;
  name: string;
  category: ProductCategory;
  summary: string;
  status: LearningStatus;
  /** 1-based module number the user is in, when in progress. */
  currentModule?: number;
  /** Set when the product's authoritative basis changed since the user's last visit. */
  changeNotice?: string;
}

export interface CourseModule {
  number: number;
  slug: string;
  title: string;
  status: LearningStatus;
  lessonCount: number;
  completedLessons: number;
}

export type CalloutVariant = "important" | "exception" | "example" | "commonMistake";

export type LessonBlock =
  | { type: "paragraph"; text: string }
  | { type: "heading"; id: string; text: string }
  | { type: "callout"; variant: CalloutVariant; title: string; text: string };

export interface Lesson {
  productSlug: string;
  moduleSlug: string;
  moduleNumber: number;
  moduleTitle: string;
  lessonNumber: number;
  lessonCount: number;
  title: string;
  blocks: readonly LessonBlock[];
  sources: readonly SourceReference[];
  lessons: readonly { number: number; title: string; status: LearningStatus }[];
}

/* ── Practice ──────────────────────────────────────────────────────────── */

export interface TrainingForm {
  id: string;
  name: string;
  trains: string;
  lastActivity?: string;
  /** AI roleplay disables Copilot during the session. */
  copilotLockedDuringSession?: boolean;
}

export interface TrainingSessionSummary {
  id: string;
  form: string;
  product: string;
  completedAt: IsoDate;
  summary: string;
}

/* ── Advise ────────────────────────────────────────────────────────────── */

export type CaseStatus = "draft" | "active" | "awaitingCustomer" | "closed";

export type WorkAreaState = "notStarted" | "inProgress" | "complete" | "attention";

export interface WorkArea {
  id: string;
  name: string;
  state: WorkAreaState;
  openItems?: number;
}

export interface CaseParticipant {
  /** User id — case access is granted per case through participants (docs/03 §10). */
  userId: string;
  name: string;
  initials: string;
  access: "Ejer" | "Kan redigere" | "Kan læse" | "Reviewer";
}

export interface QualitySignal {
  id: string;
  tone: "warning" | "info";
  title: string;
  detail: string;
  actionLabel: string;
  targetAreaId?: string;
}

export interface CaseContentItem {
  id: string;
  title: string;
  text: string;
  sources?: readonly SourceReference[];
  validatedBy?: string;
  validatedAt?: IsoDate;
}

export interface CustomerCase {
  id: string;
  companyName: string;
  industry: string;
  employees: string;
  status: CaseStatus;
  currentAreaId: string;
  owner: CaseParticipant;
  participants: readonly CaseParticipant[];
  updatedAt: IsoDate;
  workAreas: readonly WorkArea[];
  signals: readonly QualitySignal[];
  facts: readonly { label: string; value: string }[];
  conclusions: readonly CaseContentItem[];
  /** Suggestions returned when the adviser explicitly asks for them (on demand). */
  onDemandSuggestions: readonly CaseContentItem[];
  note: string;
  sourceDocuments: number;
  history: readonly { at: IsoDate; text: string }[];
}

/* ── Assessment ────────────────────────────────────────────────────────── */

export type DevicePolicy = "mobileAllowed" | "desktopRecommended" | "desktopRequired";

export type AssessmentStatus = "available" | "locked" | "passed" | "failed";

export interface AssessmentItem {
  id: string;
  title: string;
  product: string;
  type: "test" | "case";
  durationMinutes: number;
  timeLimited: boolean;
  questions?: number;
  status: AssessmentStatus;
  devicePolicy: DevicePolicy;
  prerequisite?: string;
  result?: { score: string; completedAt: IsoDate };
}

/* ── Competencies, profile and analytics ───────────────────────────────── */

export type CompetencyLevel = 1 | 2 | 3 | 4;

export interface Competency {
  id: string;
  name: string;
  level: CompetencyLevel;
  target: CompetencyLevel;
  basis: string;
}

export interface HistoryEntry {
  id: string;
  at: IsoDate;
  kind: "learn" | "practice" | "assessment";
  title: string;
  detail: string;
}

export interface TeamMemberRow {
  id: string;
  name: string;
  initials: string;
  learningPercent: number;
  assessments: string;
  competenciesBelowTarget: number;
  lastActive: IsoDate;
}

/* ── Admin ─────────────────────────────────────────────────────────────── */

export type PipelineStage =
  | "uploaded"
  | "processing"
  | "readyForReview"
  | "approved"
  | "active"
  | "failed"
  | "partial";

export interface AdminDocument {
  id: string;
  title: string;
  product: string;
  type: string;
  version: string;
  stage: PipelineStage;
  validFrom?: IsoDate;
  updatedAt: IsoDate;
  detail?: string;
}

export interface KnowledgeGap {
  id: string;
  question: string;
  product: string;
  occurrences: number;
  lastSeen: IsoDate;
}

/* ── Customer case summary (from the database, phase 6) ───────────────── */

/** A case as the access-control foundation knows it: identity, status and participants. */
export interface CaseSummary {
  id: string;
  companyName: string;
  status: CaseStatus;
  updatedAt: IsoDate;
  participants: readonly CaseParticipant[];
}

/* ── Identity (from the database, phase 6) ──────────────────────────────── */

export interface TeamNode {
  id: string;
  name: string;
  parentId: string | null;
}

export interface ScopedEmployee {
  id: string;
  name: string;
  initials: string;
  teams: readonly string[];
}

/**
 * The content of a case's work areas (profile, analyses, AI suggestions, notes). Built in a
 * later phase; phase 6 only has the access-control foundation for cases.
 */
export type CaseWorkspaceContent = Omit<CustomerCase, "id" | "companyName" | "status" | "owner" | "participants" | "updatedAt">;
