import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * WCAG 2.2 AA contrast for the V1 tokens (docs/04-ui-ux-design.md §20): text ≥ 4.5:1,
 * UI elements and focus ring ≥ 3:1 — also on tinted surfaces such as AI suggestions and
 * historical source cards.
 */
const css = fs.readFileSync(path.resolve(__dirname, "../app/globals.css"), "utf8");
const rootBlock = css.slice(css.indexOf(":root {"), css.indexOf("}", css.indexOf(":root {")));
const tokens = Object.fromEntries(
  [...rootBlock.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{6});/gi)].map((match) => [match[1], match[2].toLowerCase()]),
);

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

function token(name: string): string {
  const value = tokens[name];
  if (!value) throw new Error(`Missing token --${name}`);
  return value;
}

describe("design tokens", () => {
  const surfaces = ["surface-base", "surface-raised", "surface-sunken"];

  it("has readable text on every surface", () => {
    for (const text of ["text-primary", "text-secondary", "text-tertiary", "text-link"]) {
      for (const surface of surfaces) {
        expect(contrast(token(text), token(surface)), `${text} on ${surface}`).toBeGreaterThanOrEqual(4.5);
      }
    }
    expect(contrast(token("text-inverse"), token("accent-primary"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token("text-inverse"), token("brand-primary"))).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps every status colour readable on its own tint and on raised surfaces", () => {
    const statuses = [
      "status-success",
      "status-warning",
      "status-error",
      "status-info",
      "knowledge-authoritative",
      "knowledge-historical",
      "knowledge-conflict",
      "knowledge-insufficient",
      "ai-suggestion",
      "ai-validated",
      "note-personal",
    ];
    for (const status of statuses) {
      expect(contrast(token(status), token(`${status}-subtle`)), `${status} on its tint`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(token(status), token("surface-raised")), `${status} on raised`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("keeps body text readable on tinted AI and historical surfaces", () => {
    for (const tint of ["ai-suggestion-subtle", "knowledge-historical-subtle", "note-personal-subtle", "knowledge-insufficient-subtle"]) {
      expect(contrast(token("text-primary"), token(tint)), tint).toBeGreaterThanOrEqual(4.5);
      expect(contrast(token("text-secondary"), token(tint)), tint).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("has a focus ring and strong border visible against surfaces (≥ 3:1)", () => {
    for (const surface of ["surface-base", "surface-raised"]) {
      expect(contrast(token("focus-ring"), token(surface)), `focus on ${surface}`).toBeGreaterThanOrEqual(3);
      expect(contrast(token("border-strong"), token(surface)), `border-strong on ${surface}`).toBeGreaterThanOrEqual(3);
    }
  });

  it("uses an off-white base, not pure white (§3.3)", () => {
    expect(token("surface-base")).not.toBe("#ffffff");
  });
});
