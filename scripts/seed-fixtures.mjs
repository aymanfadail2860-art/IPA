/**
 * ⚠ DEVELOPMENT FIXTURES — fictional test identities for the local seed and the
 * access-control integration tests. Obviously not real people or customers
 * (".test" domain, "Test …" names, "Testvirksomhed …").
 *
 * Structure (docs/06 §10):
 *
 *   Testafdeling Erhverv
 *   ├── Testteam Nord                 ← Test Leder Nord (scope inkl. underteams)
 *   │   └── Testteam Nord · Hold A
 *   └── Testteam Syd                  ← Test Leder Syd (begrænset: kun Syd, ikke underteams)
 *       └── Testteam Syd · Hold B
 *   Testafdeling Produkt
 */

export const SEED_TEAM_IDS = {
  erhverv: "00000000-0000-4000-a000-000000000101",
  nord: "00000000-0000-4000-a000-000000000102",
  nordA: "00000000-0000-4000-a000-000000000103",
  syd: "00000000-0000-4000-a000-000000000104",
  produkt: "00000000-0000-4000-a000-000000000105",
  sydB: "00000000-0000-4000-a000-000000000106",
};

export const SEED_TEAMS = [
  { id: SEED_TEAM_IDS.erhverv, name: "Testafdeling Erhverv" },
  { id: SEED_TEAM_IDS.produkt, name: "Testafdeling Produkt" },
  { id: SEED_TEAM_IDS.nord, name: "Testteam Nord", parentId: SEED_TEAM_IDS.erhverv },
  { id: SEED_TEAM_IDS.syd, name: "Testteam Syd", parentId: SEED_TEAM_IDS.erhverv },
  { id: SEED_TEAM_IDS.nordA, name: "Testteam Nord · Hold A", parentId: SEED_TEAM_IDS.nord },
  { id: SEED_TEAM_IDS.sydB, name: "Testteam Syd · Hold B", parentId: SEED_TEAM_IDS.syd },
];

export const SEED_USERS = [
  {
    key: "advisorA",
    email: "raadgiver.a@ipa.test",
    displayName: "Test Rådgiver A",
    jobTitle: "Erhvervsrådgiver (test)",
    roles: ["advisor"],
    // Flere teammedlemskaber: Hold A (under Nord) og Syd.
    teams: [SEED_TEAM_IDS.nordA, SEED_TEAM_IDS.syd],
  },
  {
    key: "advisorB",
    email: "raadgiver.b@ipa.test",
    displayName: "Test Rådgiver B",
    jobTitle: "Erhvervsrådgiver (test)",
    roles: ["advisor"],
    teams: [SEED_TEAM_IDS.syd],
  },
  {
    key: "advisorC",
    email: "raadgiver.c@ipa.test",
    displayName: "Test Rådgiver C",
    jobTitle: "Erhvervsrådgiver (test)",
    roles: ["advisor"],
    // Nord og et underteam under Syd, som Test Leder Syd IKKE har scope til.
    teams: [SEED_TEAM_IDS.nord, SEED_TEAM_IDS.sydB],
  },
  {
    key: "leaderNord",
    email: "leder.nord@ipa.test",
    displayName: "Test Leder Nord",
    jobTitle: "Teamleder (test)",
    roles: ["advisor", "leader"],
    teams: [SEED_TEAM_IDS.nord],
    leaderScopes: [{ teamId: SEED_TEAM_IDS.nord, includeDescendants: true }],
  },
  {
    key: "leaderSyd",
    email: "leder.syd@ipa.test",
    displayName: "Test Leder Syd",
    jobTitle: "Teamleder (test)",
    roles: ["advisor", "leader"],
    teams: [SEED_TEAM_IDS.syd],
    // Begrænset scope: kun Syd, ingen underteams.
    leaderScopes: [{ teamId: SEED_TEAM_IDS.syd, includeDescendants: false }],
  },
  {
    key: "admin",
    email: "admin@ipa.test",
    displayName: "Test Administrator",
    jobTitle: "Fagligt ansvarlig (test)",
    roles: ["administrator"],
    teams: [SEED_TEAM_IDS.produkt],
  },
];

export const SEED_CASE_IDS = {
  alfa: "00000000-0000-4000-a000-000000000201",
  beta: "00000000-0000-4000-a000-000000000202",
  gamma: "00000000-0000-4000-a000-000000000203",
};

export const SEED_CASES = [
  {
    id: SEED_CASE_IDS.alfa,
    companyName: "Testvirksomhed Alfa ApS",
    status: "active",
    owner: "advisorA",
    shares: [{ user: "advisorB", access: "viewer" }],
  },
  { id: SEED_CASE_IDS.beta, companyName: "Testvirksomhed Beta ApS", status: "awaiting_customer", owner: "advisorB" },
  {
    id: SEED_CASE_IDS.gamma,
    companyName: "Testvirksomhed Gamma A/S",
    status: "draft",
    owner: "admin",
    shares: [{ user: "advisorA", access: "editor" }],
  },
];
