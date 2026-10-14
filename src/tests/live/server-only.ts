// The "server-only" marker for the L4b run (vitest.l4b.config.mts). The harness runs on the server
// side by construction; this lets it use the application's own model factory
// (src/lib/ai/providers/anthropic/server.ts) unchanged instead of a copy of it.
export {};
