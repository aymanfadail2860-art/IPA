import { fromContainerMetadata } from "@smithy/credential-provider-imds";

import type { AwsCredentialSources } from "./aws-credentials.ts";

/**
 * The ECS/Fargate worker's ONLY AWS credential source (D-10, 8B-I8 C7): the task role through
 * the container credential endpoint (AWS_CONTAINER_CREDENTIALS_RELATIVE_URI). Short-lived and
 * refreshed by the SDK. Used by the production worker and the evaluation environment's worker.
 */
export const CONTAINER_CREDENTIAL_SOURCES: AwsCredentialSources = Object.freeze({
  containerTaskRole: () => fromContainerMetadata({ timeout: 2_000, maxRetries: 2 }),
});
