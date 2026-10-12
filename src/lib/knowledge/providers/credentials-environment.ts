import { fromEnv } from "@aws-sdk/credential-provider-env";

import type { AwsCredentialSources } from "./aws-credentials.ts";

/**
 * The evaluation job's ONLY AWS credential source in CI (8B-I7, 8B-I8 C1): the temporary
 * credentials that GitHub OIDC → configure-aws-credentials puts in the job's environment. The
 * plan requires a session token, so a long-lived key can never pass as one.
 */
export const ENVIRONMENT_CREDENTIAL_SOURCES: AwsCredentialSources = Object.freeze({
  federatedEnvironment: () => fromEnv(),
});
