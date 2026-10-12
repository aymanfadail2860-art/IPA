import { awsCredentialsProvider } from "@vercel/oidc-aws-credentials-provider";

import type { AwsCredentialSources, VercelOidcInit } from "./aws-credentials.ts";
import { EU_SOURCE_REGION } from "./bedrock/cohere-embed-v4.ts";

/**
 * The application's ONLY AWS credential source in production (D-11, 8B-I8 C1): Vercel's OIDC
 * token, exchanged for the configured audience, then AWS STS AssumeRoleWithWebIdentity →
 * short-lived credentials. STS is called in the EU source region, set explicitly rather than
 * read from the environment or a profile. Resolved lazily by the SDK; no key is ever read or
 * stored. Server-only: imported by providers/configured.ts, never by client code (guardrail).
 */
export const VERCEL_CREDENTIAL_SOURCES: AwsCredentialSources = Object.freeze({
  vercelOidc: ({ roleArn, audience, roleSessionName }: VercelOidcInit) =>
    awsCredentialsProvider({ roleArn, audience, roleSessionName, clientConfig: { region: EU_SOURCE_REGION } }),
});
