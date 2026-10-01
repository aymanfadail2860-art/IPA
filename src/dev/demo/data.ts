import "server-only";

/**
 * Demo data access for the temporary demo without login (decision B-003). The only place
 * outside pages that reads @/mocks — application code calls these functions solely behind
 * `isDemoMode()`, which is never true while a database is connected.
 */
export {
  demoAdminTeams,
  demoAdminUsers,
  demoCases,
  demoEmployeesInScope,
  demoRoleMatrix,
  demoScopedTeams,
  demoSession,
  demoVisibility,
} from "@/mocks/demo";
export { demoKnowledgeConflicts, demoKnowledgeCoverage, demoKnowledgeProducts, demoKnowledgeVersions } from "@/mocks/demo-knowledge";
