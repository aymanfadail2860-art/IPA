#!/usr/bin/env node
/**
 * ⚠ DEVELOPMENT SEED — LOCAL SUPABASE ONLY.
 *
 * Creates clearly fictional test users, teams, leader scopes, cases and knowledge products so
 * access control can be tested (docs/06 §10, docs/07 §15). Idempotent.
 *
 * Refuses to run against anything but a local Supabase (localhost / 127.0.0.1).
 * No password is stored in the repository: the shared test password comes from
 * IPA_DEV_SEED_PASSWORD.
 *
 * Required environment (e.g. from .env.local):
 *   NEXT_PUBLIC_SUPABASE_URL      local API URL, e.g. http://127.0.0.1:54321
 *   SUPABASE_SERVICE_ROLE_KEY     local service-role key (from `npx supabase status`)
 *   IPA_DEV_SEED_PASSWORD         password for all test users (min. 12 characters)
 */
import { createClient } from "@supabase/supabase-js";

import { SEED_CASES, SEED_PRODUCTS, SEED_TEAMS, SEED_USERS } from "./seed-fixtures.mjs";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const password = process.env.IPA_DEV_SEED_PASSWORD;

function fail(message) {
  console.error(`seed-dev: ${message}`);
  process.exit(1);
}

if (!url || !serviceRoleKey) fail("NEXT_PUBLIC_SUPABASE_URL og SUPABASE_SERVICE_ROLE_KEY skal være sat.");
if (!password || password.length < 12) fail("IPA_DEV_SEED_PASSWORD skal være sat og mindst 12 tegn.");
const host = new URL(url).hostname;
if (!["localhost", "127.0.0.1"].includes(host)) {
  fail(`nægter at seede ${host}. Development-seed må kun køre mod en lokal Supabase.`);
}

const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
const identity = admin.schema("identity");
const advise = admin.schema("advise");
const knowledge = admin.schema("knowledge");

async function check(promise, what) {
  const { data, error } = await promise;
  if (error) fail(`${what}: ${error.message}`);
  return data;
}

async function findAuthUser(email) {
  for (let page = 1; page < 50; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) fail(`listUsers: ${error.message}`);
    const hit = data.users.find((user) => user.email === email);
    if (hit) return hit;
    if (data.users.length < 200) return null;
  }
  return null;
}

// Teams — parents first.
for (const team of SEED_TEAMS) {
  await check(identity.from("teams").upsert({ id: team.id, name: team.name, parent_team_id: team.parentId ?? null }), `team ${team.name}`);
}

const roles = await check(identity.from("roles").select("id, key"), "roles");
const roleId = Object.fromEntries(roles.map((role) => [role.key, role.id]));

const userIds = {};
for (const user of SEED_USERS) {
  let authUser = await findAuthUser(user.email);
  if (!authUser) {
    const { data, error } = await admin.auth.admin.createUser({
      email: user.email,
      password,
      email_confirm: true,
      user_metadata: { display_name: user.displayName, job_title: user.jobTitle },
    });
    if (error) fail(`createUser ${user.email}: ${error.message}`);
    authUser = data.user;
  } else {
    await check(admin.auth.admin.updateUserById(authUser.id, { password }), `update password ${user.email}`);
  }
  const profile = await check(identity.from("users").select("id").eq("auth_id", authUser.id).single(), `profile ${user.email}`);
  userIds[user.key] = profile.id;
  await check(
    identity.from("users").update({ display_name: user.displayName, job_title: user.jobTitle, status: "active" }).eq("id", profile.id),
    `update profile ${user.email}`,
  );

  for (const role of user.roles) {
    await check(identity.from("user_roles").upsert({ user_id: profile.id, role_id: roleId[role] }, { ignoreDuplicates: true }), `role ${role}`);
  }
  for (const teamId of user.teams) {
    await check(identity.from("team_memberships").upsert({ user_id: profile.id, team_id: teamId }, { ignoreDuplicates: true }), "membership");
  }
  for (const scope of user.leaderScopes ?? []) {
    await check(
      identity.from("leader_scopes").upsert({ user_id: profile.id, team_id: scope.teamId, include_descendants: scope.includeDescendants }),
      "leader scope",
    );
  }
}

for (const entry of SEED_CASES) {
  const existing = await check(advise.from("customer_cases").select("id").eq("id", entry.id), "case lookup");
  if (existing.length === 0) {
    await check(
      advise.from("customer_cases").insert({ id: entry.id, company_name: entry.companyName, status: entry.status, owner_id: userIds[entry.owner] }),
      `case ${entry.companyName}`,
    );
  }
  for (const share of entry.shares ?? []) {
    await check(
      advise.from("case_participants").upsert(
        { case_id: entry.id, user_id: userIds[share.user], access_type: share.access, granted_by: userIds[entry.owner] },
        { ignoreDuplicates: true },
      ),
      "case share",
    );
  }
}

for (const product of SEED_PRODUCTS) {
  await check(
    knowledge.from("products").upsert({ id: product.id, name: product.name, category: product.category, status: "active" }),
    `product ${product.name}`,
  );
}

// ⚠ MOCK: the test embedder (development grade, src/lib/knowledge/core/test-embedder.ts) is the
// active model locally. Its row exists only here — never in a migration — and the database
// refuses to activate it through knowledge.activate_embedding_model, so only this seed does.
const TEST_EMBEDDING_MODEL_ID = "00000000-0000-4000-b000-000000000001";
await check(
  knowledge.from("embedding_models").upsert(
    { id: TEST_EMBEDDING_MODEL_ID, provider: "test", model_name: "test-hash-embedder", model_version: "1", dimensions: 256 },
    { onConflict: "id", ignoreDuplicates: true },
  ),
  "test embedder model",
);
const activeModels = await check(knowledge.from("embedding_models").select("id").eq("status", "active"), "embedding models");
if (activeModels.length === 0) {
  await check(
    knowledge.from("embedding_models").update({ status: "active", activated_at: new Date().toISOString() }).eq("id", TEST_EMBEDDING_MODEL_ID),
    "activate test embedder",
  );
}

console.log("seed-dev: færdig. Testbrugere:");
for (const user of SEED_USERS) console.log(`  ${user.email.padEnd(28)} ${user.displayName}`);
