import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { invokeModel } from "@/lib/ai/core/invoke";
import type { Model } from "@/lib/ai/core/model";
import { createContractBreakingStub, createModel, ModelNotConfiguredError } from "@/lib/ai/core/registry";
import { createStubModel, STUB_MODEL } from "@/lib/ai/core/stub-model";
import type { ModelInput, SentPart } from "@/lib/ai/core/types";
import { knowledgeText, userText } from "@/lib/egress/classification";
import { requireProductionEvidence, type EvidenceSet } from "@/lib/knowledge/core/evidence";
import { GradeNotAllowedError, type Grade } from "@/lib/knowledge/core/grade";

import { evidenceItem, issueEvidence } from "./fixtures/ai-evidence";

/**
 * Phase 8 — the pairing rule (B-012, docs/08 §3.3, docs/07 §9.1 pt. 4): a production model may
 * only receive production evidence. Each mechanism has its own tests, so weakening any one of
 * them fails this file (mutation-tested, docs/08 §18).
 */

const SRC = path.resolve(__dirname, "..");
function files(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "tests" ? [] : files(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}
const sources = files(SRC).map((file) => ({ file: path.relative(SRC, file).split(path.sep).join("/"), text: fs.readFileSync(file, "utf8") }));

/** A model double that records whether it was called. */
function spyModel(grade: string) {
  const calls: ModelInput[] = [];
  const model = { id: `spy-${grade}`, version: "1", grade: grade as Grade, async generate(input: ModelInput) { calls.push(input); return { raw: {} }; } };
  return { model, calls };
}

function inputFor(set: EvidenceSet | null): ModelInput {
  const question = "Dækker forsikringen droner?";
  const parts: SentPart[] = [{ kind: "question", category: "user_question", text: question, content: userText(question, { caseBound: false, redacted: true }) }];
  for (const item of set?.items ?? []) {
    parts.push({
      kind: "evidence",
      category: "knowledge",
      text: item.excerpt.text,
      content: knowledgeText(item.excerpt.text),
      evidence: { evidenceId: item.evidenceId, label: item.sourceReference.label, temporalStatus: item.validity.temporalStatus, inConflict: false },
    });
  }
  return { profile: { id: "copilot", version: "1" }, action: "answer_question", system: "", parts, outputContract: "copilot.answer.v1" };
}

const developmentEvidence = () => issueEvidence([evidenceItem(1)]);
const productionEvidence = () => issueEvidence([evidenceItem(1)], { embedder: "production", reranker: "production" });

describe("B-012 — a production model only receives production evidence", () => {
  it("refuses development evidence for a production model — and never calls it", async () => {
    const { model, calls } = spyModel("production");
    const set = developmentEvidence();
    await expect(invokeModel(model as Model<"production">, set as never, inputFor(set))).rejects.toThrow(/evidensgraden er "development"/);
    expect(calls).toHaveLength(0);
  });

  it('treats any grade that is not exactly "development" as production (fail-closed)', async () => {
    for (const grade of ["production", "Development", "dev", "", "unknown"]) {
      const { model, calls } = spyModel(grade);
      const set = developmentEvidence();
      await expect(invokeModel(model as Model<"production">, set as never, inputFor(set)), grade).rejects.toThrow();
      expect(calls, grade).toHaveLength(0);
    }
  });

  it("refuses evidence that was not issued by the retrieval layer, or was forced by the development tool", async () => {
    const { model, calls } = spyModel("production");
    const forged = structuredClone(productionEvidence()) as EvidenceSet;
    await expect(invokeModel(model as Model<"production">, forged as never, inputFor(forged))).rejects.toThrow(/ikke udstedt/);
    const forced = issueEvidence([], { embedder: "production", reranker: "production", devOverride: "force_insufficient" });
    await expect(invokeModel(model as Model<"production">, forced as never, inputFor(forced))).rejects.toThrow(/udviklingsværktøj/);
    expect(calls).toHaveLength(0);
  });

  it("refuses evidence parts that do not belong to the checked evidence set (no smuggling past the check)", async () => {
    const { model, calls } = spyModel("production");
    const production = requireProductionEvidence(productionEvidence());
    const smuggled = inputFor(developmentEvidence());
    await expect(invokeModel(model as Model<"production">, null, smuggled)).rejects.toThrow(/evidenssæt/);
    const other = issueEvidence([evidenceItem(2)], { embedder: "production", reranker: "production" });
    await expect(invokeModel(model as Model<"production">, production, inputFor(other))).rejects.toThrow(/kontrollerede evidenssæt/);
    expect(calls).toHaveLength(0);
  });

  it("lets a production model receive production evidence, and a development model development evidence", async () => {
    const production = spyModel("production");
    const set = requireProductionEvidence(productionEvidence());
    await invokeModel(production.model as Model<"production">, set, inputFor(set));
    expect(production.calls).toHaveLength(1);

    const stub = createStubModel();
    const dev = developmentEvidence();
    await invokeModel(stub, dev, inputFor(dev));
    expect(stub.received).toHaveLength(1);
  });

  it("is enforced by the type system: a Model<'production'> cannot take a plain EvidenceSet", () => {
    const { model } = spyModel("production");
    const set = developmentEvidence();
    // @ts-expect-error — an EvidenceSet without the production brand is rejected at compile time.
    const call = () => invokeModel(model as Model<"production">, set, inputFor(set));
    expect(typeof call).toBe("function");
  });
});

describe("the model registry is fail-closed (B-012)", () => {
  it("refuses the stub when IPA_RUNTIME_ENV is missing, production or unknown", () => {
    for (const environment of ["production"] as const) {
      expect(() => createModel(STUB_MODEL.id, environment)).toThrow(GradeNotAllowedError);
      expect(() => createContractBreakingStub(environment)).toThrow(GradeNotAllowedError);
    }
    const saved = process.env.IPA_RUNTIME_ENV;
    try {
      for (const value of [undefined, "staging", "PRODUCTION", "Local"]) {
        if (value === undefined) delete process.env.IPA_RUNTIME_ENV;
        else process.env.IPA_RUNTIME_ENV = value;
        expect(() => createModel(STUB_MODEL.id), String(value)).toThrow(GradeNotAllowedError);
      }
    } finally {
      if (saved === undefined) delete process.env.IPA_RUNTIME_ENV;
      else process.env.IPA_RUNTIME_ENV = saved;
    }
  });

  it("constructs the stub only for local and test — with a frozen development grade", () => {
    for (const environment of ["local", "test"] as const) {
      const model = createModel(STUB_MODEL.id, environment);
      expect(model.grade).toBe("development");
      expect(Object.isFrozen(model)).toBe(true);
      expect(() => {
        (model as { grade: string }).grade = "production";
      }).toThrow();
    }
  });

  it("never falls back to the stub for an unknown model", () => {
    expect(() => createModel("anthropic:some-model", "test")).toThrow(ModelNotConfiguredError);
  });
});

describe("guardrails in the source code", () => {
  it("only invoke.ts calls a model's generate()", () => {
    const offenders = sources
      .filter(({ file }) => file !== "lib/ai/core/invoke.ts" && file !== "lib/ai/core/stub-model.ts")
      .filter(({ text }) => /\.generate\(/.test(text))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });

  it("only the registry constructs the stub model", () => {
    const offenders = sources
      .filter(({ file }) => file !== "lib/ai/core/registry.ts" && file !== "lib/ai/core/stub-model.ts")
      .filter(({ text }) => /createStubModel\(/.test(text))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });

  it("only the gateway pipeline calls invokeModel and the registry", () => {
    const offenders = sources
      .filter(({ file }) => !file.startsWith("lib/ai/"))
      .filter(({ text }) => /from "@\/lib\/ai\/core\/(invoke|registry|stub-model|gateway-core)"/.test(text))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });

  it("no client component imports the gateway — only pure view code and the Copilot server action", () => {
    const allowed = ["@/lib/ai/outcome", "@/lib/ai/copilot-view", "@/lib/ai/copilot-actions"];
    const offenders = sources
      .filter(({ text }) => /^["']use client["']/m.test(text))
      .flatMap(({ file, text }) =>
        [...text.matchAll(/^import\s+(type\s+)?[^;]*from\s+"(@\/lib\/ai\/[^"]+)"/gm)]
          .filter((match) => !match[1] && !allowed.includes(match[2]!))
          .map((match) => `${file}: ${match[2]}`),
      );
    expect(offenders).toEqual([]);
  });

  it("the gateway entry is server-only, and the Copilot action is a server action that only calls it", () => {
    const gateway = sources.find(({ file }) => file === "lib/ai/gateway.ts")!;
    expect(gateway.text).toMatch(/^import "server-only";/);
    const action = sources.find(({ file }) => file === "lib/ai/copilot-actions.ts")!;
    expect(action.text).toMatch(/^"use server";/);
    expect(action.text).toMatch(/runAiRequest\(/);
    expect(action.text).not.toMatch(/createModel|invokeModel|createContractBreakingStub/);
  });

  it("the pure view modules import nothing server-side", () => {
    for (const file of ["lib/ai/outcome.ts", "lib/ai/copilot-view.ts"]) {
      const text = sources.find((entry) => entry.file === file)!.text;
      expect(text, file).not.toMatch(/server-only|gateway"|supabase|registry|invoke/);
    }
  });
});
