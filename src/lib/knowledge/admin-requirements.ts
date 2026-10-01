import type { PermissionRequirement } from "@/lib/auth/permissions";

/** Permission requirements of the Knowledge administration (docs/07 §12). */
export const KNOWLEDGE_MANAGER: PermissionRequirement = { anyOf: ["knowledge.document.write", "knowledge.version.publish"] };
export const KNOWLEDGE_WRITE: PermissionRequirement = { allOf: ["knowledge.document.write"] };
export const KNOWLEDGE_PUBLISH: PermissionRequirement = { allOf: ["knowledge.version.publish"] };
export const SETTINGS_MANAGE: PermissionRequirement = { allOf: ["system.settings.manage"] };
