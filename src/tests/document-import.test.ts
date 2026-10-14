import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ApiError, checkConnection, ConfigProblem, createSupabaseApi, type SupabaseApi, type UploadOutcome } from "../../workers/import/api.ts";
import { assessCompleteness, type Expected, type Stored } from "../../workers/import/completeness.ts";
import { checkImport, directoryFolder, runImport, type ImportFolder } from "../../workers/import/importer.ts";
import { emptyJournal, fileJournal, JOURNAL_FILE, memoryJournal, validateJournal } from "../../workers/import/journal.ts";
import { detectDelimiter, documentTypeKey, isPlainFileName, MANIFEST_FILE, parseCsv, parseManifest } from "../../workers/import/manifest.ts";
import { renderCheck } from "../../workers/import/report.ts";

/**
 * Beta L3 — the administrator's document import (workers/import, docs/beta.md §15): the import
 * list, the proof of completeness, the API client's boundaries and the resumable, idempotent
 * upload. End to end against the local stack: src/tests/integration/document-import.integration.test.ts;
 * in the real Docker configuration: src/tests/integration/import-docker.integration.test.ts.
 */

const PRODUCT = "00000000-0000-4000-a000-000000000301";
const RETIRED = "00000000-0000-4000-a000-000000000309";
const DOCUMENT = "00000000-0000-4000-a000-0000000004d1";
const HEADER = "fil;produkt_id;dokumenttype;titel;version;gyldig_fra;gyldig_til;sider";
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const pdf = (marker: string) => new TextEncoder().encode(`%PDF-1.7\n% ${marker}\n%%EOF\n`);

describe("the import list (manifest.ts)", () => {
  it("reads Danish Excel (semicolon, BOM, CRLF) and plain CSV (comma, quotes) alike", () => {
    expect(detectDelimiter("fil;version")).toBe(";");
    expect(detectDelimiter("fil,version")).toBe(",");
    expect(parseCsv('a,"b ""c"", d"\r\n\r\n1,2\n', ",")).toEqual([["a", 'b "c", d'], ["1", "2"]]);
    expect(parseCsv("a;b\n;;\n", ";")).toEqual([["a", "b"]]);
    expect(() => parseCsv('a,"b', ",")).toThrow();

    const excel = `﻿${HEADER}\r\nvilkaar.pdf;${PRODUCT};Betingelser;Vilkår A;2026-01;2026-01-01;;32\r\n`;
    const plain = `fil,produkt_id,dokumenttype,titel,version,gyldig_fra\n"vilkaar.pdf",${PRODUCT},terms,"Vilkår A",2026-01,2026-01-01\n`;
    const a = parseManifest(excel);
    const b = parseManifest(plain);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.problems).toEqual([]);
    expect(a.rows[0]).toEqual({
      line: 2, file: "vilkaar.pdf", documentId: null,
      newDocument: { productId: PRODUCT, documentType: "terms", title: "Vilkår A" },
      versionLabel: "2026-01", validFrom: "2026-01-01", validTo: null, language: "da", expectedPages: 32,
    });
    expect({ ...b.rows[0], expectedPages: 32 }).toEqual(a.rows[0]);
  });

  it("matches a document type only by its key or its exact Danish name — nothing is guessed", () => {
    expect(documentTypeKey("terms")).toBe("terms");
    expect(documentTypeKey("Betingelser")).toBe("terms");
    expect(documentTypeKey("betingelser ")).toBe("terms");
    expect(documentTypeKey("Policetekst")).toBe("policy_text");
    for (const near of ["Betingelse", "vilkår", "term", "policy", ""]) expect(documentTypeKey(near), near).toBeNull();
  });

  it("refuses a list it cannot read reliably: unknown, duplicate or missing columns, a company column, not UTF-8, too many rows", () => {
    const refuse = (text: string) => {
      const result = parseManifest(text);
      expect(result.ok).toBe(false);
      return result.ok ? [] : result.errors.join(" ");
    };
    expect(refuse(`${HEADER};selskab\n`)).toMatch(/selskab.*understøttes ikke.*datamodellen/);
    expect(refuse(`${HEADER};udgiver\n`)).toMatch(/udgiver.*understøttes ikke/);
    expect(refuse(`${HEADER};kommentar\n`)).toMatch(/Ukendte kolonner: kommentar/);
    expect(refuse(`${HEADER};fil\n`)).toMatch(/fil står flere gange/);
    expect(refuse("fil;produkt_id;titel\n")).toMatch(/Påkrævede kolonner mangler: version, gyldig_fra/);
    expect(refuse(`${HEADER}\nvilk�r.pdf\n`)).toMatch(/UTF-8/);
    expect(refuse("")).toMatch(/tom/);
    expect(refuse(`${HEADER}\n${"a.pdf;;;;;;;\n".repeat(501)}`)).toMatch(/flere end 500/);
  });

  it("refuses each incomplete or contradictory row with its own reasons — the other rows stay usable", () => {
    const rows = [
      `ok.pdf;${PRODUCT};terms;OK;1;2026-01-01;;`,
      `;${PRODUCT};terms;Ingen fil;1;2026-01-01;;`,
      `../hemmelig.pdf;${PRODUCT};terms;Sti;1;2026-01-01;;`,
      `.skjult.pdf;${PRODUCT};terms;Skjult;1;2026-01-01;;`,
      `vilkaar.docx;${PRODUCT};terms;Word;1;2026-01-01;;`,
      `ok.pdf;${PRODUCT};terms;Dublet;1;2026-01-01;;`,
      `b.pdf;ikke-et-id;terms;Produkt;1;2026-01-01;;`,
      `c.pdf;${PRODUCT};vilkår;Type;1;2026-01-01;;`,
      `d.pdf;${PRODUCT};terms;;1;2026-01-01;;`,
      `e.pdf;${PRODUCT};terms;Version;;2026-01-01;;`,
      `f.pdf;${PRODUCT};terms;Gyldighed;1;;;`,
      `g.pdf;${PRODUCT};terms;Dansk dato;1;01-01-2026;;`,
      `h.pdf;${PRODUCT};terms;Omvendt;1;2026-06-01;2026-01-01;`,
      `i.pdf;${PRODUCT};terms;Sider;1;2026-01-01;;0`,
      `j.pdf;${PRODUCT};terms;Sider;1;2026-01-01;;tolv`,
      `k.pdf;${PRODUCT};terms;Felter;1;2026-01-01;;;ekstra`,
    ];
    const result = parseManifest(`${HEADER}\n${rows.join("\n")}\n`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows.map((row) => row.file)).toEqual(["ok.pdf"]);
    const reasons = Object.fromEntries(result.problems.map((problem) => [problem.line, problem.errors.join(" ")]));
    expect(reasons[3]).toMatch(/Filnavn mangler/);
    expect(reasons[4]).toMatch(/uden mappe/);
    expect(reasons[5]).toMatch(/uden mappe/);
    expect(reasons[6]).toMatch(/uden mappe, slutter på \.pdf/);
    expect(reasons[7]).toMatch(/står også i række 2/);
    expect(reasons[8]).toMatch(/produkt_id er ikke et gyldigt id/);
    expect(reasons[9]).toMatch(/Dokumenttypen "vilkår" findes ikke/);
    expect(reasons[10]).toMatch(/titel mangler/);
    expect(reasons[11]).toMatch(/version mangler/);
    expect(reasons[12]).toMatch(/gyldig_fra mangler/);
    expect(reasons[13]).toMatch(/ÅÅÅÅ-MM-DD/);
    expect(reasons[14]).toMatch(/gyldig_til skal ligge efter gyldig_fra/);
    expect(reasons[15]).toMatch(/sider skal være et helt tal/);
    expect(reasons[16]).toMatch(/sider skal være et helt tal/);
    expect(reasons[17]).toMatch(/flere felter end overskriften/);
  });

  it("a new version of an existing document names only the document — never also a product, type or title", () => {
    const header = "fil;dokument_id;produkt_id;version;gyldig_fra";
    const result = parseManifest(`${header}\nny.pdf;${DOCUMENT};;2027;2027-01-01\nbegge.pdf;${DOCUMENT};${PRODUCT};2027;2027-01-01\nforkert.pdf;123;;2027;2027-01-01\n`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toEqual([expect.objectContaining({ file: "ny.pdf", documentId: DOCUMENT, newDocument: null })]);
    expect(result.problems.map((problem) => problem.errors.join(" "))).toEqual([expect.stringMatching(/ikke begge/), expect.stringMatching(/dokument_id er ikke et gyldigt id/)]);
  });

  it("a file name is a plain PDF name in the import folder", () => {
    for (const name of ["vilkår 2026.pdf", "A.PDF", "x.pdf"]) expect(isPlainFileName(name), name).toBe(true);
    for (const name of ["", "a/b.pdf", "a\\b.pdf", "../a.pdf", ".a.pdf", "a.pdf.exe", "a\u0007.pdf", " a.pdf", `${"a".repeat(252)}.pdf`]) {
      expect(isPlainFileName(name), JSON.stringify(name)).toBe(false);
    }
    expect(MANIFEST_FILE).toBe("importliste.csv");
  });
});

describe("the proof of completeness (completeness.ts)", () => {
  const SHA = "a".repeat(64);
  const expected: Expected = {
    sha256: SHA, productId: PRODUCT, documentType: "terms", title: "Vilkår", documentId: null,
    versionLabel: "1", validFrom: "2026-01-01", validTo: null, language: "da", originalFilename: "v.pdf", expectedPages: 3,
  };
  const stored: Stored = {
    versionChecksum: SHA, storageBucket: "knowledge-originals", securityState: "released", pageCount: 3,
    documentId: DOCUMENT, productId: PRODUCT, documentType: "terms", title: "Vilkår", versionLabel: "1", validFrom: "2026-01-01", validTo: null,
    language: "da", originalFilename: "v.pdf", originalSha256: SHA,
    pages: [1, 2, 3].map((page) => ({ page_number: page, has_text_layer: true, char_start: (page - 1) * 100, char_end: page * 100 - 2 })),
    chunks: [
      { chunk_index: 0, page_start: 1, page_end: 1, char_start: 0, char_end: 90 },
      { chunk_index: 1, page_start: 1, page_end: 2, char_start: 80, char_end: 190 },
      { chunk_index: 2, page_start: 3, page_end: 3, char_start: 200, char_end: 298 },
    ],
  };

  it("a released version with every page, its text in order and its identity is complete", () => {
    expect(assessCompleteness(expected, stored)).toEqual({ complete: true, problems: [], pages: 3, pagesWithText: 3, chunks: 3, originalMatches: true, characters: 298 });
  });

  it("is NOT complete when anything is missing, changed or out of order — each says why", () => {
    const cases: [Partial<Stored>, Partial<Expected>, RegExp][] = [
      [{ securityState: "quarantined" }, {}, /ikke frigivet/],
      [{ storageBucket: "knowledge-intake" }, {}, /ikke frigivet/],
      [{ originalSha256: "b".repeat(64) }, {}, /gemte original er ikke den importerede fil/],
      [{ originalSha256: null }, {}, /kunne ikke hentes/],
      [{ versionChecksum: "b".repeat(64) }, {}, /registrerede kontrolsum/],
      [{ pageCount: 4 }, {}, /Ikke alle sider er gemt \(3 af 4\)/],
      [{ pages: stored.pages.slice(0, 2), pageCount: 3 }, {}, /Ikke alle sider er gemt \(2 af 3\)/],
      [{ pages: [stored.pages[0]!, { ...stored.pages[1]!, page_number: 3 }, { ...stored.pages[2]!, page_number: 4 }] }, {}, /Ikke alle sider er gemt/],
      [{ pages: stored.pages.map((page) => (page.page_number === 2 ? { ...page, has_text_layer: false } : page)) }, {}, /Sider uden tekstlag: 2/],
      [{ pageCount: 0, pages: [], chunks: [] }, { expectedPages: null }, /Sideantallet er ukendt/],
      [{}, { expectedPages: 4 }, /3 sider, men importlisten siger 4/],
      [{ pages: [stored.pages[0]!, { ...stored.pages[1]!, char_start: 10 }, stored.pages[2]!] }, {}, /side 2 ligger ikke i dokumentets rækkefølge/],
      [{ chunks: [] }, {}, /ingen tekstsegmenter/],
      [{ chunks: [stored.chunks[0]!, { ...stored.chunks[2]!, chunk_index: 2 }] }, {}, /ikke fortløbende/],
      [{ chunks: [stored.chunks[0]!, { ...stored.chunks[2]!, chunk_index: 1 }, { ...stored.chunks[1]!, chunk_index: 2 }] }, {}, /følger ikke dokumentets rækkefølge/],
      [{ chunks: [stored.chunks[0]!, { ...stored.chunks[1]!, page_end: 1 }, stored.chunks[2]!] }, {}, /Sider uden tekstsegment: 2/],
      [{ chunks: [...stored.chunks, { chunk_index: 3, page_start: 3, page_end: 5, char_start: 250, char_end: 300 }] }, {}, /uden for dokumentets sider/],
      [{ productId: "00000000-0000-4000-a000-000000000302" }, {}, /andet produkt/],
      [{ documentType: "guidance" }, {}, /Dokumenttypen/],
      [{ title: "Andet" }, {}, /Titlen/],
      [{}, { documentId: "00000000-0000-4000-a000-0000000004d2" }, /andet dokument/],
      [{ versionLabel: "2" }, {}, /Versionsbetegnelsen/],
      [{ validTo: "2027-01-01" }, {}, /Gyldigheden/],
      [{ language: "en" }, {}, /Sproget/],
      [{ originalFilename: "andet.pdf" }, {}, /Filnavnet/],
    ];
    for (const [storedChange, expectedChange, problem] of cases) {
      const result = assessCompleteness({ ...expected, ...expectedChange }, { ...stored, ...storedChange });
      expect(result.complete, String(problem)).toBe(false);
      expect(result.problems.join(" "), String(problem)).toMatch(problem);
    }
  });

  it("a page whose only text was a removed header or footer needs no text segment", () => {
    const pages = stored.pages.map((page) => (page.page_number === 3 ? { ...page, char_start: 198, char_end: 198 } : page));
    expect(assessCompleteness(expected, { ...stored, pages, chunks: stored.chunks.slice(0, 2) }).complete).toBe(true);
  });
});

describe("the importer's way into the platform (api.ts)", () => {
  const anon = (role: string) => `x.${Buffer.from(JSON.stringify({ role })).toString("base64url")}.y`;

  it("uses only the public key and the operator's own login — a service-role or secret key is refused", () => {
    expect(() => checkConnection({ url: "https://p.supabase.co", publishableKey: anon("anon"), allowHttp: false })).not.toThrow();
    expect(() => checkConnection({ url: "https://p.supabase.co", publishableKey: "sb_publishable_abc", allowHttp: false })).not.toThrow();
    for (const key of [anon("service_role"), "sb_secret_abc"]) {
      expect(() => checkConnection({ url: "https://p.supabase.co", publishableKey: key, allowHttp: false })).toThrow(/service_role/);
    }
    expect(() => checkConnection({ url: "https://p.supabase.co", publishableKey: anon("authenticated"), allowHttp: false })).toThrow(ConfigProblem);
    expect(() => checkConnection({ url: "https://p.supabase.co", publishableKey: "", allowHttp: false })).toThrow(/mangler/);
  });

  it("requires https (http only for local/test) and a URL without credentials or parameters", () => {
    const key = anon("anon");
    expect(() => checkConnection({ url: "http://p.supabase.co", publishableKey: key, allowHttp: false })).toThrow(/https/);
    expect(() => checkConnection({ url: "http://127.0.0.1:54321", publishableKey: key, allowHttp: true })).not.toThrow();
    for (const url of ["https://u:p@p.supabase.co", "https://p.supabase.co?x=1", "https://p.supabase.co#a", "ikke en url"]) {
      expect(() => checkConnection({ url, publishableKey: key, allowHttp: false }), url).toThrow(ConfigProblem);
    }
  });

  it("never puts the password, the token or the key into an error — and signs out at the end", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const secret = "hemmelig-adgangskode-123";
    const token = "TOKEN-abcdef";
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      if (url.includes("grant_type=password")) {
        const body = JSON.parse(String(init.body)) as { password: string };
        return body.password === secret
          ? Response.json({ access_token: token, refresh_token: "R", expires_in: 3600 })
          : Response.json({ error_description: `invalid login for ${body.password}` }, { status: 400 });
      }
      if (url.includes("/rest/v1/rpc/register_upload")) return Response.json({ message: "Ingen adgang", code: "42501" }, { status: 403 });
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;
    const api = createSupabaseApi({ url: "https://p.supabase.co", publishableKey: anon("anon"), allowHttp: false, fetchImpl });
    const wrong = await api.signIn("a@b.dk", "forkert").catch((error: unknown) => error as ApiError);
    expect(wrong).toBeInstanceOf(ApiError);
    expect((wrong as ApiError).message).toBe("Login mislykkedes: e-mail eller adgangskode er forkert.");
    await api.signIn("a@b.dk", secret);
    const refused = await api.rpc("knowledge", "register_upload", {}).catch((error: unknown) => error as ApiError);
    expect(refused).toMatchObject({ status: 403, code: "42501", message: "Ingen adgang" });
    for (const error of [wrong, refused]) expect(JSON.stringify({ message: (error as Error).message, ...(error as object) })).not.toMatch(new RegExp(`${secret}|${token}|role`));
    const rpc = calls.find((call) => call.url.endsWith("/rest/v1/rpc/register_upload"))!;
    expect((rpc.init.headers as Record<string, string>)["content-profile"]).toBe("knowledge");
    expect(rpc.init.redirect).toBe("error");
    await api.signOut();
    expect(calls.at(-1)!.url).toBe("https://p.supabase.co/auth/v1/logout?scope=local");
  });

  it("refreshes a long import's session before the token expires", async () => {
    let clock = 0;
    const grants: string[] = [];
    const fetchImpl = (async (url: string) => {
      const grant = /grant_type=(\w+)/.exec(url)?.[1];
      if (grant) {
        grants.push(grant);
        return Response.json({ access_token: `T${grants.length}`, refresh_token: `R${grants.length}`, expires_in: 3600 });
      }
      return Response.json([]);
    }) as unknown as typeof fetch;
    const api = createSupabaseApi({ url: "https://p.supabase.co", publishableKey: anon("anon"), allowHttp: false, fetchImpl, now: () => clock });
    await api.signIn("a@b.dk", "x");
    await api.select("knowledge", "products", "select=id");
    clock = 3_500_000;
    await api.select("knowledge", "products", "select=id");
    expect(grants).toEqual(["password", "refresh_token"]);
  });

  it("an upload never overwrites: an existing object is reported, not replaced", async () => {
    let headers: Record<string, string> = {};
    const fetchImpl = (async (url: string, init: RequestInit) => {
      if (url.includes("grant_type")) return Response.json({ access_token: "T", refresh_token: "R", expires_in: 3600 });
      headers = init.headers as Record<string, string>;
      return Response.json({ statusCode: "409", error: "Duplicate", message: "The resource already exists" }, { status: 400 });
    }) as unknown as typeof fetch;
    const api = createSupabaseApi({ url: "https://p.supabase.co", publishableKey: anon("anon"), allowHttp: false, fetchImpl });
    await api.signIn("a@b.dk", "x");
    expect(await api.upload("knowledge-intake", "d/v/original.pdf", pdf("a"), "application/pdf")).toEqual({ ok: false, exists: true, status: 400, message: "The resource already exists" });
    expect(headers["x-upsert"]).toBe("false");
  });
});

// ---------------------------------------------------------------------------------------------
// The upload, against an in-memory platform that behaves like the database functions.
// ---------------------------------------------------------------------------------------------

interface FakeVersion { id: string; documentId: string; checksum: string; status: string }

function fakePlatform(options: { failRegisterOnce?: boolean; failUploadOnce?: boolean } = {}) {
  const objects = new Map<string, Uint8Array>();
  const versions: FakeVersion[] = [];
  const documents = new Map<string, string>([[DOCUMENT, PRODUCT]]);
  const calls: string[] = [];
  let failRegister = options.failRegisterOnce ?? false;
  let failUpload = options.failUploadOnce ?? false;
  const api: SupabaseApi = {
    async signIn() {},
    async signOut() {},
    async select<T>(_schema: string, table: string, query: string) {
      calls.push(`select ${table}`);
      if (table === "products") return [{ id: PRODUCT, name: "Ansvar", status: "active" }, { id: RETIRED, name: "Gammel", status: "retired" }] as T[];
      if (table === "documents") return [...documents].filter(([id]) => query.includes(id)).map(([id, product]) => ({ id, product_id: product })) as T[];
      return [] as T[];
    },
    async rpc<T>(_schema: string, fn: string, args: Record<string, unknown>) {
      calls.push(fn);
      if (fn === "find_versions_by_checksum") {
        return versions.filter((version) => version.checksum === args.p_checksum_sha256).map((version) => ({ version_id: version.id, document_id: version.documentId, status: version.status })) as T;
      }
      if (fn === "register_upload") {
        if (failRegister) {
          failRegister = false;
          throw new ApiError("forbindelsen blev afbrudt", 0, "TypeError");
        }
        const path = `${args.p_document_id}/${args.p_version_id}/original.pdf`;
        if (!objects.has(path)) throw new ApiError("Filen findes ikke i Storage", 404, "P0002");
        if (args.p_new_document) documents.set(String(args.p_document_id), String((args.p_new_document as { product_id: string }).product_id));
        versions.push({ id: String(args.p_version_id), documentId: String(args.p_document_id), checksum: String(args.p_checksum_sha256), status: "uploaded" });
        return args.p_version_id as T;
      }
      throw new Error(`unexpected ${fn}`);
    },
    async upload(_bucket: string, path: string, bytes: Uint8Array): Promise<UploadOutcome> {
      calls.push("upload");
      if (failUpload) {
        failUpload = false;
        return { ok: false, exists: false, status: 0, message: "afbrudt" };
      }
      if (objects.has(path)) return { ok: false, exists: true, status: 409, message: "exists" };
      objects.set(path, bytes);
      return { ok: true, exists: false, status: 200, message: null };
    },
    async download() {
      throw new Error("not used");
    },
  };
  return { api, objects, versions, calls };
}

function memoryFolder(files: Record<string, Uint8Array>, manifest: string): ImportFolder & { files: Record<string, Uint8Array> } {
  return {
    files,
    async readManifest() {
      return manifest;
    },
    async listPdfs() {
      return Object.keys(files).sort();
    },
    async readPdf(name: string) {
      const bytes = files[name];
      return bytes ? { ok: true as const, bytes } : { ok: false as const, error: "Filen findes ikke i importmappen." };
    },
  };
}

const manifestOf = (...rows: string[]) => `${HEADER}\n${rows.join("\n")}\n`;
const row = (file: string, title = file, product = PRODUCT) => `${file};${product};terms;${title};1;2026-01-01;;`;
let ids = 0;
const newId = () => `00000000-0000-4000-b000-${String(++ids).padStart(12, "0")}`;

describe("kontroller and upload (importer.ts)", () => {
  it("checks every row against the data model and changes nothing", async () => {
    const platform = fakePlatform();
    const folder = memoryFolder({ "a.pdf": pdf("a"), "b.pdf": pdf("a"), "c.pdf": pdf("c"), "d.pdf": pdf("d"), "løs.pdf": pdf("løs") }, manifestOf(
      row("a.pdf"),
      row("b.pdf"),
      row("c.pdf", "c", RETIRED),
      row("d.pdf", "d", "00000000-0000-4000-a000-000000000399"),
      row("mangler.pdf"),
    ));
    const result = await checkImport({ api: platform.api, folder, journal: memoryJournal() });
    expect(result.rows.map((r) => [r.line, r.outcome])).toEqual([[2, "ready"], [3, "invalid"], [4, "invalid"], [5, "invalid"], [6, "invalid"]]);
    const reasons = result.rows.map((r) => r.messages.join(" "));
    expect(reasons[1]).toMatch(/samme som i række 2 \(samme SHA-256\)/);
    expect(reasons[2]).toMatch(/"Gammel" er udgået/);
    expect(reasons[3]).toMatch(/Produktet findes ikke/);
    expect(reasons[4]).toMatch(/findes ikke i importmappen/);
    expect(result.unlisted).toEqual(["løs.pdf"]);
    expect(platform.calls).not.toContain("upload");
    expect(platform.calls).not.toContain("register_upload");
    expect(renderCheck("Kontrol", result, new Date(0))).toMatch(/PDF'er i importmappen, som ikke står på importlisten[\s\S]*løs\.pdf/);
  });

  it("uploads to quarantine and registers through register_upload — the journal is written before anything is sent", async () => {
    const platform = fakePlatform();
    const journal = memoryJournal();
    const folder = memoryFolder({ "a.pdf": pdf("a"), "b.pdf": pdf("b") }, manifestOf(row("a.pdf"), row("b.pdf")));
    const result = await runImport({ api: platform.api, folder, journal, newId });
    expect(result.rows.map((r) => r.outcome)).toEqual(["imported", "imported"]);
    expect(platform.versions.map((version) => version.checksum).sort()).toEqual([sha(pdf("a")), sha(pdf("b"))].sort());
    expect([...platform.objects.keys()].every((key) => /^[0-9a-f-]{36}\/[0-9a-f-]{36}\/original\.pdf$/.test(key))).toBe(true);
    expect(Object.values(journal.current().entries).map((entry) => entry.stage)).toEqual(["registered", "registered"]);
    // Order per file: duplicate check, upload, registration.
    expect(platform.calls.filter((call) => ["find_versions_by_checksum", "upload", "register_upload"].includes(call))).toEqual([
      "find_versions_by_checksum", "find_versions_by_checksum", "upload", "register_upload", "upload", "register_upload",
    ]);
  });

  it("a repeated import sends nothing: every file is found by its SHA-256", async () => {
    const platform = fakePlatform();
    const folder = memoryFolder({ "a.pdf": pdf("a") }, manifestOf(row("a.pdf")));
    await runImport({ api: platform.api, folder, journal: memoryJournal(), newId });
    platform.calls.length = 0;
    // Even with the journal gone.
    const again = await runImport({ api: platform.api, folder, journal: memoryJournal(), newId });
    expect(again.rows.map((r) => r.outcome)).toEqual(["exists"]);
    expect(platform.calls).not.toContain("upload");
    expect(platform.calls).not.toContain("register_upload");
    expect(platform.versions).toHaveLength(1);
  });

  it("an import interrupted after the upload resumes with the same ids — no second copy", async () => {
    const platform = fakePlatform({ failRegisterOnce: true });
    const journal = memoryJournal();
    const folder = memoryFolder({ "a.pdf": pdf("a") }, manifestOf(row("a.pdf")));
    const first = await runImport({ api: platform.api, folder, journal, newId });
    expect(first.rows[0]).toMatchObject({ outcome: "failed", messages: [expect.stringMatching(/genoptage/)] });
    const entry = journal.current().entries[sha(pdf("a"))]!;
    expect(entry.stage).toBe("uploaded");
    expect(platform.versions).toHaveLength(0);

    const second = await runImport({ api: platform.api, folder, journal, newId });
    expect(second.rows[0]).toMatchObject({ outcome: "imported", versionId: entry.versionId, documentId: entry.documentId });
    expect(platform.objects.size).toBe(1);
    expect(platform.versions).toEqual([expect.objectContaining({ id: entry.versionId })]);
  });

  it("an upload that failed is retried with the ids already reserved; a changed file is not uploaded", async () => {
    const platform = fakePlatform({ failUploadOnce: true });
    const journal = memoryJournal();
    const folder = memoryFolder({ "a.pdf": pdf("a") }, manifestOf(row("a.pdf")));
    expect((await runImport({ api: platform.api, folder, journal, newId })).rows[0]!.outcome).toBe("failed");
    const reserved = journal.current().entries[sha(pdf("a"))]!;
    expect(reserved.stage).toBe("reserved");
    expect((await runImport({ api: platform.api, folder, journal, newId })).rows[0]).toMatchObject({ outcome: "imported", versionId: reserved.versionId });

    // The file changes between the check and the upload: nothing is sent.
    const changing = fakePlatform();
    let reads = 0;
    const flaky: ImportFolder = {
      ...memoryFolder({ "b.pdf": pdf("b") }, manifestOf(row("b.pdf"))),
      async readPdf() {
        reads += 1;
        return { ok: true, bytes: reads === 1 ? pdf("b") : pdf("ændret") };
      },
    };
    expect((await runImport({ api: changing.api, folder: flaky, journal: memoryJournal(), newId })).rows[0]).toMatchObject({ outcome: "failed", messages: [expect.stringMatching(/ændret/)] });
    expect(changing.calls).not.toContain("upload");
  });

  it("a new version of an existing document is registered under that document", async () => {
    const platform = fakePlatform();
    const folder = memoryFolder({ "ny.pdf": pdf("ny") }, `fil;dokument_id;version;gyldig_fra\nny.pdf;${DOCUMENT};2027;2027-01-01\n`);
    const result = await runImport({ api: platform.api, folder, journal: memoryJournal(), newId });
    expect(result.rows[0]).toMatchObject({ outcome: "imported", documentId: DOCUMENT, productName: "Ansvar" });
    const unknown = memoryFolder({ "x.pdf": pdf("x") }, `fil;dokument_id;version;gyldig_fra\nx.pdf;00000000-0000-4000-a000-0000000004ff;2027;2027-01-01\n`);
    expect((await checkImport({ api: platform.api, folder: unknown, journal: memoryJournal() })).rows[0]).toMatchObject({ outcome: "invalid", messages: ["Dokumentet (dokument_id) findes ikke."] });
  });
});

describe("files and the journal on disk", () => {
  let directory = "";
  afterEach(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it("reads only plain files in the import folder — never a link, a folder or a file elsewhere", async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "ipa-import-"));
    await writeFile(path.join(directory, "a.pdf"), pdf("a"));
    await writeFile(path.join(directory, "tom.pdf"), "");
    await writeFile(path.join(directory, MANIFEST_FILE), "fil\n");
    await symlink(path.join(directory, "a.pdf"), path.join(directory, "link.pdf"));
    const folder = directoryFolder(directory);
    expect(await folder.readPdf("a.pdf")).toEqual({ ok: true, bytes: pdf("a") });
    expect(await folder.readPdf("link.pdf")).toMatchObject({ ok: false, error: expect.stringMatching(/ikke en almindelig fil/) });
    expect(await folder.readPdf("tom.pdf")).toMatchObject({ ok: false, error: "Filen er tom." });
    expect(await folder.readPdf("../a.pdf")).toMatchObject({ ok: false, error: "Filen ligger ikke i importmappen." });
    expect(await folder.readPdf("mangler.pdf")).toMatchObject({ ok: false });
    expect(await folder.listPdfs()).toEqual(["a.pdf", "tom.pdf"]);
    expect(await folder.readManifest()).toBe("fil\n");
  });

  it("writes the journal atomically, readable only by the operator, and refuses a damaged one", async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "ipa-journal-"));
    const store = fileJournal(directory);
    expect(await store.read()).toEqual(emptyJournal());
    const entry = { file: "a.pdf", documentId: DOCUMENT, versionId: PRODUCT, newDocument: true, stage: "uploaded" as const, updatedAt: "2026-10-14T00:00:00Z" };
    await store.write({ version: 1, entries: { [sha(pdf("a"))]: entry } });
    expect((await store.read()).entries[sha(pdf("a"))]).toEqual(entry);
    const { mode } = await import("node:fs/promises").then((fs) => fs.stat(path.join(directory, JOURNAL_FILE)));
    expect(mode & 0o777).toBe(0o600);
    expect(await readFile(path.join(directory, JOURNAL_FILE), "utf8")).not.toMatch(/password|token|%PDF/i);
    await writeFile(path.join(directory, JOURNAL_FILE), "{ikke json");
    await expect(store.read()).rejects.toThrow(/ødelagt/);
    for (const bad of [{ version: 2, entries: {} }, { version: 1, entries: { kort: entry } }, { version: 1, entries: { [sha(pdf("a"))]: { ...entry, stage: "published" } } }, { version: 1, entries: { [sha(pdf("a"))]: { ...entry, versionId: "x" } } }]) {
      expect(() => validateJournal(bad)).toThrow(/ødelagt/);
    }
  });
});
