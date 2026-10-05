import { createHash } from "node:crypto";

import type { SecurityLimits } from "./limits.ts";

/**
 * Structural validation of the file BEFORE any parser or scanner sees it (docs/08b §21.6):
 * byte-level checks only. The extension and the browser-sent MIME type are recorded at upload
 * but never trusted alone — the content must also be a PDF from its first byte.
 */

export type StructuralCode = "invalid_file_type" | "extension_mismatch" | "mime_mismatch" | "polyglot" | "invalid_pdf" | "too_large" | "checksum_mismatch";

export interface StructuralResult {
  result: "pass" | "fail";
  code?: StructuralCode;
  detectedMime: string;
  checksum: string;
}

const SIGNATURES: [string, number[]][] = [
  ["application/zip", [0x50, 0x4b, 0x03, 0x04]],
  ["application/x-msdownload", [0x4d, 0x5a]],
  ["application/x-elf", [0x7f, 0x45, 0x4c, 0x46]],
  ["image/png", [0x89, 0x50, 0x4e, 0x47]],
  ["image/jpeg", [0xff, 0xd8, 0xff]],
  ["image/gif", [0x47, 0x49, 0x46, 0x38]],
  ["application/x-ole-storage", [0xd0, 0xcf, 0x11, 0xe0]],
  ["application/x-rar", [0x52, 0x61, 0x72, 0x21]],
  ["application/x-7z-compressed", [0x37, 0x7a, 0xbc, 0xaf]],
  ["application/gzip", [0x1f, 0x8b]],
  ["text/html", [0x3c, 0x21, 0x44, 0x4f, 0x43]],
];
const PDF_HEADER = /^%PDF-(1\.[0-7]|2\.0)[\r\n %]/;

export function detectMime(bytes: Uint8Array): string {
  if (PDF_HEADER.test(String.fromCharCode(...bytes.subarray(0, 16)))) return "application/pdf";
  for (const [mime, signature] of SIGNATURES) if (signature.every((byte, i) => bytes[i] === byte)) return mime;
  return "application/octet-stream";
}

export function checkFile(
  bytes: Uint8Array,
  declared: { checksum: string; byteSize: number | null; mime: string | null; filename: string | null },
  limits: SecurityLimits,
): StructuralResult {
  const checksum = createHash("sha256").update(bytes).digest("hex");
  const detectedMime = detectMime(bytes);
  const fail = (code: StructuralCode): StructuralResult => ({ result: "fail", code, detectedMime, checksum });

  if (bytes.byteLength > limits.maxBytes) return fail("too_large");
  // The bytes must be exactly the ones the upload registered.
  if (checksum !== declared.checksum || (declared.byteSize !== null && declared.byteSize !== bytes.byteLength)) return fail("checksum_mismatch");
  if (detectedMime !== "application/pdf") return fail("invalid_file_type");
  if (!declared.filename || !/\.pdf$/i.test(declared.filename)) return fail("extension_mismatch");
  if (declared.mime !== "application/pdf") return fail("mime_mismatch");
  // A PDF ends with %%EOF; anything but whitespace after the LAST %%EOF is another file glued on
  // (a polyglot). A header at byte 0 rules out a prefix.
  const tail = Buffer.from(bytes.subarray(Math.max(0, bytes.byteLength - 4096)));
  const eof = tail.lastIndexOf("%%EOF");
  if (eof < 0) return fail("invalid_pdf");
  if (!/^[\s\0]*$/.test(tail.subarray(eof + 5).toString("latin1"))) return fail("polyglot");
  return { result: "pass", detectedMime, checksum };
}
