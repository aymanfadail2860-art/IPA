# syntax=docker/dockerfile:1.7
#
# Ingestion worker — the import image (docs/08b §21.5; beta: docs/beta.md §6, deploy/import/).
# Build context: the repository root.
#
#   docker compose -f deploy/import/compose.yaml build worker
#
# * No build arguments and no secrets. The database credential comes from the operator's
#   environment at run time; nothing secret is baked into a layer.
# * Only the worker's runtime dependencies (deploy/ingestion-worker/package.json: postgres and
#   pdfjs-dist) — no Next.js, no @supabase/supabase-js, no Vercel code, no dev dependencies, no
#   cloud provider SDK (B-035 L2).
# * The development-only service-role adapter is not in the image (.dockerignore + rm below).
# * Runs as the unprivileged "node" user (uid 1000) on a read-only root filesystem; /tmp is a
#   tmpfs (deploy/import/compose.yaml).
# * Pin the base image digest before the first real import [AFKLARES, L3].

FROM docker.io/library/node:22.22.2-bookworm-slim AS deps
WORKDIR /app
COPY deploy/ingestion-worker/package.json deploy/ingestion-worker/package-lock.json ./
RUN npm ci --omit=dev --omit=optional --ignore-scripts --no-audit --no-fund && npm cache clean --force

FROM docker.io/library/node:22.22.2-bookworm-slim AS runtime
ENV NODE_ENV=production \
    IPA_RUNTIME_ENV=production \
    IPA_WORKER_DB_CA_FILE=/app/certs/supabase-ca.crt \
    IPA_WORKER_LIVENESS_FILE=/tmp/ipa-worker/alive
WORKDIR /app
# Code and dependencies belong to root and are read-only for the worker user.
COPY --from=deps /app/node_modules ./node_modules
COPY deploy/ingestion-worker/package.json ./package.json
COPY workers/ingestion/ ./workers/ingestion/
COPY src/lib/egress/ ./src/lib/egress/
COPY src/lib/knowledge/core/ ./src/lib/knowledge/core/
COPY src/lib/observability/ ./src/lib/observability/
COPY deploy/ingestion-worker/certs/ ./certs/
RUN rm -f workers/ingestion/dev-service-role.ts
USER node
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 CMD ["node", "workers/ingestion/healthcheck.ts"]
ENTRYPOINT ["node", "workers/ingestion/main.ts"]
