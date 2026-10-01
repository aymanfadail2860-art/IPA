/** Runs once when the server starts (Next.js instrumentation). */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { checkRetrievalConfiguration } = await import("./lib/knowledge/retrieval-startup");
  checkRetrievalConfiguration();
}
