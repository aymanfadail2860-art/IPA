/**
 * A FAKE Anthropic transport (beta L4): a fetch that answers like the Messages API without any
 * network. Every L4 test uses it; no test can reach the real API (the transport refuses the real
 * fetch in IPA_RUNTIME_ENV=test). Everything is fictional.
 */

export const FAKE_API_KEY = "fake-anthropic-test-key-0000000000";
export const FAKE_MODEL = "claude-fake-l4";

export interface RecordedRequest {
  url: string;
  path: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

export type FakeReply =
  | { kind: "message"; content?: unknown[]; stopReason?: string; usage?: Partial<Record<"input_tokens" | "output_tokens" | "cache_creation_input_tokens" | "cache_read_input_tokens", number>> }
  | { kind: "error"; status: number; type?: string; retryAfter?: string }
  | { kind: "network" }
  | { kind: "hang" };

export interface FakeAnthropic {
  fetch: typeof globalThis.fetch;
  requests: RecordedRequest[];
  /** Requests to /v1/messages (not the token count). */
  messages(): RecordedRequest[];
  counts(): RecordedRequest[];
}

type DocumentParam = { type: "document"; source: { content: { text: string }[] } };

/** Cites the first block of every document — a valid answer for the Copilot contract. */
export function citingAnswer(body: Record<string, unknown>, marker = "[SVAR]"): unknown[] {
  const content = ((body.messages as { content: unknown[] }[])[0]!.content as { type: string }[]).filter((block): block is DocumentParam => block.type === "document");
  return [
    { type: "text", text: `${marker}\n`, citations: null },
    ...content.flatMap((doc, i) => [
      { type: "text", text: `Svar på grundlag af dokument ${i + 1}. `, citations: null },
      {
        type: "text",
        text: "Det fremgår af betingelserne.",
        citations: [{ type: "content_block_location", cited_text: doc.source.content[0]!.text, document_index: i, document_title: null, start_block_index: 0, end_block_index: 1 }],
      },
      { type: "text", text: "\n\n", citations: null },
    ]),
  ];
}

/**
 * The fake. `count` gives the provider's token count (default: a quarter of the request's
 * characters). `reply` answers each /v1/messages request in turn (default: a citing answer).
 */
export function fakeAnthropic(options: { count?: number | ((body: Record<string, unknown>) => number); countReply?: FakeReply; replies?: FakeReply[]; reply?: (body: Record<string, unknown>) => FakeReply } = {}): FakeAnthropic {
  const requests: RecordedRequest[] = [];
  let messageCalls = 0;
  const json = (status: number, value: unknown, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", "request-id": `req_fake_${requests.length}`, ...headers } });

  const answer = (reply: FakeReply, body: Record<string, unknown>, signal: AbortSignal | null | undefined): Promise<Response> => {
    switch (reply.kind) {
      case "network":
        return Promise.reject(new TypeError("fetch failed"));
      case "hang":
        return new Promise((_, reject) => signal?.addEventListener("abort", () => reject(signal.reason ?? new DOMException("aborted", "AbortError"))));
      case "error":
        return Promise.resolve(
          json(reply.status, { type: "error", error: { type: reply.type ?? "api_error", message: "Fiktiv fejl fra den falske udbyder — FORTROLIG-UDBYDERTEKST" } }, reply.retryAfter ? { "retry-after": reply.retryAfter } : {}),
        );
      case "message":
        return Promise.resolve(
          json(200, {
            id: `msg_fake_${messageCalls}`,
            type: "message",
            role: "assistant",
            model: body.model,
            content: reply.content ?? citingAnswer(body),
            stop_reason: reply.stopReason ?? "end_turn",
            stop_sequence: null,
            usage: { input_tokens: 1200, output_tokens: 150, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, ...reply.usage },
          }),
        );
    }
  };

  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const parsed = new URL(url);
    if (parsed.host !== "api.anthropic.com") throw new Error(`Den falske transport kender kun api.anthropic.com, ikke ${parsed.host}.`);
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => (headers[key] = value));
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    requests.push({ url, path: parsed.pathname, headers, body });
    if (parsed.pathname === "/v1/messages/count_tokens") {
      if (options.countReply) return answer(options.countReply, body, init?.signal);
      const count = typeof options.count === "function" ? options.count(body) : (options.count ?? Math.ceil(JSON.stringify(body).length / 4));
      return json(200, { input_tokens: count });
    }
    if (parsed.pathname === "/v1/messages") {
      const reply = options.replies?.[messageCalls] ?? options.reply?.(body) ?? { kind: "message" };
      messageCalls += 1;
      return answer(reply, body, init?.signal);
    }
    return json(404, { type: "error", error: { type: "not_found_error", message: "ukendt" } });
  }) as typeof globalThis.fetch;

  return {
    fetch: fetchImpl,
    requests,
    messages: () => requests.filter((request) => request.path === "/v1/messages"),
    counts: () => requests.filter((request) => request.path === "/v1/messages/count_tokens"),
  };
}
