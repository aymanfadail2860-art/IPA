import { createHash } from "node:crypto";

import { FileRejected } from "./types.ts";

/**
 * Step 1 — validation of the original (docs/07 §5.2). Only PDF with a text layer is
 * supported in phase 7 (B-14). The client's Content-Type and checksum are never trusted:
 * magic bytes and SHA-256 are checked here again.
 */

export const LIMITS = {
  maxBytes: 50 * 1024 * 1024,
  maxPages: 2000,
} as const;

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function hasPdfHeader(bytes: Uint8Array): boolean {
  // The PDF header may appear within the first 1024 bytes.
  const head = Buffer.from(bytes.subarray(0, 1024)).toString("latin1");
  return head.includes("%PDF-");
}

/** Encrypted / password-protected PDFs declare /Encrypt in the trailer or xref stream dict. */
export function declaresEncryption(bytes: Uint8Array): boolean {
  const text = Buffer.from(bytes).toString("latin1");
  return /\/Encrypt\s*(?:\d+\s+\d+\s+R|<<)/.test(text);
}

export function validateOriginal(bytes: Uint8Array, declaredChecksum: string): { checksum: string } {
  if (bytes.byteLength === 0) throw new FileRejected("empty", "Filen er tom.");
  if (bytes.byteLength > LIMITS.maxBytes) throw new FileRejected("too_large", "Filen er større end 50 MB.");
  if (!hasPdfHeader(bytes)) throw new FileRejected("not_pdf", "Filen er ikke en PDF. Kun PDF med tekstlag understøttes.");
  const checksum = sha256Hex(bytes);
  if (checksum !== declaredChecksum.toLowerCase()) {
    throw new FileRejected("checksum_mismatch", "Filen svarer ikke til den uploadede fil (kontrolsummen afviger).");
  }
  if (declaresEncryption(bytes)) {
    throw new FileRejected("encrypted", "PDF'en er krypteret eller beskyttet med adgangskode og kan ikke læses.");
  }
  return { checksum };
}
