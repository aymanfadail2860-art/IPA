import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * "Godkend som autoritativ" (docs/04 §14.2): the confirmation dialog summarizes the
 * consequences — including a conflict with an already authoritative source (docs/07 §11.2),
 * shown neutrally (both sources, no recommendation) and never blocking (B-11).
 */
const panel = fs.readFileSync(path.resolve(__dirname, "../components/knowledge-admin/review-panel.tsx"), "utf8");
const dialog = panel.slice(panel.indexOf("function ApproveDialog("), panel.indexOf("function ReasonDialog("));

describe("the approval dialog shows conflict candidates as a consequence", () => {
  it("receives the version's conflict candidates", () => {
    expect(panel).toMatch(/<ApproveDialog[\s\S]*?conflicts=\{detail\.conflictCandidates\}/);
  });

  it("names both sources and recommends neither", () => {
    expect(dialog).toMatch(/\{self\} og \{candidate\.documentTitle\}/);
    expect(dialog).toMatch(/Systemet afgør ikke, hvilken kilde der gælder/);
    expect(dialog).not.toMatch(/anbefal|bør gælde|vælg den nyeste|nyeste gælder/i);
  });

  it("does not block approval", () => {
    const button = dialog.slice(dialog.indexOf("<DialogFooter>"));
    expect(button).not.toMatch(/disabled=\{[^}]*conflict/);
    expect(panel).toMatch(/state\?\.canApprove \? \(\s*<ApproveDialog/);
  });
});
