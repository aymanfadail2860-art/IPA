import { describe, expect, it } from "vitest";

import { childProcessInspector } from "../../workers/ingestion/security/inspector.ts";
import { HARD_LIMITS } from "../../workers/ingestion/security/limits.ts";
import { clamdScanner } from "../../workers/ingestion/security/scanner.ts";

import { buildPdf, simplePdf, termsFixturePages } from "./fixtures/knowledge-pdfs";
import { eicar, rawPdf } from "./fixtures/security-pdfs";

/**
 * 8B-I5.6 — the fixture suite an ENGINE CANDIDATE must pass before it can be approved
 * (.github/workflows/clamav-engine-candidate.yml). It runs against a live candidate scanner:
 *
 *   IPA_CANDIDATE_CLAMD_HOST=127.0.0.1 IPA_CANDIDATE_CLAMD_PORT=3310 IPA_CANDIDATE_ENGINE=1.4.6 \
 *     npx vitest run src/tests/clamav-candidate.test.ts
 *
 * Without a candidate it is skipped (ordinary runs have no scanner).
 */

const host = process.env.IPA_CANDIDATE_CLAMD_HOST;
const scanner = host ? clamdScanner({ host, port: Number(process.env.IPA_CANDIDATE_CLAMD_PORT ?? 3310) }) : null;

describe.skipIf(!scanner)("ClamAV engine candidate", () => {
  it("reports the candidate engine version", async () => {
    const info = await scanner!.info();
    expect("error" in info).toBe(false);
    if ("error" in info) return;
    expect(info.engine).toBe("ClamAV");
    expect(info.engineVersion).toBe(process.env.IPA_CANDIDATE_ENGINE);
  });

  it("detects the EICAR test file", async () => {
    const result = await scanner!.scan(new TextEncoder().encode(eicar()), 30_000);
    expect(result.result).toBe("infected");
  });

  it("finds clean fixtures clean — no false positive and no scanner error", async () => {
    const clean = [
      await simplePdf("kandidat"),
      await buildPdf(termsFixturePages()),
      rawPdf(),
      rawPdf({ page: "/Annots [5 0 R]", objects: ["<< /Type /Annot /Subtype /Link /Rect [0 0 1 1] /A << /S /URI /URI (https://example.test) >> >>"] }),
    ];
    for (const bytes of clean) expect(await scanner!.scan(bytes, 30_000)).toEqual({ result: "clean" });
  });

  it("handles our PDF/security fixtures without a scanner error; the PDF inspection still rejects them", async () => {
    const hostile = [
      rawPdf({ catalog: "/OpenAction << /S /JavaScript /JS (app.alert\\(1\\)) >>" }),
      rawPdf({ page: "/AA << /O << /S /Launch /F (cmd.exe) >> >>" }),
      rawPdf({ trailer: "/Encrypt 5 0 R /ID [<00> <00>]", objects: ["<< /Filter /Standard /V 2 /R 3 /O <00> /U <00> /P -4 >>"] }),
      rawPdf({ after: new Uint8Array([0x50, 0x4b, 0x03, 0x04, 9, 9, 9, 9]) }),
    ];
    const inspector = childProcessInspector();
    for (const bytes of hostile) {
      const scanned = await scanner!.scan(bytes, 30_000);
      expect(scanned.result).not.toBe("error");
      const inspected = await inspector.inspect(bytes, HARD_LIMITS);
      expect(inspected.pdfSecurity.result === "fail" || inspected.activeContent.result === "fail").toBe(true);
    }
  });
});
