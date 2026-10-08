import { describe, expect, it, vi } from "vitest";

import {
  ALERT_CATALOGUE,
  AlertConfigError,
  createAlert,
  createAlertSink,
  fanOut,
  isSafeAlert,
  logAlertSink,
  webhookAlertSink,
  type Alert,
  type AlertSink,
} from "@/lib/observability/alerts";

/**
 * 8B-I7 — alarms through the abstract AlertSink (docs/08b §14, D-15). The first channel is a
 * webhook; `log` always runs. An alarm can never carry document content, a query or personal
 * data: the summary is fixed per code and details are numbers or short tokens.
 */

const now = () => new Date("2026-10-08T08:00:00.000Z");

describe("an alarm is built from its code — never from free text", () => {
  it("takes severity and summary from the catalogue", () => {
    const alert = createAlert("configuration_suspended", { configuration_id: "c0ffee00-0000-4000-8000-000000000001", reason: "hard_gate_failed" }, now);
    expect(alert).toEqual({
      code: "configuration_suspended",
      severity: "critical",
      summary: ALERT_CATALOGUE.configuration_suspended.summary,
      details: { configuration_id: "c0ffee00-0000-4000-8000-000000000001", reason: "hard_gate_failed" },
      occurredAt: "2026-10-08T08:00:00.000Z",
    });
    expect(isSafeAlert(alert)).toBe(true);
  });

  it("drops prose, queries, names and anything with a space — and counts what it dropped", () => {
    const alert = createAlert("retrieval_unavailable", {
      error_code: "unavailable",
      query: "Dækker forsikringen skade på ting hos Hansen ApS?",
      person: "Jens Jensen",
      note: "a".repeat(201),
      count: 3,
      nested: { secret: "x" },
      infinity: Number.POSITIVE_INFINITY,
      "Bad Key": "x",
    }, now);
    expect(alert.details).toEqual({ error_code: "unavailable", count: 3, details_dropped: 6 });
    expect(JSON.stringify(alert)).not.toMatch(/Hansen|Jensen|Dækker/);
  });

  it("refuses an unknown code", () => {
    expect(() => createAlert("made_up" as never)).toThrow(/Ukendt alarmkode/);
  });

  it("a hand-made alarm with another summary, severity or a prose detail is not safe", () => {
    const base = createAlert("dead_letter", { new_failed_jobs: 1 }, now);
    expect(isSafeAlert({ ...base, summary: "Kunden Hansen ApS har fejlet" })).toBe(false);
    expect(isSafeAlert({ ...base, severity: "critical" })).toBe(false);
    expect(isSafeAlert({ ...base, details: { text: "en hel sætning med mellemrum" } })).toBe(false);
  });
});

describe("the log sink (always on)", () => {
  it("writes one JSON line per alarm", async () => {
    const lines: string[] = [];
    await logAlertSink("worker", (line) => lines.push(line)).send(createAlert("queue_stale", { oldest_queued_seconds: 2400 }, now));
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({ event: "alert", source: "worker", code: "queue_stale", severity: "warning", details: { oldest_queued_seconds: 2400 } });
  });

  it("refuses an unsafe alarm instead of writing it", async () => {
    const lines: string[] = [];
    const unsafe = { ...createAlert("queue_stale", {}, now), details: { text: "dokumentets indhold her" } } as Alert;
    await logAlertSink("worker", (line) => lines.push(line)).send(unsafe);
    expect(lines.map((line) => JSON.parse(line).event)).toEqual(["alert_refused"]);
    expect(lines.join("")).not.toMatch(/dokumentets indhold/);
  });
});

describe("the first channel: a webhook (JSON over HTTPS)", () => {
  it("posts the alarm and never throws — a failed delivery is logged", async () => {
    const calls: { url: string; body: unknown }[] = [];
    const ok = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      return new Response(null, { status: 204 });
    });
    const lines: string[] = [];
    const sink = webhookAlertSink({ url: "https://alerts.example.invalid/hook", source: "worker", fetch: ok as unknown as typeof fetch, write: (line) => lines.push(line) });
    await sink.send(createAlert("malware_found", { infected_last_24h: 1 }, now));
    expect(calls[0]).toMatchObject({ url: "https://alerts.example.invalid/hook", body: { source: "worker", code: "malware_found", severity: "warning" } });
    expect(lines).toEqual([]);

    const failing = webhookAlertSink({ url: "https://alerts.example.invalid/hook", source: "worker", fetch: (async () => { throw new TypeError("network"); }) as unknown as typeof fetch, write: (line) => lines.push(line) });
    await expect(failing.send(createAlert("malware_found", {}, now))).resolves.toBeUndefined();
    const refused = webhookAlertSink({ url: "https://alerts.example.invalid/hook", source: "worker", fetch: (async () => new Response(null, { status: 500 })) as unknown as typeof fetch, write: (line) => lines.push(line) });
    await refused.send(createAlert("malware_found", {}, now));
    expect(lines.map((line) => JSON.parse(line))).toEqual([
      { event: "alert_delivery_failed", source: "worker", code: "malware_found", error: "TypeError" },
      { event: "alert_delivery_failed", source: "worker", code: "malware_found", status: 500 },
    ]);
  });

  it("one failing channel never stops another", async () => {
    const received: string[] = [];
    const broken: AlertSink = { send: async () => { throw new Error("down"); } };
    const working: AlertSink = { send: async (alert) => void received.push(alert.code) };
    await fanOut(broken, working).send(createAlert("dead_letter", {}, now));
    expect(received).toEqual(["dead_letter"]);
  });
});

describe("the channel is configuration (D-15, Å-5)", () => {
  it("defaults to the log; the webhook adds itself to the log", async () => {
    const lines: string[] = [];
    await createAlertSink({}, "app", { write: (line) => lines.push(line) }).send(createAlert("dead_letter", {}, now));
    expect(lines).toHaveLength(1);
    const posted: string[] = [];
    const sink = createAlertSink({ IPA_ALERT_SINK: "webhook", IPA_ALERT_WEBHOOK_URL: "https://alerts.example.invalid/x" }, "app", {
      write: (line) => lines.push(line),
      fetch: (async (url: string) => { posted.push(url); return new Response(null, { status: 200 }); }) as unknown as typeof fetch,
    });
    await sink.send(createAlert("dead_letter", {}, now));
    expect(lines).toHaveLength(2);
    expect(posted).toEqual(["https://alerts.example.invalid/x"]);
  });

  it("refuses an unknown channel, a missing URL and a plain-HTTP URL (except localhost)", () => {
    expect(() => createAlertSink({ IPA_ALERT_SINK: "sms" }, "app")).toThrow(AlertConfigError);
    expect(() => createAlertSink({ IPA_ALERT_SINK: "webhook" }, "app")).toThrow(/IPA_ALERT_WEBHOOK_URL/);
    expect(() => createAlertSink({ IPA_ALERT_SINK: "webhook", IPA_ALERT_WEBHOOK_URL: "http://alerts.example.invalid/x" }, "app")).toThrow(/HTTPS/);
    expect(() => createAlertSink({ IPA_ALERT_SINK: "webhook", IPA_ALERT_WEBHOOK_URL: "http://127.0.0.1:9000/x" }, "app")).not.toThrow();
  });
});
