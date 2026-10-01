import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(__dirname, "..");

function files(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "tests" ? [] : files(full);
    return /\.(tsx?|css)$/.test(entry.name) ? [full] : [];
  });
}

const sources = files(SRC).map((file) => ({ file: path.relative(SRC, file), text: fs.readFileSync(file, "utf8") }));

describe("AI signature guardrails (docs/04-ui-ux-design.md §3.4, §10.2)", () => {
  it("uses a dashed border ONLY in the AI suggestion component", () => {
    const offenders = sources
      .filter(({ text }) => /\b(border|outline|divide|decoration)(-[a-z]+)?-dashed\b|(border|outline)(-[a-z]+)?-style:\s*dashed|stroke-?dasharray/i.test(text))
      .map(({ file }) => file)
      .filter((file) => file !== path.join("components", "knowledge", "ai-suggestion.tsx"));
    expect(offenders).toEqual([]);
  });

  it("never uses italics (italics are not an AI marker)", () => {
    const offenders = sources.filter(({ text }) => /\bitalic\b|font-style:\s*italic/.test(text)).map(({ file }) => file);
    expect(offenders).toEqual([]);
  });
});

describe("mock data isolation (CLAUDE.md §2)", () => {
  it("keeps reusable code free of mock data — only pages and dev tools import @/mocks", () => {
    const offenders = sources
      .filter(({ file }) => !file.startsWith(`app${path.sep}`) && !file.startsWith(`dev${path.sep}`) && !file.startsWith(`mocks${path.sep}`))
      .filter(({ text }) => /from ["']@\/mocks/.test(text))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });

  it("marks every mock file as development-only data", () => {
    const mockFiles = sources.filter(({ file }) => file.startsWith(`mocks${path.sep}`));
    expect(mockFiles.length).toBeGreaterThan(0);
    for (const { file, text } of mockFiles) {
      expect(text, file).toMatch(/MOCK DATA — DEVELOPMENT ONLY/);
    }
  });
});

describe("secrets and AI boundary (docs/03 §9, §11)", () => {
  it("never reads the Supabase service-role key in application code", () => {
    const offenders = sources.filter(({ text }) => /SERVICE_ROLE|service_role/.test(text)).map(({ file }) => file);
    expect(offenders).toEqual([]);
  });

  it("never imports the ingestion worker into the app — the worker's service-role access stays out of src/ (docs/07 §14.1)", () => {
    const offenders = sources.filter(({ text }) => /from ["'][^"']*workers\//.test(text)).map(({ file }) => file);
    expect(offenders).toEqual([]);
  });

  it("contains no API keys or client-side AI calls", () => {
    const offenders = sources
      .filter(({ text }) =>
        /sk-ant-|ANTHROPIC_API_KEY|api\.anthropic\.com|eyJhbGciOi|sb_secret_|NEXT_PUBLIC_(?!SUPABASE_ANON_KEY\b)[A-Z_]*(KEY|SECRET|TOKEN)/.test(text),
      )
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });
});

describe("server-side authorization in every platform page (docs/06 §7)", () => {
  it("checks the session in each page — layouts cannot block their page's output", () => {
    const pages = sources.filter(({ file }) => file.startsWith(path.join("app", "(platform)")) && file.endsWith("page.tsx"));
    expect(pages.length).toBeGreaterThan(10);
    const unguarded = pages.filter(({ text }) => !/await (requireSession|authorize)\(/.test(text)).map(({ file }) => file);
    expect(unguarded).toEqual([]);
  });
});
