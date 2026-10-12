import { runtimeEnv } from "../core/grade.ts";
import { ProviderError } from "../core/provider.ts";

/**
 * AWS credentials, explicitly per runtime (docs/08b D-10, D-11; 8B-I8 C1 and C7). There is no
 * general credential chain in production: each runtime has exactly one federated, short-lived
 * path, and anything else fails closed.
 *
 *   application (Vercel)     Vercel OIDC → AWS STS AssumeRoleWithWebIdentity → temporary credentials
 *   worker (ECS/Fargate)     the ECS task role through the container credential endpoint
 *                            (also the evaluation environment's worker)
 *   evaluation (GitHub CI)   GitHub OIDC → configure-aws-credentials → temporary credentials in the
 *                            job's environment (with a session token)
 *   local/test               the SDK's default chain, or a fake transport in tests
 *
 * No static access key, secret key, credentials file or implicit environment fallback in a
 * production runtime. Only non-sensitive configuration (the role ARN, the audience) comes from
 * the environment. Errors name variables, never values.
 *
 * This module holds only the rules. Each runtime passes the ONE credential source it has
 * (credentials-vercel.ts in the app, credentials-container.ts in the worker,
 * credentials-environment.ts in the evaluation CLI), so no runtime ships another runtime's
 * mechanism — and a runtime without its source fails closed.
 */

import type { AwsCredentials } from "./bedrock/sdk-transport.ts";

export type { AwsCredentials };
export type ProviderEntry = "application" | "worker" | "evaluation";
export type AwsCredentialSource = "vercel-oidc" | "ecs-task-role" | "github-oidc" | "development-default-chain";

export interface AwsCredentialPlan {
  source: AwsCredentialSource;
  /** Undefined only for the development default chain (local/test). */
  credentials: AwsCredentials | undefined;
}

export interface VercelOidcInit {
  roleArn: string;
  audience: string;
  roleSessionName: string;
}

/** The credential source a runtime ships. Exactly the one its entry needs is passed. */
export interface AwsCredentialSources {
  vercelOidc?: (init: VercelOidcInit) => AwsCredentials;
  containerTaskRole?: () => AwsCredentials;
  federatedEnvironment?: () => AwsCredentials;
}

/** The AWS-specific audience for the exchanged Vercel token (configurable when the trust policy differs). */
export const DEFAULT_VERCEL_OIDC_AUDIENCE = "sts.amazonaws.com";

const STATIC_KEYS = ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN"] as const;
const IMPLICIT_SOURCES = ["AWS_PROFILE", "AWS_SHARED_CREDENTIALS_FILE", "AWS_CONFIG_FILE", "AWS_WEB_IDENTITY_TOKEN_FILE", "AWS_ROLE_ARN"] as const;
const ROLE_ARN = /^arn:aws:iam::\d{12}:role\/[A-Za-z0-9+=,.@_\/-]{1,512}$/;

function refuse(message: string): never {
  throw new ProviderError("credentials", "aws", message);
}

function refusePresent(env: Record<string, string | undefined>, names: readonly string[], runtime: string): void {
  const present = names.filter((name) => (env[name] ?? "") !== "");
  if (present.length > 0) refuse(`${runtime}: ${present.join(", ")} må ikke være sat. AWS-adgangen er federeret og kortlivet (ingen statiske nøgler, filer eller fallback).`);
}

/**
 * The one credential path of a runtime. Constructing the plan makes no network call; the
 * credentials are resolved by the SDK at the first request (and refreshed by it).
 */
export function credentialPlanFor(entry: ProviderEntry, env: Record<string, string | undefined>, sources: AwsCredentialSources): AwsCredentialPlan {
  // The passed environment is authoritative: a missing IPA_RUNTIME_ENV is production (never the
  // process's own value through runtimeEnv's default).
  const environment = runtimeEnv(env.IPA_RUNTIME_ENV ?? "");
  if (environment === "local" || environment === "test") return { source: "development-default-chain", credentials: undefined };

  switch (entry) {
    case "application": {
      // Vercel production: only the Vercel OIDC federation. Never a key in Vercel's environment.
      if (env.VERCEL !== "1") refuse("Appen kører i produktion uden for Vercel. Der er ingen godkendt AWS-credential-vej (D-11).");
      refusePresent(env, [...STATIC_KEYS, ...IMPLICIT_SOURCES], "Vercel");
      const roleArn = env.IPA_AWS_ROLE_ARN ?? "";
      if (!ROLE_ARN.test(roleArn)) refuse("Vercel: IPA_AWS_ROLE_ARN mangler eller er ikke en IAM-rolle-ARN. Uden den er der ingen OIDC-federering.");
      const audience = env.IPA_AWS_OIDC_AUDIENCE?.trim() || DEFAULT_VERCEL_OIDC_AUDIENCE;
      if (!sources.vercelOidc) refuse("Vercel: OIDC-provideren er ikke koblet på denne runtime.");
      return { source: "vercel-oidc", credentials: sources.vercelOidc({ roleArn, audience, roleSessionName: "ipa-application" }) };
    }
    case "worker": {
      // ECS/Fargate (production and the evaluation environment): only the task role.
      refusePresent(env, [...STATIC_KEYS, ...IMPLICIT_SOURCES], "ECS-workeren");
      if (!env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI && !env.AWS_CONTAINER_CREDENTIALS_FULL_URI) {
        refuse("ECS-workeren: containerens credential-endpoint mangler (AWS_CONTAINER_CREDENTIALS_RELATIVE_URI). Workeren kører ikke med en ECS-taskrolle.");
      }
      if (!sources.containerTaskRole) refuse("ECS-workeren: containerens credential-provider er ikke koblet på denne runtime.");
      return { source: "ecs-task-role", credentials: sources.containerTaskRole() };
    }
    case "evaluation": {
      // The evaluation job in GitHub Actions: temporary credentials from the job's OIDC role.
      if (env.GITHUB_ACTIONS !== "true") refuse("Evalueringskørslen med rigtige udbydere kører kun i CI med GitHub OIDC (eller lokalt).");
      refusePresent(env, IMPLICIT_SOURCES, "Evalueringskørslen");
      if (!env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY || !env.AWS_SESSION_TOKEN) {
        refuse("Evalueringskørslen: der er ingen midlertidige credentials fra jobbets OIDC-rolle (AWS_SESSION_TOKEN mangler).");
      }
      if (!sources.federatedEnvironment) refuse("Evalueringskørslen: miljøets credential-provider er ikke koblet på denne runtime.");
      return { source: "github-oidc", credentials: sources.federatedEnvironment() };
    }
  }
}
