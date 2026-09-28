/**
 * ⚠ MOCK DATA — DEVELOPMENT ONLY. Fictional people and permission sets used by the
 * development-only role switcher (src/dev/). Not authentication, not authorization.
 * Must never be used as or mixed with production data.
 */
import type { PermissionGrant } from "@/lib/auth/permissions";
import type { Session } from "@/lib/auth/session";

export type MockRoleId = "advisor" | "leader" | "administrator";

export const MOCK_ROLE_LABELS: Record<MockRoleId, string> = {
  advisor: "Rådgiver",
  leader: "Leder",
  administrator: "Administrator",
};

/*
 * Grants follow the example table in docs/03-technical-architecture.md §10.
 * Administrator's Analytics access is "efter rettigheder" in the spec; the mock gives it
 * `analytics.team.read` with scope `all` so the screen can be evaluated.
 */
const advisorGrants: PermissionGrant[] = [
  { key: "learning.progress.read", scope: "own" },
  { key: "practice.session.write", scope: "own" },
  { key: "assessment.result.read", scope: "own" },
  { key: "advise.case.read", scope: "own" },
  { key: "advise.case.write", scope: "own" },
  { key: "knowledge.document.read", scope: "own" },
];

const leaderGrants: PermissionGrant[] = [
  ...advisorGrants,
  { key: "learning.progress.read", scope: "team" },
  { key: "assessment.result.read", scope: "team" },
  { key: "analytics.team.read", scope: "team" },
];

const administratorGrants: PermissionGrant[] = [
  { key: "learning.progress.read", scope: "own" },
  { key: "practice.session.write", scope: "own" },
  { key: "assessment.result.read", scope: "own" },
  // Case access is per case for every role (docs/03 §10, corrected — see docs/decisions.md).
  { key: "advise.case.read", scope: "own" },
  { key: "advise.case.write", scope: "own" },
  { key: "analytics.team.read", scope: "all" },
  { key: "knowledge.document.read", scope: "all" },
  { key: "knowledge.document.read_historical", scope: "all" },
  { key: "knowledge.document.write", scope: "all" },
  { key: "knowledge.version.publish", scope: "all" },
  { key: "identity.user.manage", scope: "all" },
  { key: "system.settings.manage", scope: "all" },
];

export const MOCK_SESSIONS: Record<MockRoleId, Session> = {
  advisor: {
    user: {
      id: "mock-user-mikkel",
      name: "Mikkel Sørensen",
      firstName: "Mikkel",
      initials: "MS",
      title: "Erhvervsrådgiver",
      teamName: "Erhverv Nord",
    },
    grants: advisorGrants,
  },
  leader: {
    user: {
      id: "mock-user-anne",
      name: "Anne Holm",
      firstName: "Anne",
      initials: "AH",
      title: "Teamleder",
      teamName: "Erhverv Nord",
    },
    grants: leaderGrants,
  },
  administrator: {
    user: {
      id: "mock-user-jonas",
      name: "Jonas Kjær",
      firstName: "Jonas",
      initials: "JK",
      title: "Fagligt ansvarlig",
      teamName: "Produkt og viden",
    },
    grants: administratorGrants,
  },
};

/** The leader shown in the adviser's "Synlighed" tab. */
export const MOCK_ADVISOR_LEADER = { name: "Anne Holm", team: "Erhverv Nord" };
