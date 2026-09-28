import {
  BadgeCheck,
  CircleCheck,
  CircleDot,
  CircleX,
  GitCompare,
  History,
  Info,
  NotebookPen,
  SearchX,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";

/**
 * Status system (docs/04-ui-ux-design.md §3.3, §3.5, §20).
 *
 * Every status is a fixed trio: colour + icon + text label. Colour never carries meaning
 * alone. The seven knowledge statuses look the same everywhere in the product, so a user
 * who has learned what an AI suggestion looks like in Advise recognises it in Learn.
 *
 * Class names are written out in full so Tailwind can find them at build time.
 */

export type KnowledgeStatus =
  | "authoritative"
  | "historical"
  | "conflict"
  | "insufficient"
  | "aiSuggestion"
  | "validated"
  | "workingNote";

export type FeedbackStatus = "success" | "warning" | "error" | "info" | "neutral";

export type Status = KnowledgeStatus | FeedbackStatus;

export interface StatusDefinition {
  /** Short Danish label shown in badges. */
  label: string;
  /** Longer Danish description, used for accessible text and legends. */
  description: string;
  icon: LucideIcon;
  /** Foreground colour (icon + text). */
  textClass: string;
  /** Subtle background tint. */
  subtleClass: string;
  /** Border colour in the status colour. */
  borderClass: string;
  /** Left-edge border colour, used by status-bearing cards and callouts. */
  edgeClass: string;
}

export const KNOWLEDGE_STATUSES: Record<KnowledgeStatus, StatusDefinition> = {
  authoritative: {
    label: "Gældende",
    description: "Gældende, fagligt godkendt viden",
    icon: ShieldCheck,
    textClass: "text-knowledge-authoritative",
    subtleClass: "bg-knowledge-authoritative-subtle",
    borderClass: "border-knowledge-authoritative",
    edgeClass: "border-l-knowledge-authoritative",
  },
  historical: {
    label: "Historisk",
    description: "Historisk viden — ikke længere gældende",
    icon: History,
    textClass: "text-knowledge-historical",
    subtleClass: "bg-knowledge-historical-subtle",
    borderClass: "border-knowledge-historical",
    edgeClass: "border-l-knowledge-historical",
  },
  conflict: {
    label: "Konflikt mellem kilder",
    description: "Kilderne modsiger hinanden. Konflikten afgøres ikke automatisk",
    icon: GitCompare,
    textClass: "text-knowledge-conflict",
    subtleClass: "bg-knowledge-conflict-subtle",
    borderClass: "border-knowledge-conflict",
    edgeClass: "border-l-knowledge-conflict",
  },
  insufficient: {
    label: "Utilstrækkeligt grundlag",
    description: "Der findes ikke tilstrækkelig dokumentation i vidensgrundlaget",
    icon: SearchX,
    textClass: "text-knowledge-insufficient",
    subtleClass: "bg-knowledge-insufficient-subtle",
    borderClass: "border-knowledge-insufficient",
    edgeClass: "border-l-knowledge-insufficient",
  },
  aiSuggestion: {
    label: "AI-forslag",
    description: "AI-forslag, ikke vurderet",
    icon: Sparkles,
    textClass: "text-ai-suggestion",
    subtleClass: "bg-ai-suggestion-subtle",
    borderClass: "border-ai-suggestion",
    edgeClass: "border-l-ai-suggestion",
  },
  validated: {
    label: "Valideret konklusion",
    description: "Konklusion tiltrådt af en rådgiver",
    icon: BadgeCheck,
    textClass: "text-ai-validated",
    subtleClass: "bg-ai-validated-subtle",
    borderClass: "border-ai-validated",
    edgeClass: "border-l-ai-validated",
  },
  workingNote: {
    label: "Arbejdsnote",
    description: "Rådgiverens egen arbejdsnote — ikke en del af den autoritative sag",
    icon: NotebookPen,
    textClass: "text-note-personal",
    subtleClass: "bg-note-personal-subtle",
    borderClass: "border-note-personal",
    edgeClass: "border-l-note-personal",
  },
};

export const FEEDBACK_STATUSES: Record<FeedbackStatus, StatusDefinition> = {
  success: {
    label: "Gennemført",
    description: "Gennemført",
    icon: CircleCheck,
    textClass: "text-success",
    subtleClass: "bg-success-subtle",
    borderClass: "border-success",
    edgeClass: "border-l-success",
  },
  warning: {
    label: "Advarsel",
    description: "Kræver opmærksomhed",
    icon: TriangleAlert,
    textClass: "text-warning",
    subtleClass: "bg-warning-subtle",
    borderClass: "border-warning",
    edgeClass: "border-l-warning",
  },
  error: {
    label: "Fejl",
    description: "Fejl",
    icon: CircleX,
    textClass: "text-error",
    subtleClass: "bg-error-subtle",
    borderClass: "border-error",
    edgeClass: "border-l-error",
  },
  info: {
    label: "Information",
    description: "Information",
    icon: Info,
    textClass: "text-info",
    subtleClass: "bg-info-subtle",
    borderClass: "border-info",
    edgeClass: "border-l-info",
  },
  neutral: {
    label: "Status",
    description: "Status",
    icon: CircleDot,
    textClass: "text-fg-secondary",
    subtleClass: "bg-surface-sunken",
    borderClass: "border-border-strong",
    edgeClass: "border-l-border-strong",
  },
};

export const STATUSES: Record<Status, StatusDefinition> = {
  ...KNOWLEDGE_STATUSES,
  ...FEEDBACK_STATUSES,
};

export function getStatus(status: Status): StatusDefinition {
  return STATUSES[status];
}
