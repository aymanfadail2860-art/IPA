import { deflateSync } from "node:zlib";

/**
 * ⚠ TEST FIXTURES — synthetic PDFs for the 8B-I5 security tests, built at test time. Each one
 * is a correct, minimal PDF (exact cross-reference offsets) with exactly the feature under test,
 * so a rejection is caused by that feature and nothing else. No real document, no real script:
 * the "scripts" are inert strings that nothing executes.
 */

const latin1 = (text: string) => Buffer.from(text, "latin1");

export interface RawPdfOptions {
  /** Catalog entries beyond /Type /Catalog /Pages 2 0 R (e.g. "/OpenAction 5 0 R"). */
  catalog?: string;
  /** Page entries beyond the basics (e.g. "/Annots [6 0 R]"). */
  page?: string;
  /** Extra objects, numbered from 5. Each is the text between "n 0 obj" and "endobj". */
  objects?: (string | Uint8Array)[];
  /** Extra trailer entries (e.g. "/Encrypt 9 0 R"). */
  trailer?: string;
  /** Bytes appended after %%EOF (polyglots). */
  after?: Uint8Array;
  /** Use a classic xref table (default) or none at all (broken file). */
  xref?: boolean;
  /** Overrides an xref entry: [object number, offset]. */
  xrefOverride?: [number, number];
  version?: string;
}

/** A one-page PDF with a text layer ("Fiktiv testtekst"), plus whatever the options add. */
export function rawPdf(options: RawPdfOptions = {}): Uint8Array {
  const content = "BT /F1 12 Tf 72 720 Td (Fiktiv testtekst) Tj ET";
  const objects: (string | Uint8Array)[] = [
    `<< /Type /Catalog /Pages 2 0 R ${options.catalog ?? ""} >>`,
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> ${options.page ?? ""} >>`,
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    ...(options.objects ?? []),
  ];
  const parts: Buffer[] = [latin1(`%PDF-${options.version ?? "1.7"}\n%\xe2\xe3\xcf\xd3\n`)];
  const offsets: number[] = [];
  let length = parts[0]!.length;
  objects.forEach((body, index) => {
    offsets.push(length);
    const chunk = Buffer.concat([latin1(`${index + 1} 0 obj\n`), typeof body === "string" ? latin1(body) : Buffer.from(body), latin1("\nendobj\n")]);
    parts.push(chunk);
    length += chunk.length;
  });
  const xrefAt = length;
  if (options.xref !== false) {
    const rows = offsets.map((offset, index) => {
      const value = options.xrefOverride && options.xrefOverride[0] === index + 1 ? options.xrefOverride[1] : offset;
      return `${String(value).padStart(10, "0")} 00000 n \n`;
    });
    parts.push(latin1(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${rows.join("")}`));
  }
  parts.push(latin1(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R ${options.trailer ?? ""} >>\nstartxref\n${xrefAt}\n%%EOF\n`));
  if (options.after) parts.push(Buffer.from(options.after));
  return new Uint8Array(Buffer.concat(parts));
}

/** A stream object with the given (already encoded) data and dictionary entries. */
export function streamObject(dictionary: string, data: Uint8Array): Uint8Array {
  return new Uint8Array(Buffer.concat([latin1(`<< ${dictionary} /Length ${data.length} >>\nstream\n`), Buffer.from(data), latin1("\nendstream")]));
}

/** An object stream (/Type /ObjStm) holding the given objects, Flate-compressed. */
export function objectStream(members: [number, string][], options: { compress?: boolean } = {}): Uint8Array {
  let offset = 0;
  const index: string[] = [];
  const bodies: string[] = [];
  for (const [number, body] of members) {
    index.push(`${number} ${offset}`);
    bodies.push(body);
    offset += body.length + 1;
  }
  const header = `${index.join(" ")}\n`;
  const raw = latin1(header + bodies.join("\n"));
  const data = options.compress === false ? raw : deflateSync(raw);
  return streamObject(`/Type /ObjStm /N ${members.length} /First ${header.length}${options.compress === false ? "" : " /Filter /FlateDecode"}`, data);
}

/** A string of the EICAR anti-virus test file, assembled at run time (never stored whole). */
export function eicar(): string {
  return ["X5O!P%@AP[4\\PZX54(P^)7CC)7}", "$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!", "$H+H*"].join("");
}
