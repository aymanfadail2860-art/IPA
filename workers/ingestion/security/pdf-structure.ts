import { inflateSync } from "node:zlib";

import type { SecurityLimits } from "./limits.ts";

/**
 * A strict, structure-based reader of PDF object syntax (docs/08b §21.6). It is the PDF
 * security inspection's own reader: an unscanned file never reaches pdfjs (or any other
 * document parser of the pipeline) before its verdict is safe.
 *
 * It reads the file as PDF objects (ISO 32000: dictionaries, arrays, names with #xx escapes,
 * strings, numbers, references and streams), decompresses object streams (FlateDecode only,
 * bounded) and returns every dictionary — never a raw byte search. Anything it cannot read
 * reliably is an error: fail closed. Every in-use entry of a classic cross-reference table must
 * point exactly at the object it names, so a reader that follows the table cannot be led to an
 * object this reader did not see (e.g. one hidden inside a stream).
 *
 * It never executes, renders or interprets content; content streams are skipped.
 */

export type PdfValue =
  | { t: "dict"; v: Map<string, PdfValue>; stream?: { start: number; end: number } }
  | { t: "array"; v: PdfValue[] }
  | { t: "name"; v: string }
  | { t: "str" }
  | { t: "num"; v: number }
  | { t: "bool" }
  | { t: "null" }
  | { t: "ref"; n: number; g: number };

export type StructureErrorCode = "invalid_pdf" | "encrypted_pdf" | "too_many_objects" | "resource_limit";

export class PdfStructureError extends Error {
  readonly code: StructureErrorCode;
  constructor(code: StructureErrorCode, message: string) {
    super(message);
    this.name = "PdfStructureError";
    this.code = code;
  }
}

export interface PdfStructure {
  /** Object number → value (the last definition wins, as in incremental updates). */
  objects: Map<number, PdfValue>;
  /** Trailer dictionaries (classic trailers and cross-reference stream dictionaries). */
  trailers: Map<string, PdfValue>[];
  /** Every dictionary found anywhere (objects, object streams, trailers). */
  dictionaries: Map<string, PdfValue>[];
}

const WHITE = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20]);
const DELIM = new Set([0x28, 0x29, 0x3c, 0x3e, 0x5b, 0x5d, 0x7b, 0x7d, 0x2f, 0x25]);
const isDigit = (c: number) => c >= 0x30 && c <= 0x39;

class Lexer {
  i = 0;
  readonly b: Uint8Array;
  readonly limits: SecurityLimits;
  constructor(b: Uint8Array, limits: SecurityLimits) {
    this.b = b;
    this.limits = limits;
  }

  fail(message: string): never {
    throw new PdfStructureError("invalid_pdf", `${message} (byte ${this.i})`);
  }

  skipWs(): void {
    const b = this.b;
    while (this.i < b.length) {
      const c = b[this.i]!;
      if (WHITE.has(c)) this.i += 1;
      else if (c === 0x25) {
        while (this.i < b.length && b[this.i] !== 0x0a && b[this.i] !== 0x0d) this.i += 1;
      } else break;
    }
  }

  startsWith(word: string): boolean {
    for (let k = 0; k < word.length; k += 1) if (this.b[this.i + k] !== word.charCodeAt(k)) return false;
    const after = this.b[this.i + word.length];
    return after === undefined || WHITE.has(after) || DELIM.has(after);
  }

  regular(): string {
    const start = this.i;
    while (this.i < this.b.length && !WHITE.has(this.b[this.i]!) && !DELIM.has(this.b[this.i]!)) this.i += 1;
    return String.fromCharCode(...this.b.subarray(start, Math.min(this.i, start + 256)));
  }

  name(): PdfValue {
    this.i += 1; // "/"
    const raw = this.regular();
    // #xx escapes (ISO 32000 §7.3.5): /J#61vaScript is /JavaScript.
    const decoded = raw.replace(/#([0-9A-Fa-f]{2})/g, (_m, hex: string) => String.fromCharCode(parseInt(hex, 16)));
    if (/#(?![0-9A-Fa-f]{2})/.test(raw)) this.fail("Ugyldigt navn");
    return { t: "name", v: decoded };
  }

  literalString(): PdfValue {
    let depth = 0;
    const b = this.b;
    for (; this.i < b.length; this.i += 1) {
      const c = b[this.i]!;
      if (c === 0x5c) this.i += 1;
      else if (c === 0x28) depth += 1;
      else if (c === 0x29) {
        depth -= 1;
        if (depth === 0) {
          this.i += 1;
          return { t: "str" };
        }
      }
    }
    return this.fail("Uafsluttet streng");
  }

  hexString(): PdfValue {
    this.i += 1;
    while (this.i < this.b.length && this.b[this.i] !== 0x3e) {
      const c = this.b[this.i]!;
      if (!WHITE.has(c) && !/[0-9A-Fa-f]/.test(String.fromCharCode(c))) this.fail("Ugyldig hex-streng");
      this.i += 1;
    }
    if (this.i >= this.b.length) this.fail("Uafsluttet hex-streng");
    this.i += 1;
    return { t: "str" };
  }

  number(): number | null {
    const start = this.i;
    if (this.b[this.i] === 0x2b || this.b[this.i] === 0x2d) this.i += 1;
    let digits = 0;
    while (this.i < this.b.length && (isDigit(this.b[this.i]!) || this.b[this.i] === 0x2e)) {
      this.i += 1;
      digits += 1;
    }
    if (digits === 0) {
      this.i = start;
      return null;
    }
    const value = Number(String.fromCharCode(...this.b.subarray(start, this.i)));
    return Number.isFinite(value) ? value : null;
  }

  value(depth: number): PdfValue {
    if (depth > this.limits.maxNestingDepth) throw new PdfStructureError("resource_limit", "For dyb indlejring");
    this.skipWs();
    const b = this.b;
    const c = b[this.i];
    if (c === undefined) return this.fail("Uventet filslut");
    if (c === 0x2f) return this.name();
    if (c === 0x28) return this.literalString();
    if (c === 0x3c && b[this.i + 1] === 0x3c) {
      this.i += 2;
      const map = new Map<string, PdfValue>();
      for (;;) {
        this.skipWs();
        if (b[this.i] === 0x3e && b[this.i + 1] === 0x3e) {
          this.i += 2;
          return { t: "dict", v: map };
        }
        if (b[this.i] !== 0x2f) this.fail("Ugyldig nøgle i dictionary");
        const key = this.name() as { t: "name"; v: string };
        map.set(key.v, this.value(depth + 1));
      }
    }
    if (c === 0x3c) return this.hexString();
    if (c === 0x5b) {
      this.i += 1;
      const items: PdfValue[] = [];
      for (;;) {
        this.skipWs();
        if (b[this.i] === 0x5d) {
          this.i += 1;
          return { t: "array", v: items };
        }
        if (this.i >= b.length) this.fail("Uafsluttet array");
        items.push(this.value(depth + 1));
      }
    }
    if (isDigit(c) || c === 0x2b || c === 0x2d || c === 0x2e) {
      const first = this.number();
      if (first === null) return this.fail("Ugyldigt tal");
      // A reference: "n g R".
      const save = this.i;
      this.skipWs();
      if (Number.isInteger(first) && isDigit(b[this.i] ?? 0)) {
        const second = this.number();
        this.skipWs();
        if (second !== null && Number.isInteger(second) && this.startsWith("R")) {
          this.i += 1;
          return { t: "ref", n: first, g: second };
        }
      }
      this.i = save;
      return { t: "num", v: first };
    }
    if (this.startsWith("true") || this.startsWith("false")) {
      this.regular();
      return { t: "bool" };
    }
    if (this.startsWith("null")) {
      this.regular();
      return { t: "null" };
    }
    return this.fail(`Uventet token "${this.regular().slice(0, 20)}"`);
  }
}

function indexOf(b: Uint8Array, word: string, from: number): number {
  const first = word.charCodeAt(0);
  outer: for (let i = from; i <= b.length - word.length; i += 1) {
    if (b[i] !== first) continue;
    for (let k = 1; k < word.length; k += 1) if (b[i + k] !== word.charCodeAt(k)) continue outer;
    return i;
  }
  return -1;
}

const nameOf = (value: PdfValue | undefined) => (value?.t === "name" ? value.v : null);

/** Reads every object of the file. Throws PdfStructureError for anything it cannot read reliably. */
export function readPdfStructure(bytes: Uint8Array, limits: SecurityLimits): PdfStructure {
  if (bytes.length > limits.maxBytes) throw new PdfStructureError("resource_limit", "Filen er for stor");
  const lexer: Lexer = new Lexer(bytes, limits);
  if (indexOf(bytes, "%PDF-", 0) !== 0) lexer.fail("Ingen PDF-header");
  const objects = new Map<number, PdfValue>();
  const trailers: Map<string, PdfValue>[] = [];
  const dictionaries: Map<string, PdfValue>[] = [];
  /** Byte offset of each top-level "n g obj" header → object number. */
  const starts = new Map<number, number>();
  /** In-use entries of classic xref tables: [object number, offset]. */
  const xrefEntries: [number, number][] = [];
  let count = 0;

  const collect = (value: PdfValue) => {
    if (value.t === "dict") {
      dictionaries.push(value.v);
      for (const entry of value.v.values()) collect(entry);
    } else if (value.t === "array") for (const entry of value.v) collect(entry);
  };

  for (;;) {
    lexer.skipWs();
    if (lexer.i >= bytes.length) break;
    const c = bytes[lexer.i]!;
    if (isDigit(c)) {
      const at = lexer.i;
      const n = lexer.number();
      lexer.skipWs();
      const g = lexer.number();
      lexer.skipWs();
      if (n === null || g === null || !Number.isInteger(n) || !Number.isInteger(g) || !lexer.startsWith("obj")) lexer.fail("Ugyldigt objekthoved");
      lexer.i += 3;
      starts.set(at, n!);
      count += 1;
      if (count > limits.maxObjects) throw new PdfStructureError("too_many_objects", "For mange objekter");
      const value = lexer.value(0);
      lexer.skipWs();
      if (lexer.startsWith("stream")) {
        if (value.t !== "dict") lexer.fail("Stream uden dictionary");
        lexer.i += 6;
        if (bytes[lexer.i] === 0x0d) lexer.i += 1;
        if (bytes[lexer.i] === 0x0a) lexer.i += 1;
        const start = lexer.i;
        const length = value.v.get("Length");
        let end = -1;
        if (length?.t === "num" && Number.isInteger(length.v) && length.v >= 0 && start + length.v <= bytes.length) {
          const probe = new Lexer(bytes, limits);
          probe.i = start + length.v;
          probe.skipWs();
          if (probe.startsWith("endstream")) end = start + length.v;
        }
        if (end < 0) {
          const found = indexOf(bytes, "endstream", start);
          if (found < 0) lexer.fail("Stream uden endstream");
          end = found;
        }
        value.stream = { start, end };
        lexer.i = end;
        lexer.skipWs();
        if (!lexer.startsWith("endstream")) lexer.fail("Mangler endstream");
        lexer.i += 9;
        lexer.skipWs();
      }
      if (!lexer.startsWith("endobj")) lexer.fail("Mangler endobj");
      lexer.i += 6;
      objects.set(n!, value);
      collect(value);
      if (value.t === "dict" && nameOf(value.v.get("Type")) === "XRef") trailers.push(value.v);
      continue;
    }
    if (lexer.startsWith("xref")) {
      const at = indexOf(bytes, "trailer", lexer.i);
      if (at < 0) lexer.fail("xref uden trailer");
      const tokens = Buffer.from(bytes.subarray(lexer.i + 4, at)).toString("latin1").trim().split(/\s+/).filter(Boolean);
      for (let k = 0; k < tokens.length; ) {
        const first = Number(tokens[k]);
        const entries = Number(tokens[k + 1]);
        k += 2;
        if (!/^\d{1,10}$/.test(tokens[k - 2] ?? "") || !/^\d{1,10}$/.test(tokens[k - 1] ?? "")) lexer.fail("Ugyldig xref-tabel");
        if (xrefEntries.length + entries > limits.maxObjects) throw new PdfStructureError("too_many_objects", "For mange objekter");
        for (let e = 0; e < entries; e += 1, k += 3) {
          const [offset, generation, kind] = [tokens[k], tokens[k + 1], tokens[k + 2]];
          if (!/^\d{10}$/.test(offset ?? "") || !/^\d{5}$/.test(generation ?? "") || (kind !== "n" && kind !== "f")) lexer.fail("Ugyldig xref-post");
          if (kind === "n") xrefEntries.push([first + e, Number(offset)]);
        }
      }
      lexer.i = at;
      continue;
    }
    if (lexer.startsWith("trailer")) {
      lexer.i += 7;
      const value = lexer.value(0);
      if (value.t !== "dict") lexer.fail("Ugyldig trailer");
      trailers.push(value.v);
      collect(value);
      continue;
    }
    if (lexer.startsWith("startxref")) {
      lexer.i += 9;
      lexer.skipWs();
      if (lexer.number() === null) lexer.fail("Ugyldig startxref");
      continue;
    }
    lexer.fail("Uventet indhold mellem objekter");
  }
  if (objects.size === 0) lexer.fail("Ingen objekter");
  if (trailers.length === 0) lexer.fail("Ingen trailer");
  for (const [n, offset] of xrefEntries) {
    // Some writers point at the line break before the header; anything else must be exact.
    let at = offset;
    while (at < bytes.length && WHITE.has(bytes[at]!)) at += 1;
    if (starts.get(at) !== n) throw new PdfStructureError("invalid_pdf", "Krydsreferencetabellen peger ikke på objektet");
  }
  // Encryption is refused before anything is decompressed: no password is ever tried.
  if (trailers.some((trailer) => trailer.has("Encrypt"))) throw new PdfStructureError("encrypted_pdf", "Krypteret PDF");

  // Object streams: their objects are dictionaries too (actions can hide there).
  let inflated = 0;
  for (const value of [...objects.values()]) {
    if (value.t !== "dict" || nameOf(value.v.get("Type")) !== "ObjStm" || !value.stream) continue;
    const filter = value.v.get("Filter");
    const filters = filter?.t === "array" ? filter.v.map(nameOf) : filter ? [nameOf(filter)] : [];
    if (filters.some((name) => name !== "FlateDecode") || filters.length > 1 || value.v.has("DecodeParms")) {
      throw new PdfStructureError("invalid_pdf", "Objektstrøm med filter, der ikke kan inspiceres sikkert");
    }
    const raw = bytes.subarray(value.stream.start, value.stream.end);
    let data: Uint8Array;
    if (filters.length === 0) data = raw;
    else {
      const budget = Math.min(limits.maxObjectStreamBytes, limits.maxTotalInflatedBytes - inflated);
      try {
        data = inflateSync(raw, { maxOutputLength: Math.max(1, budget) });
      } catch (error) {
        if ((error as { code?: string }).code === "ERR_BUFFER_TOO_LARGE" || error instanceof RangeError) {
          throw new PdfStructureError("resource_limit", "Objektstrøm for stor udpakket");
        }
        throw new PdfStructureError("invalid_pdf", "Objektstrøm kan ikke udpakkes");
      }
      if (data.length > Math.max(1, raw.length) * limits.maxInflateRatio) throw new PdfStructureError("resource_limit", "Mistænkelig komprimering");
    }
    inflated += data.length;
    if (inflated > limits.maxTotalInflatedBytes) throw new PdfStructureError("resource_limit", "For meget udpakket indhold");
    const n = value.v.get("N");
    const first = value.v.get("First");
    if (n?.t !== "num" || first?.t !== "num" || !Number.isInteger(n.v) || !Number.isInteger(first.v) || n.v < 0 || first.v > data.length) {
      throw new PdfStructureError("invalid_pdf", "Ugyldig objektstrøm");
    }
    count += n.v;
    if (count > limits.maxObjects) throw new PdfStructureError("too_many_objects", "For mange objekter");
    const inner = new Lexer(data, limits);
    const offsets: [number, number][] = [];
    for (let k = 0; k < n.v; k += 1) {
      inner.skipWs();
      const objectNumber = inner.number();
      inner.skipWs();
      const offset = inner.number();
      if (objectNumber === null || offset === null || !Number.isInteger(objectNumber) || !Number.isInteger(offset)) {
        throw new PdfStructureError("invalid_pdf", "Ugyldigt indeks i objektstrøm");
      }
      offsets.push([objectNumber, offset]);
    }
    for (const [objectNumber, offset] of offsets) {
      inner.i = first.v + offset;
      if (inner.i >= data.length) throw new PdfStructureError("invalid_pdf", "Ugyldig position i objektstrøm");
      const member = inner.value(0);
      objects.set(objectNumber, member);
      collect(member);
    }
  }
  return { objects, trailers, dictionaries };
}

export const pdfName = nameOf;
