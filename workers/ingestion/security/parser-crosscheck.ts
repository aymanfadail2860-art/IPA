import { ANNOTATIONS, type Finding } from "./pdf-inspect.ts";

/**
 * Post-release cross-check (docs/08b §21.6). Runs during extraction — i.e. only on bytes whose
 * verdict is safe and released — on pdfjs's OWN view of the document: JavaScript actions,
 * attachments, the open action, XFA and annotations. The security inspection before release
 * reads the structure with its own reader; this closes the gap of a "parser differential" (a
 * file the two readers see differently). Any finding stops the job before chunking and
 * embedding.
 */

export interface ParsedPdf {
  numPages: number;
  isPureXfa?: boolean;
  getJSActions(): Promise<unknown>;
  getAttachments(): Promise<unknown>;
  getOpenAction(): Promise<unknown>;
  getPage(number: number): Promise<{ getAnnotations(): Promise<unknown[]>; cleanup(): void }>;
}

export async function parserFindings(document: ParsedPdf): Promise<Finding[]> {
  const findings = new Set<Finding>();
  if (await document.getJSActions()) findings.add("javascript");
  if (await document.getAttachments()) findings.add("embedded_file");
  const open = (await document.getOpenAction()) as { action?: unknown } | null;
  if (open?.action) findings.add("open_action");
  if (document.isPureXfa) findings.add("xfa");
  for (let number = 1; number <= document.numPages; number += 1) {
    const page = await document.getPage(number);
    for (const annotation of (await page.getAnnotations()) as { subtype?: string; actions?: Record<string, unknown> | null }[]) {
      if (annotation.subtype && ANNOTATIONS[annotation.subtype]) findings.add(ANNOTATIONS[annotation.subtype]!);
      if (annotation.actions && Object.keys(annotation.actions).length > 0) findings.add("javascript");
    }
    page.cleanup();
  }
  return [...findings].sort();
}
